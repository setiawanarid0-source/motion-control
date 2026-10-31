import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const run=promisify(execFile);
export const H3_FPS=24;
export const H3_MAX_SECONDS=60;
export const H3_LORA='h3_character_swap_v1.5.safetensors';
export const H3_TASK='rv2v — 参考素材改视频(Reference Video Edit)';
export const H3_PROMPT='Replace the main person in <Video 1> with the character in <Picture 1>. '+
  'Use the identity, face, hairstyle, body appearance and outfit from <Picture 1> consistently throughout the video. '+
  'Follow the original performance in <Video 1>: body movement, hands, pose, gaze, facial expression and timing. '+
  'Preserve the source camera movement, zoom, framing, perspective, background, lighting and occlusions. '+
  'Do not introduce additional people, camera moves, scene cuts, text or logos.';

// Match the source aspect on H3\'s 32px canvas grid, without forcing portrait.
// Standard stays near 0.4MP; Plus allows near 0.7MP. Never upscale a small source.
export function h3Canvas(width,height,mode='standard'){
  const pixels=mode==='plus'?737280:414720;
  const maxEdge=mode==='plus'?1152:864;
  const scale=Math.min(1,Math.sqrt(pixels/(width*height)),maxEdge/Math.max(width,height));
  return {width:Math.max(64,Math.min(Math.floor(width/32)*32,Math.round(width*scale/32)*32)),
    height:Math.max(64,Math.min(Math.floor(height/32)*32,Math.round(height*scale/32)*32))};
}

export function validateH3Probe(probe,mode='standard'){
  if(!['standard','plus'].includes(mode))throw Error('H3 membutuhkan machine Standard atau Plus.');
  const video=probe?.streams?.find(s=>s.codec_type==='video');
  if(!video||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||
     video.width<64||video.height<64)throw Error('Video H3 tidak memiliki dimensi yang valid (minimal 64 px).');
  // Prefer the VIDEO duration, not a longer audio/container track.
  const duration=Number(video.duration)||Number(probe.format?.duration);
  if(!Number.isFinite(duration)||duration<.25||duration>H3_MAX_SECONDS+.001)
    throw Error('H3 menerima video 0,25–60 detik. Video lebih panjang tidak dipotong otomatis.');
  const rotation=Number(video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||video.tags?.rotate||0);
  const rotated=Math.abs(Math.round(rotation/90))%2===1;
  const sourceWidth=rotated?video.height:video.width;
  const sourceHeight=rotated?video.width:video.height;
  return {...h3Canvas(sourceWidth,sourceHeight,mode),sourceWidth,sourceHeight,
    duration,totalFrames:Math.round(duration*H3_FPS),fps:H3_FPS};
}

export async function probeH3Input(file,mode){
  if(!file?.path)throw Error('Video sumber H3 wajib diisi.');
  let probe;
  try{
    const {stdout}=await run('ffprobe',['-v','error','-show_entries',
      'stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration',
      '-of','json',file.path],{timeout:60000,maxBuffer:65536});
    probe=JSON.parse(stdout);
  }catch{throw Error('File video H3 tidak dapat dibaca. Task belum dikirim ke RunningHub.');}
  return validateH3Probe(probe,mode);
}

// Disjoint source ranges cover every output frame exactly once. The Director
// adds its own 17k+5 alignment and motion-context prefix, then trims both away.
// Spread the ranges evenly so there is no tiny last segment after 5 seconds.
export function h3Segments(totalFrames){
  if(!Number.isSafeInteger(totalFrames)||totalFrames<6||totalFrames>H3_MAX_SECONDS*H3_FPS)
    throw Error('Jumlah frame H3 tidak valid.');
  const count=Math.ceil(totalFrames/(5*H3_FPS));
  return Array.from({length:count},(_,i)=>{
    const start=Math.round(i*totalFrames/count);
    const end=Math.round((i+1)*totalFrames/count);
    return {id:'vanta-h3-'+i,start,length:end-start,frameCount:end-start,
      durationSec:(end-start)/H3_FPS,prompt:'',taskType:'',refs:[],
      referenceVideo:{},continuityFromPrev:i>0};
  });
}

function inputName(value){
  // File names come only from RunningHub\'s upload response, never the browser.
  if(typeof value!=='string'||!value||value.length>500||
    /[\u0000-\u001f\\]/.test(value)||value.startsWith('/')||value.includes('://')||
    value.split('/').some(p=>p==='..'))throw Error('Nama file upload H3 tidak valid.');
  return value;
}

export function h3GraphForInputs(base,{imageName,videoName,source}){
  inputName(imageName);inputName(videoName);
  if(base?.['5']?.class_type!=='LoraLoaderModelOnly'||base['5'].inputs?.lora_name!==H3_LORA||
    base?.['331']?.class_type!=='MiniMaxH3Director'||base?.['490']?.class_type!=='VHS_VideoCombine')
    throw Error('Graph H3 atau Character Swap LoRA tidak valid.');
  if(!source||source.fps!==H3_FPS||![source.width,source.height].every(n=>Number.isSafeInteger(n)&&n>=64&&n%32===0))
    throw Error('Metadata video H3 belum tervalidasi.');
  const segments=h3Segments(source.totalFrames);
  const graph=structuredClone(base);
  const timeline={version:4,editMode:'global',timelineMode:'video',
    totalFrames:source.totalFrames,frameRate:H3_FPS,width:source.width,height:source.height,
    refMaxSize:Math.max(source.width,source.height),
    output:{mode:'fixed',width:source.width,height:source.height,
      longEdge:Math.max(source.width,source.height),maxExportFrames:source.totalFrames,
      exportMode:'all',audioMode:'source',refImageSize:'match',
      continuityEnabled:segments.length>1,continuityOverlapFrames:9,
      continuityMode:'guide',continuityKeepTail:false},
    videoClips:[],video:{fileName:videoName,videoFile:videoName,type:'input',subfolder:'',
      width:source.sourceWidth,height:source.sourceHeight,sourceFrameCount:source.totalFrames,
      frames:[],frameMap:[]},
    global:{taskType:H3_TASK,prompt:H3_PROMPT,
      refs:[{index:0,imageFile:imageName}],referenceVideo:{},continuousReference:false},
    segments,runSelectEnabled:false,runSelection:[]};
  Object.assign(graph['331'].inputs,{
    global_prompt:H3_PROMPT,task_type:H3_TASK,width:source.width,height:source.height,
    ref_max_size:Math.max(source.width,source.height),total_frames:source.totalFrames,
    frame_rate:H3_FPS,timeline_data:JSON.stringify(timeline),
    cache_name:'vanta-'+createHash('sha256').update(imageName+'\n'+videoName).digest('hex').slice(0,24)});
  return graph;
}
