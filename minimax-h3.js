import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const run=promisify(execFile);
export const H3_FPS=24;
export const H3_MAX_SECONDS=60;
export const H3_LORA='h3_character_swap_v1.5.safetensors';
export const H3_TASK='rv2v — 参考素材改视频(Reference Video Edit)';
export const H3_REVISION='head-hair-1080-v2';
export const H3_PROMPT='Edit only the main person\'s face and complete hair in <Video 1>, using <Picture 1> as the face and hair identity reference. '+
  'Keep the same facial structure, recognizable identity, hairline, hairstyle, hair color and hair length from <Picture 1> in every frame and every shot. '+
  'Do not transfer the reference picture\'s body, outfit, pose, background or camera angle. '+
  'Keep the original body, body proportions, neck, skin below the head, clothing, accessories, hands, other people and objects from <Video 1> unchanged. '+
  'Follow the original performance in <Video 1>: body movement, hands, pose, gaze, facial expression and timing. '+
  'The replacement head follows the source head rotation, perspective and scale through zooms, movement and camera changes. '+
  'Match the source lighting and shadows on the replacement face and hair. Preserve foreground occlusions. '+
  'Preserve the source camera movement, zoom, framing, perspective, background, lighting, scene cuts, text and logos exactly. '+
  'Do not introduce new objects, camera moves, scene cuts, identity changes or hairstyle changes.';

export function h3OutputSize(width,height){
  const scale=1080/Math.min(width,height);
  return {outputWidth:Math.round(width*scale/2)*2,outputHeight:Math.round(height*scale/2)*2};
}

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
  return {...h3Canvas(sourceWidth,sourceHeight,mode),...h3OutputSize(sourceWidth,sourceHeight),sourceWidth,sourceHeight,
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

// Both media paths come from the SAME CFR timeline. H3 gets a small, explicitly
// resized guide; the compositor gets full 1080p frames. Inverting the guide's
// resize during paste restores geometry without Director's implicit center crop.
// No extra input is asked of the user, and no source file is overwritten.
export async function prepareH3Input(file,mode){
  const source=await probeH3Input(file,mode);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-'));
  const release=()=>fs.rm(dir,{recursive:true,force:true});
  const original=path.join(dir,'source-1080.mp4'),guide=path.join(dir,'guide.mp4');
  try{
    const filters=`[0:v:0]setpts=PTS-STARTPTS,fps=${H3_FPS},split=2[hi][lo];`+
      `[hi]scale=${source.outputWidth}:${source.outputHeight}:flags=lanczos,setsar=1[original];`+
      `[lo]scale=${source.width}:${source.height}:flags=lanczos,setsar=1[guide]`;
    const encode=['-c:v','libx264','-preset','fast','-crf','16','-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p',
      '-threads','2','-frames:v',String(source.totalFrames),'-t',String(source.totalFrames/H3_FPS),'-movflags','+faststart'];
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2',
      '-i',file.path,'-filter_complex_threads','1','-filter_complex',filters,
      '-map','[original]','-map','0:a:0?',...encode,'-c:a','aac','-b:a','192k',original,
      '-map','[guide]','-an',...encode,guide],{timeout:300000,maxBuffer:65536});
    const files=await Promise.all([original,guide].map(async p=>{
      const size=(await fs.stat(p)).size;
      if(size>100*1024*1024)throw Error('Video H3 setelah persiapan melebihi batas upload RunningHub 100 MB.');
      return {path:p,originalname:path.basename(p),mimetype:'video/mp4',size};
    }));
    const tracks=await Promise.all([original,guide].map(async p=>{
      const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height,nb_frames,r_frame_rate','-of','json',p],{timeout:30000,maxBuffer:65536});
      return JSON.parse(stdout).streams?.[0];
    }));
    const actualFrames=Number(tracks[0]?.nb_frames);
    if(!Number.isSafeInteger(actualFrames)||actualFrames<6||actualFrames>H3_FPS*H3_MAX_SECONDS||
       actualFrames!==Number(tracks[1]?.nb_frames)||
       tracks[0]?.width!==source.outputWidth||tracks[0]?.height!==source.outputHeight||
       tracks[1]?.width!==source.width||tracks[1]?.height!==source.height)
      throw Error('Timeline video H3 dan sumber 1080p tidak selaras. Task belum dikirim ke RunningHub.');
    source.totalFrames=actualFrames;
    // Reset continuity at hard cuts; moving cameras and zooms remain within a shot.
    const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-nostdin','-threads','2',
      '-i',guide,'-an','-vf','scale=160:-2,select=gt(scene\\,0.4),showinfo',
      '-fps_mode','vfr','-f','null','-'],{timeout:120000,maxBuffer:1048576});
    const sceneCuts=[...new Set([...stderr.matchAll(/pts_time:([0-9.]+)/g)]
      .map(m=>Math.round(Number(m[1])*H3_FPS)))].filter(n=>n>0&&n<source.totalFrames);
    return {...source,sceneCuts,file:files[1],sourceFile:files[0],release};
  }catch(error){await release();throw error;}
}

// Disjoint source ranges cover every output frame exactly once. The Director
// adds its own 17k+5 alignment and motion-context prefix, then trims both away.
// Spread the ranges evenly so there is no tiny last segment after 5 seconds.
export function h3Segments(totalFrames,sceneCuts=[]){
  if(!Number.isSafeInteger(totalFrames)||totalFrames<6||totalFrames>H3_MAX_SECONDS*H3_FPS)
    throw Error('Jumlah frame H3 tidak valid.');
  if(!Array.isArray(sceneCuts)||sceneCuts.some(n=>!Number.isSafeInteger(n)||n<=0||n>=totalFrames))
    throw Error('Batas scene H3 tidak valid.');
  const boundaries=[0,...[...new Set(sceneCuts)].sort((a,b)=>a-b),totalFrames];
  const segments=[];
  for(let shot=0;shot<boundaries.length-1;shot++){
    const a=boundaries[shot],length=boundaries[shot+1]-a;
    const count=Math.ceil(length/(5*H3_FPS));
    for(let i=0;i<count;i++){
      const start=a+Math.round(i*length/count),end=a+Math.round((i+1)*length/count);
      segments.push({id:'vanta-h3-'+segments.length,start,length:end-start,frameCount:end-start,
        durationSec:(end-start)/H3_FPS,prompt:'',taskType:'',refs:[],
        referenceVideo:{},continuityFromPrev:i>0});
    }
  }
  return segments;
}

function inputName(value){
  // File names come only from RunningHub\'s upload response, never the browser.
  if(typeof value!=='string'||!value||value.length>500||
    /[\u0000-\u001f\\]/.test(value)||value.startsWith('/')||value.includes('://')||
    value.split('/').some(p=>p==='..'))throw Error('Nama file upload H3 tidak valid.');
  return value;
}

export function h3GraphForInputs(base,{imageName,videoName,sourceVideoName,source}){
  inputName(imageName);inputName(videoName);inputName(sourceVideoName);
  if(base?.['5']?.class_type!=='LoraLoaderModelOnly'||base['5'].inputs?.lora_name!==H3_LORA||
    base?.['331']?.class_type!=='MiniMaxH3Director'||base?.['490']?.class_type!=='VHS_VideoCombine')
    throw Error('Graph H3 atau Character Swap LoRA tidak valid.');
  if(!source||source.fps!==H3_FPS||![source.width,source.height].every(n=>Number.isSafeInteger(n)&&n>=64&&n%32===0))
    throw Error('Metadata video H3 belum tervalidasi.');
  if(![source.outputWidth,source.outputHeight].every(n=>Number.isSafeInteger(n)&&n>=1080&&n%2===0)||
     Math.min(source.outputWidth,source.outputHeight)!==1080)
    throw Error('Dimensi output H3 1080p belum tervalidasi.');
  const segments=h3Segments(source.totalFrames,source.sceneCuts);
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
      width:source.width,height:source.height,sourceFrameCount:source.totalFrames,
      frames:[],frameMap:[]},
    global:{taskType:H3_TASK,prompt:H3_PROMPT,
      refs:[{index:0,imageFile:imageName}],referenceVideo:{},continuousReference:false},
    segments,runSelectEnabled:false,runSelection:[]};
  Object.assign(graph['331'].inputs,{
    global_prompt:H3_PROMPT,task_type:H3_TASK,width:source.width,height:source.height,
    ref_max_size:Math.max(source.width,source.height),total_frames:source.totalFrames,
    frame_rate:H3_FPS,timeline_data:JSON.stringify(timeline),
    export_source_images:true,
    cache_name:'vanta-'+createHash('sha256').update(H3_REVISION+'\n'+imageName+'\n'+videoName+'\n'+JSON.stringify(source.sceneCuts||[])).digest('hex').slice(0,24)});
  Object.assign(graph['33'].inputs,{video:sourceVideoName,force_rate:H3_FPS,frame_load_cap:source.totalFrames});
  // Segment-local SAM memory prevents stale tracks crossing a hard cut. A union
  // of source/generated head masks removes the old hair silhouette as well.
  for(const id of Object.keys(graph))if(Number(id)>=1000)delete graph[id];
  const matteImages=[];
  const add=(id,class_type,inputs)=>{graph[String(id)]={class_type,inputs};return [String(id),0];};
  for(let i=0;i<segments.length;i++){
    const seg=segments[i],id=1000+i*30;
    const crop=output=>add(id+output,'ImageFromBatch',{image:['331',output],batch_index:seg.start,length:seg.length});
    const generated=crop(0),original=crop(4);
    const track=(offset,images,conditioning,max_objects)=>{
      const data=add(id+offset,'SAM3_VideoTrack',{images,model:['86',0],conditioning,
        detection_threshold:0.4,max_objects,detect_interval:1});
      return add(id+offset+1,'SAM3_TrackToMask',{track_data:data,object_indices:''});
    };
    const headOriginal=track(5,original,['90',0],2),headGenerated=track(7,generated,['90',0],2);
    const hands=track(9,original,['88',0],2);
    const union=add(id+11,'MaskComposite',{destination:headOriginal,source:headGenerated,x:0,y:0,operation:'add'});
    const grow=add(id+12,'GrowMask',{mask:union,expand:2,tapered_corners:true});
    const maskImage=add(id+13,'MaskToImage',{mask:grow});
    const blur=add(id+14,'ImageBlur',{image:maskImage,blur_radius:2,sigma:1});
    const soft=add(id+15,'ImageToMask',{image:blur,channel:'red'});
    const protectedMask=add(id+16,'MaskComposite',{destination:soft,source:hands,x:0,y:0,operation:'subtract'});
    const result=add(id+17,'MaskToImage',{mask:protectedMask});
    matteImages.push(result);
  }
  // One concatenation node avoids retaining a growing sequence of mask copies
  // in ComfyUI's graph cache for 60-second inputs.
  graph['492'].inputs.image=matteImages.length===1?matteImages[0]:add(491,'ImageBatchMulti',{
    inputcount:matteImages.length,...Object.fromEntries(matteImages.map((value,i)=>['image_'+(i+1),value]))});
  return graph;
}
