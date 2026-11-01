import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const run=promisify(execFile);
export const H3_FPS=24;
export const H3_MAX_SECONDS=60;
export const H3_REVISION='motion-transfer-native-1080-v2';
export const H3_WINDOW_FRAMES=124;
export const H3_MODELS=Object.freeze({
  unet:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae:'minimax_h3_video_vae_fp16.safetensors',
  audioVae:'minimax_h3_audio_vae_fp32.safetensors',
  adapter:'minimax_h3_ref2va_training_adapter_v2.safetensors',
  turbo:'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors',
  motion:'minimax_h3_motion_transfer_v1.0_ref2va.safetensors',
  motionTara:'minimax_h3_motion_transfer_tara_v1.0_ref2va.safetensors'
});
// Photo supplies the ENTIRE appearance, including the setting. Video supplies
// performance and camera. No head mask, source composite or beauty/style LoRA.
export const H3_PROMPT=`motion_transfer:
subject_definitions:
<Subject 1> is the main subject visible in <Picture 1>. The actual picture defines
the subject's identity, facial geometry, hair, body proportions, clothing,
accessories, materials, skin texture and the surrounding scene. Use this current
picture, not a generic attractive person or a person from another request.
The aligned motion guide supplies a performance, not the subject's appearance.

summary:
[video generation + reference] Animate the entire scene in <Picture 1> using the
aligned guide's motion and camera, in the same order and at matching times.

retention_analysis:
<Picture 1>: preserve its visible identity, face shape, individual facial features,
body structure, outfit, colours, fine texture, lighting character and environment.
The guide: transfer body and hand movement, gestures, head rotation, gaze,
expression changes, mouth movement, timing, subject movement through the frame,
camera translation, pan, tilt, roll, zoom, perspective and framing changes.
Do not transfer the guide performer's identity, anatomy, outfit or environment.
The still pose in the picture must not replace the moving guide performance.

detailed_description:
Follow the aligned frames through turns, occlusions and back views. Preserve
the face's proportions as its expression changes; keep eyes, nose, lips, jaw,
hairline and asymmetry recognisable. Retain the photo's natural skin and fabric
texture; do not beautify, smooth skin, reshape the body or change its style.
When the guide camera is stationary, keep the camera stationary. When it moves,
follow that motion, including horizontal-to-vertical moves and roll, without
inventing extra drift, handheld shake, zoom or stabilisation. Preserve the
guide's expression timing and intensity rather than freezing the face.
Keep the photo's scene appearance while following the guide's camera and action.
Do not add people, objects or scene cuts. Guide padding is not scene content.

overall_soundscape:
The source soundtrack is copied separately at its original timing.

non_diegetic_music:
Do not add music or dialogue.`;

function displayedSize(video){
  const rotation=Number(video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||video.tags?.rotate||0);
  const swapped=Math.abs(Math.round(rotation/90))%2===1;
  return {sourceWidth:swapped?video.height:video.width,sourceHeight:swapped?video.width:video.height};
}
export function validateH3Probe(probe,mode='plus'){
  const v=probe?.streams?.find(s=>s.codec_type==='video');
  if(!v||![v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>=64&&n<=8192))
    throw Error('Video H3 tidak memiliki dimensi yang valid (64–8192 px).');
  const duration=Number(v.duration)||Number(probe.format?.duration);
  if(!Number.isFinite(duration)||duration<.25||duration>H3_MAX_SECONDS+.001)
    throw Error('H3 menerima video 0,25–60 detik. Video tidak dipotong otomatis.');
  if(mode!=='plus')throw Error('Motion Control H3 1080p membutuhkan machine Plus. Resolusi tidak diturunkan otomatis.');
  return {...displayedSize(v),duration,totalFrames:Math.round(duration*H3_FPS),fps:H3_FPS,
    hasAudio:probe.streams.some(s=>s.codec_type==='audio')};
}
async function probe(file,kind){
  if(!file?.path)throw Error(`${kind} H3 wajib diisi.`);
  try{
    const {stdout}=await run('ffprobe',['-v','error','-show_entries',
      'stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration',
      '-of','json',file.path],{timeout:60000,maxBuffer:65536});
    return JSON.parse(stdout);
  }catch{throw Error(`File ${kind.toLowerCase()} H3 tidak dapat dibaca. Task belum dikirim ke RunningHub.`);}
}
export async function probeH3Input(file,mode){return validateH3Probe(await probe(file,'Video'),mode);}
export function h3PhotoPlan(width,height){
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>=64&&n<=8192))
    throw Error('Dimensi foto H3 tidak valid (minimal 64 px).');
  // H3 max reference mode caps the short edge at 2048. Reject instead of
  // secretly downsizing a photo beyond the encoder limit.
  if(Math.min(width,height)>2048)
    throw Error('Sisi pendek foto H3 maksimal 2048 px agar foto tidak diperkecil oleh encoder.');
  const scale=1080/Math.min(width,height);
  const outputWidth=Math.round(width*scale/2)*2,outputHeight=Math.round(height*scale/2)*2;
  if(Math.max(outputWidth,outputHeight)>2160)
    throw Error('Rasio foto H3 didukung hingga 2:1 atau 1:2; foto tidak dipotong atau diregangkan otomatis.');
  return {referenceWidth:width,referenceHeight:height,
    referencePadRight:Math.ceil(width/32)*32-width,referencePadBottom:Math.ceil(height/32)*32-height,
    outputWidth,outputHeight,canvasWidth:Math.ceil(outputWidth/32)*32,canvasHeight:Math.ceil(outputHeight/32)*32,
    padLeft:Math.floor((Math.ceil(outputWidth/32)*32-outputWidth)/2),
    padTop:Math.floor((Math.ceil(outputHeight/32)*32-outputHeight)/2)};
}
export function h3ModelFrames(frames){return 5+17*Math.max(0,Math.ceil((frames-5)/17));}

// Export each real frame once. Continuations include one source overlap frame;
// its matching generated frame supplies first-frame context. Cuts reset context.
export function h3Segments(totalFrames,sceneCuts=[]){
  if(!Number.isSafeInteger(totalFrames)||totalFrames<6||totalFrames>H3_MAX_SECONDS*H3_FPS)
    throw Error('Jumlah frame H3 tidak valid.');
  if(!Array.isArray(sceneCuts)||sceneCuts.some(n=>!Number.isSafeInteger(n)||n<=0||n>=totalFrames))
    throw Error('Batas scene H3 tidak valid.');
  // Keep short clips in one model timeline, even if the heuristic sees a cut
  // during a pan/lighting change. The guide still contains every original cut.
  const boundaries=totalFrames<=H3_WINDOW_FRAMES?[0,totalFrames]:
    [0,...[...new Set(sceneCuts)].sort((a,b)=>a-b),totalFrames];
  const segments=[];
  for(let shot=0;shot<boundaries.length-1;shot++){
    const a=boundaries[shot],length=boundaries[shot+1]-a;
    // 124 is a native 17n+5 H3 window. The old 106-frame cap split even
    // a five-second / 120-frame shot into two independent samplers at 2.5 s.
    const count=length<=H3_WINDOW_FRAMES?1:Math.ceil((length-1)/(H3_WINDOW_FRAMES-1));
    const inputTotal=length+count-1;
    let start=a,inputCursor=0;
    for(let i=0;i<count;i++){
      const contextFrames=i?1:0;
      const inputFrames=Math.ceil((inputTotal-inputCursor)/(count-i));
      const end=start+inputFrames-contextFrames;
      segments.push({start,length:end-start,contextFrames,loadStart:start-contextFrames,inputFrames,
        modelFrames:h3ModelFrames(inputFrames)});
      inputCursor+=inputFrames;start=end;
    }
  }
  return segments;
}

export async function prepareH3Input(file,mode,imageFile){
  const source=await probeH3Input(file,mode);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-motion-'));
  const release=()=>fs.rm(dir,{recursive:true,force:true});
  const output=path.join(dir,'motion-guide.mp4');
  try{
    const reference=await prepareH3Reference(imageFile,path.join(dir,'reference-srgb.png'));
    const plan=h3PhotoPlan(reference.color.width,reference.color.height);
    // Fit ONLY the control video to the photo's aspect and H3 grid. Contain/pad
    // keeps its geometry and camera. Original photo and generated pixels are not scaled.
    const filter=`setpts=PTS-STARTPTS,fps=24,`+
      `scale=${plan.outputWidth}:${plan.outputHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,`+
      `pad=${plan.canvasWidth}:${plan.canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-i',file.path,
      '-map','0:v:0','-map','0:a:0?','-vf',filter,
      ...(source.hasAudio?['-af',`atrim=end=${source.totalFrames/24},asetpts=PTS-STARTPTS`]:[]),
      '-frames:v',String(source.totalFrames),'-t',String(source.totalFrames/24),
      '-c:v','libx264','-preset','fast','-crf','16','-maxrate','12M','-bufsize','24M',
      '-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','192k','-movflags','+faststart',output],
      {timeout:300000,maxBuffer:65536});
    const {stdout}=await run('ffprobe',['-v','error','-show_streams','-of','json',output],{timeout:30000,maxBuffer:65536});
    const tracks=JSON.parse(stdout).streams||[],v=tracks.find(s=>s.codec_type==='video'),frames=Number(v?.nb_frames);
    const bytes=(await fs.stat(output)).size;
    if(v?.width!==plan.canvasWidth||v?.height!==plan.canvasHeight||v?.r_frame_rate!=='24/1'||
      !Number.isSafeInteger(frames)||frames<6||Math.abs(frames-source.totalFrames)>1||bytes>100*1024*1024||
      source.hasAudio!==tracks.some(s=>s.codec_type==='audio'))
      throw Error('Guide Motion Control H3 gagal divalidasi. Task belum dikirim ke RunningHub.');
    const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-nostdin','-threads','2',
      '-i',output,'-an','-vf','scale=160:-2,select=gt(scene\\,0.35),showinfo','-fps_mode','vfr','-f','null','-'],
      {timeout:120000,maxBuffer:1048576});
    const sceneCuts=[...new Set([...stderr.matchAll(/pts_time:([0-9.]+)/g)]
      .map(m=>Math.round(Number(m[1])*24)))].filter(n=>n>0&&n<frames);
    return {...source,...plan,totalFrames:frames,sceneCuts,
      referenceFile:reference.file,referenceColor:reference.color,
      file:{path:output,originalname:'motion-guide.mp4',mimetype:'video/mp4',size:bytes},release};
  }catch(error){await release();throw error;}
}

export async function prepareH3Reference(file,outputPath){
  if(!file?.path)throw Error('Gambar H3 wajib diisi.');
  let color;
  try{
    const {stdout}=await run(process.env.VANTA_MEDIA_PYTHON||'python3',[
      new URL('./scripts/h3-reference-color.py',import.meta.url).pathname,file.path,outputPath],
      {timeout:40000,maxBuffer:65536});
    color=JSON.parse(stdout);
  }catch(error){
    let detail;
    try{detail=JSON.parse(error.stdout||'').error;}catch{}
    throw Error(detail||'File gambar H3 tidak dapat dibaca. Task belum dikirim ke RunningHub.');
  }
  const prepared=color.outputWritten?{
    path:outputPath,originalname:'reference-srgb.png',mimetype:'image/png',size:(await fs.stat(outputPath)).size
  }:file;
  if(prepared.size>20*1024*1024)throw Error('Foto setelah konversi profil warna melebihi 20 MB; foto tidak diperkecil otomatis.');
  return {file:prepared,color};
}

export function h3ExecutionPlan(source){
  const segments=validateSource(source);
  return {revision:H3_REVISION,frames:source.totalFrames,fps:H3_FPS,
    inferenceProfile:source.inferenceProfile||'legacy-training-adapter',
    canvas:[source.canvasWidth,source.canvasHeight],output:[source.outputWidth,source.outputHeight],
    segments:segments.map(s=>({start:s.start,frames:s.length,modelFrames:s.modelFrames})),
    samplerCount:segments.length,detectedCuts:source.sceneCuts||[],referenceColor:source.referenceColor||null,
    postDecodeResize:false,postRefinement:false};
}

function inputName(value){
  if(typeof value!=='string'||!value||value.length>500||/[\u0000-\u001f\\]/.test(value)||
    value.startsWith('/')||value.includes('://')||value.split('/').includes('..'))throw Error('Nama file upload H3 tidak valid.');
  return value;
}
function validateSource(source){
  if(!source||source.fps!==24||typeof source.hasAudio!=='boolean')throw Error('Metadata H3 belum tervalidasi.');
  let expected;
  try{expected=h3PhotoPlan(source.referenceWidth,source.referenceHeight);}catch{throw Error('Metadata foto H3 belum tervalidasi.');}
  if(Object.entries(expected).some(([key,value])=>source[key]!==value))throw Error('Metadata canvas H3 belum tervalidasi.');
  return h3Segments(source.totalFrames,source.sceneCuts);
}
export function h3GraphForInputs(base,{imageName,videoName,source}){
  inputName(imageName);inputName(videoName);
  if(base?.revision!==H3_REVISION)throw Error('Revisi Motion Control H3 tidak valid.');
  const segments=validateSource(source),g={};
  const profile=source.inferenceProfile||'legacy-training-adapter';
  if(!['legacy-training-adapter','no-training-adapter','tara-native','guide-kitchen'].includes(profile))throw Error('Profil inferensi H3 tidak valid.');
  const tara=profile==='tara-native';
  const add=(id,class_type,inputs,title)=>{id=String(id);g[id]={class_type,inputs,...(title?{_meta:{title}}:{})};return [id,0];};
  add(1,'UNETLoader',{unet_name:H3_MODELS.unet,weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:H3_MODELS.clip,type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:H3_MODELS.videoVae});add(4,'VAELoader',{vae_name:H3_MODELS.audioVae});
  if(profile==='legacy-training-adapter')
    add(5,'LoraLoaderModelOnly',{model:['1',0],lora_name:H3_MODELS.adapter,strength_model:1});
  add(6,'LoraLoaderModelOnly',{model:[profile==='legacy-training-adapter'?'5':'1',0],lora_name:H3_MODELS.turbo,strength_model:1});
  add(7,'LoraLoaderModelOnly',{model:['6',0],lora_name:tara?H3_MODELS.motionTara:H3_MODELS.motion,strength_model:1},'Motion Transfer v1.0');
  add(8,'MiniMaxH3SigmaShift',{model:['7',0],shift_video:12,shift_audio:3});
  if(profile==='guide-kitchen'){
    add(9,'ModelAttentionBackend',{model:['7',0],attention:'comfy kitchen attention'});
    g['8'].inputs.model=['9',0];
  }
  if(tara)add(9,'BFSMiniMaxH3NativeTemporal',{model:['8',0],motion_video_index:1,strength:2,
    window_seconds:.2,falloff_seconds:.25,max_penalty:6,attention_backend:'flash partitions (no compile)',
    structure_guidance:1,structure_sigma_min:0},'Native aligned video reference; matching TARA LoRA');
  add(30,'LoadImage',{image:imageName});
  const reference=add(31,'ImagePadForOutpaint',{image:['30',0],left:0,top:0,
    right:source.referencePadRight,bottom:source.referencePadBottom,feathering:0},'Original photo pixels; grid padding only');
  add(40,'KSamplerSelect',{sampler_name:'euler'});
  add(41,'BasicScheduler',{model:[tara?'9':'8',0],scheduler:'simple',steps:8,denoise:1});
  const exports=[];let previous=null;
  for(let i=0;i<segments.length;i++){
    const seg=segments[i],b=1000+i*30;
    let guide=add(b,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
      frame_load_cap:seg.inputFrames,skip_first_frames:seg.loadStart,select_every_nth:1,format:'None'});
    // Pad INSIDE this shot. Add Guide would otherwise discard a non-17n+5 tail.
    if(seg.modelFrames>seg.inputFrames){
      const last=add(b+1,'ImageFromBatch',{image:guide,batch_index:seg.inputFrames-1,length:1});
      const padding=add(b+2,'RepeatImageBatch',{image:last,amount:seg.modelFrames-seg.inputFrames});
      guide=add(b+3,'ImageBatch',{image1:guide,image2:padding});
    }
    add(b+4,'MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],
      prompt:tara?H3_PROMPT.replace('The aligned motion guide supplies','<Video 1> supplies'):H3_PROMPT,
      width:source.canvasWidth,height:source.canvasHeight,length:seg.modelFrames,ref_image_size:'max',
      'ref_images.ref_image_1':reference,...(tara?{'ref_videos.ref_video_1':guide}:{})},'Photo supplies full appearance in every segment');
    let positive=tara?[String(b+4),0]:add(b+5,'MiniMaxH3AddGuide',{positive:[String(b+4),0],latent:[String(b+4),1],vae:['3',0],
      image:guide,frame_idx:0},'All aligned motion frames; no native reference-video duplicate');
    if(seg.contextFrames&&previous){
      const tail=add(b+6,'ImageFromBatch',{image:previous.image,batch_index:previous.lastFrame,length:1});
      positive=add(b+7,'MiniMaxH3AddGuide',{positive,latent:[String(b+4),1],vae:['3',0],image:tail,frame_idx:0},
        'Previous generated frame at matching source overlap; reset at cuts');
    }
    const noise=add(b+8,'RandomNoise',{noise_seed:42+i});
    const guider=add(b+9,'CFGGuider',{model:[tara?'9':'8',0],positive,negative:positive,cfg:1});
    const samples=add(b+10,'SamplerCustomAdvanced',{noise,guider,sampler:['40',0],sigmas:['41',0],latent_image:[String(b+4),1]});
    // The H3 VAE handles its own spatial/temporal tiling.
    const decoded=add(b+11,'VAEDecode',{samples,vae:['3',0]});
    previous={image:decoded,lastFrame:seg.contextFrames+seg.length-1};
    const trimmed=add(b+12,'ImageFromBatch',{image:decoded,batch_index:seg.contextFrames,length:seg.length},'Trim overlap and model padding frames only');
    const pixels=add(b+13,'ImageCrop',{image:trimmed,width:source.outputWidth,height:source.outputHeight,
      x:source.padLeft,y:source.padTop},'Remove grid border only; never resize generated content');
    exports.push(pixels);
  }
  // One join avoids a cached, ever-growing ImageBatch for every segment.
  // KJNodes is already used by Vanta's existing RunningHub workflows.
  const images=exports.length===1?exports[0]:add(49,'ImageBatchMulti',{
    inputcount:exports.length,...Object.fromEntries(exports.map((value,i)=>['image_'+(i+1),value]))});
  const audio=source.hasAudio?add(50,'VHS_LoadAudioUpload',{audio:videoName,start_time:0,duration:source.totalFrames/24}):null;
  add(490,'VHS_VideoCombine',{images,...(audio?{audio}:{}),frame_rate:24,loop_count:0,
    filename_prefix:'VANTA-H3-MOTION-1080',format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,
    save_metadata:true,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false},
    '1080p canvas sampling; visual fidelity and memory fit require render validation');
  return g;
}
