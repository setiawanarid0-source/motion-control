import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {detectIdentityFocus,validIdentityCrop} from './h3-identity-focus.js';
import {validUploadedH3Lora} from './h3-appearance-model.js';
import {nativePoseCandidateGraph,NATIVE_POSE_MODELS} from './h3-native-pose-candidate.js';
const run=promisify(execFile);
export const H3_FPS=24;
export const H3_MAX_SECONDS=60;
export const H3_REVISION='motion-transfer-native-1080-v6';
// Promoted after the original 361-frame clip and a changed-reference trial.
// Keep the tested graph: one native photo, one shared photo-derived caption,
// four-step character model and five aligned generated continuation frames.
export const H3_DEFAULT_PROFILE='guide-dmad4-character-caption';
export const H3_WINDOW_FRAMES=124;
const photoGuideProfile=profile=>['guide-dmad4-ffp','guide-dmad4-ffp-focus','guide-dmad4-motion-anchor'].includes(profile);
const nativePoseProfile=profile=>['native-fun-pose4-caption','native-fun-pose8-caption','native-fun-retarget4-caption'].includes(profile);
const continuityProfile=profile=>photoGuideProfile(profile)||profile==='guide-dmad4-character-caption'||nativePoseProfile(profile);
export const H3_MODELS=Object.freeze({
  unet:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae:'minimax_h3_video_vae_fp16.safetensors',
  audioVae:'minimax_h3_audio_vae_fp32.safetensors',
  adapter:'minimax_h3_ref2va_training_adapter_v2.safetensors',
  turbo:'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors',
  turboDmad4:'minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors',
  motion:'minimax_h3_motion_transfer_v1.0_ref2va.safetensors',
  motionFfp:'minimax_h3_motion_transfer_ffp_v1.0_ref2va.safetensors',
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

// Export each real frame once. Continuations include one aligned overlap frame.
// Scene-change heuristics are diagnostic only: fast pans/rolls must not create
// many tiny, independently sampled clips and restart the character identity.
export function h3Segments(totalFrames,sceneCuts=[],continuationFrames=1){
  if(![1,5,22].includes(continuationFrames))throw Error('Konteks lanjutan H3 tidak valid.');
  if(!Number.isSafeInteger(totalFrames)||totalFrames<6||totalFrames>H3_MAX_SECONDS*H3_FPS)
    throw Error('Jumlah frame H3 tidak valid.');
  if(!Array.isArray(sceneCuts)||sceneCuts.some(n=>!Number.isSafeInteger(n)||n<=0||n>=totalFrames))
    throw Error('Batas scene H3 tidak valid.');
  // Every real edit remains in the actual guide frames. Only the native model
  // capacity sets generation boundaries, for short and long clips alike.
  const boundaries=[0,totalFrames];
  const segments=[];
  for(let shot=0;shot<boundaries.length-1;shot++){
    const a=boundaries[shot],length=boundaries[shot+1]-a;
    // 124 is a native 17n+5 H3 window. The old 106-frame cap split even
    // a five-second / 120-frame shot into two independent samplers at 2.5 s.
    const count=length<=H3_WINDOW_FRAMES?1:Math.ceil((length-continuationFrames)/(H3_WINDOW_FRAMES-continuationFrames));
    const inputTotal=length+(count-1)*continuationFrames;
    let start=a,inputCursor=0;
    for(let i=0;i<count;i++){
      const contextFrames=i?continuationFrames:0;
      const inputFrames=Math.ceil((inputTotal-inputCursor)/(count-i));
      const end=start+inputFrames-contextFrames;
      segments.push({start,length:end-start,contextFrames,loadStart:start-contextFrames,inputFrames,
        modelFrames:h3ModelFrames(inputFrames)});
      inputCursor+=inputFrames;start=end;
    }
  }
  return segments;
}

export async function prepareH3Input(file,mode,imageFile,{
  inferenceProfile=H3_DEFAULT_PROFILE,identityFocus=['guide-sol-focus','guide-dmad4-focus','guide-dmad4-motion-anchor','guide-dmad4-ffp-focus'].includes(inferenceProfile)
}={}){
  const source=await probeH3Input(file,mode);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-motion-'));
  const release=()=>fs.rm(dir,{recursive:true,force:true});
  const output=path.join(dir,'motion-guide.mp4');
  try{
    const reference=await prepareH3Reference(imageFile,path.join(dir,'reference-srgb.png'));
    const plan=h3PhotoPlan(reference.color.width,reference.color.height);
    const referenceFace=identityFocus?await detectIdentityFocus(reference.file,{
      width:reference.color.width,height:reference.color.height}):null;
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
    return {...source,...plan,totalFrames:frames,sceneCuts,inferenceProfile,
      referenceFile:reference.file,referenceColor:reference.color,referenceFace,
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
    inferenceProfile:source.inferenceProfile||H3_DEFAULT_PROFILE,
    sampling:h3SamplingPlan(source),
    ...(source.inferenceProfile==='native-fun-retarget4-caption'?{poseRetargeting:'photo_proportions_once_for_whole_sequence'}:{}),
    referenceFace:source.referenceFace||null,
    attentionConditioning:nativePoseProfile(source.inferenceProfile)?'native_full_attention':h3AttentionConditioning(source),
    guidePhotoCopyResized:photoGuideProfile(source.inferenceProfile||H3_DEFAULT_PROFILE),
    guideAppearance:nativePoseProfile(source.inferenceProfile)?'drawn_pose_only_with_generated_continuation':
      photoGuideProfile(source.inferenceProfile||H3_DEFAULT_PROFILE)?'photo_first_frame_then_generated_overlap':
      source.inferenceProfile==='guide-dmad4-character-caption'?'source_rgb_then_generated_overlap':'source_rgb_with_generated_keyframe',
    appearanceCaptionModel:source.inferenceProfile==='guide-dmad4-character-caption'||nativePoseProfile(source.inferenceProfile)?'qwen3.5_9b_w4a8_gptq.safetensors':null,
    canvas:[source.canvasWidth,source.canvasHeight],output:[source.outputWidth,source.outputHeight],
    segments:segments.map(s=>({start:s.start,frames:s.length,modelFrames:s.modelFrames,contextFrames:s.contextFrames})),
    samplerCount:segments.length,detectedCuts:source.sceneCuts||[],referenceColor:source.referenceColor||null,
    postDecodeResize:false,postRefinement:false};
}

function h3AttentionConditioning(source){
  // Native exact_kv keeps every query's access to the reference exact. The
  // extra dense target-audio query rows are unnecessary for source-audio export.
  return source.sparseConditioningMode||
    (['guide-dmad4-focus','guide-dmad4-ffp','guide-dmad4-ffp-focus','guide-dmad4-motion-anchor','guide-dmad4-character-caption'].includes(source.inferenceProfile||H3_DEFAULT_PROFILE)?'exact_kv':'exact_kv_and_rows');
}

export function h3SamplingPlan(source){
  if(source.inferenceProfile==='native-fun-pose8-caption')return {steps:8,sampler:'euler',scheduler:'simple',turbo:H3_MODELS.turbo,audioShift:3};
  if(nativePoseProfile(source.inferenceProfile))return {steps:4,sampler:'res_multistep',scheduler:'simple',turbo:NATIVE_POSE_MODELS.turbo,audioShift:null};
  const dmad=['guide-dmad4-focus','guide-dmad4-ffp','guide-dmad4-ffp-focus','guide-dmad4-motion-anchor','guide-dmad4-character-caption'].includes(source.inferenceProfile||H3_DEFAULT_PROFILE);
  // DMAD's four-step student uses re-noise sampling (LCM/simple), not an
  // eight-step DMD adapter with its scheduler shortened arbitrarily.
  return {steps:dmad?4:8,sampler:dmad?'lcm':'euler',scheduler:'simple',
    turbo:dmad?H3_MODELS.turboDmad4:H3_MODELS.turbo,audioShift:dmad?2:3};
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
  return h3Segments(source.totalFrames,source.sceneCuts,continuityProfile(source.inferenceProfile||H3_DEFAULT_PROFILE)?5:1);
}
export function h3GraphForInputs(base,{imageName,videoName,source}){
  inputName(imageName);inputName(videoName);
  if(base?.revision!==H3_REVISION)throw Error('Revisi Motion Control H3 tidak valid.');
  const segments=validateSource(source),g={};
  const profile=source.inferenceProfile||H3_DEFAULT_PROFILE;
  if(nativePoseProfile(profile))return nativePoseCandidateGraph({imageName,videoName,source,segments,
    recipe:profile==='native-fun-pose8-caption'?'dmd8':'native4',retarget:profile==='native-fun-retarget4-caption'});
  if(!['legacy-training-adapter','no-training-adapter','tara-native','guide-kitchen','guide-sol-focus','guide-dmad4-focus','guide-dmad4-ffp','guide-dmad4-ffp-focus','guide-dmad4-motion-anchor','guide-dmad4-character-caption'].includes(profile))throw Error('Profil inferensi H3 tidak valid.');
  const tara=profile==='tara-native';
  const ffp=['guide-dmad4-ffp','guide-dmad4-ffp-focus'].includes(profile);
  const character=profile==='guide-dmad4-character-caption';
  const anchored=photoGuideProfile(profile);
  const focused=['guide-sol-focus','guide-dmad4-focus','guide-dmad4-ffp','guide-dmad4-ffp-focus','guide-dmad4-motion-anchor','guide-dmad4-character-caption'].includes(profile),sampling=h3SamplingPlan(source);
  const add=(id,class_type,inputs,title)=>{id=String(id);g[id]={class_type,inputs,...(title?{_meta:{title}}:{})};return [id,0];};
  add(1,'UNETLoader',{unet_name:H3_MODELS.unet,weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:H3_MODELS.clip,type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:H3_MODELS.videoVae});add(4,'VAELoader',{vae_name:H3_MODELS.audioVae});
  if(profile==='legacy-training-adapter')
    add(5,'LoraLoaderModelOnly',{model:['1',0],lora_name:H3_MODELS.adapter,strength_model:1});
  add(6,'LoraLoaderModelOnly',{model:[profile==='legacy-training-adapter'?'5':'1',0],lora_name:sampling.turbo,strength_model:1});
  if(character&&!source.appearanceLoraFile)throw Error('File model karakter H3 tidak valid.');
  if((ffp||character)&&source.appearanceLoraFile){
    if(!validUploadedH3Lora(source.appearanceLoraFile))throw Error('File model H3 FFP tidak valid.');
    add(7,'RHLoraLoader',{model:['6',0],clip:['2',0],lora_name:'',file_name:source.appearanceLoraFile,
      strength_model:1,strength_clip:0},character?'SHA-verified native Character v1.1':'SHA-verified native Motion Transfer FFP v1.0');
  }else add(7,'LoraLoaderModelOnly',{model:['6',0],lora_name:tara?H3_MODELS.motionTara:ffp?H3_MODELS.motionFfp:H3_MODELS.motion,strength_model:1},ffp?'Motion Transfer FFP v1.0':'Motion Transfer v1.0');
  add(8,'MiniMaxH3SigmaShift',{model:['7',0],shift_video:12,shift_audio:sampling.audioShift});
  if(profile==='guide-kitchen'||focused){
    add(9,'ModelAttentionBackend',{model:['7',0],attention:'comfy kitchen attention'});
    g['8'].inputs.model=['9',0];
  }
  if(focused){
    const sinks=h3AttentionConditioning(source);
    if(!['exact_kv','exact_kv_and_rows','off'].includes(sinks))throw Error('Mode attention H3 tidak valid.');
    add(10,'BlockSparseAttention',{model:['8',0],selection:'sol-attn','selection.tau':1,
      start_percent:.2,end_percent:1,dense_blocks:'0,1',min_tokens:12288,extra_tokens:256,
      sink_conditioning:sinks,verbose:true});
  }
  if(tara)add(9,'BFSMiniMaxH3NativeTemporal',{model:['8',0],motion_video_index:1,strength:2,
    window_seconds:.2,falloff_seconds:.25,max_penalty:6,attention_backend:'flash partitions (no compile)',
    structure_guidance:1,structure_sigma_min:0},'Native aligned video reference; matching TARA LoRA');
  add(30,'LoadImage',{image:imageName});
  const reference=add(31,'ImagePadForOutpaint',{image:['30',0],left:0,top:0,
    right:source.referencePadRight,bottom:source.referencePadBottom,feathering:0},'Original photo pixels; grid padding only');
  let firstFrame=null;
  if(anchored){
    // The FFP model reads the edited appearance at frame 0 of its aligned guide,
    // not only as a detached reference picture. Fit a CONDITIONING COPY; node 31
    // still supplies every original photo pixel and decoded output is not resized.
    const fitted=add(33,'ImageScale',{image:['30',0],upscale_method:'bilinear',
      width:source.outputWidth,height:source.outputHeight,crop:'center'},'Guide-only first-frame copy; original reference remains native');
    firstFrame=add(34,'ImagePadForOutpaint',{image:fitted,left:source.padLeft,top:source.padTop,
      right:source.canvasWidth-source.outputWidth-source.padLeft,
      bottom:source.canvasHeight-source.outputHeight-source.padTop,feathering:0});
  }
  let face=null;
  if(focused&&!character&&(!ffp||profile==='guide-dmad4-ffp-focus')&&source.referenceFace){
    const f=source.referenceFace;
    if(!validIdentityCrop(f,source.referenceWidth,source.referenceHeight))
      throw Error('Area referensi wajah H3 tidak valid.');
    face=add(32,'ImageCrop',{image:['30',0],x:f.x,y:f.y,width:f.width,height:f.height},
      'Additional native-pixel identity reference from the same photo; no output face editing');
  }
  let prompt=H3_PROMPT;
  if(anchored&&!ffp)prompt=prompt.replace('The aligned motion guide supplies',
    '<Picture 1> also defines the edited starting frame of the aligned guide. '+
    'Propagate this complete appearance through every subsequent frame while retaining the guide performance and camera.\nThe aligned motion guide supplies');
  // FFP is trained to propagate a complete edited appearance, with one native
  // picture. Do not feed competing whole-photo/face references or guide CLIP.
  if(ffp)prompt='vfx_edit: Propagate the complete appearance in <Picture 1> through the entire video: '+
    'the same face and facial proportions, hair, body proportions, exact clothing and its colour, fabric texture, accessories, lighting and scene. '+
    '<Picture 1> is the edited appearance reference for the video. Preserve its changes throughout the whole clip '+
    'while keeping the original guide body and hand motion, facial expression changes, timing, camera movement and framing. '+
    'Keep the outfit unchanged through turns and occlusions; do not restore the original performer or clothing. '+
    'Keep the natural texture and facial geometry of the picture.';
  if(face){
    const role='<Picture 2> is a close-up cropped from <Picture 1>, depicting the SAME <Subject 1>, not another person. '+
    'Preserve its visible eyes, nose, lips, jaw and facial proportions throughout the performance. '+
    'Picture 1 supplies the whole appearance and environment; Picture 2 supplies additional facial identity only. '+
    'It must not change the guide camera, pose or framing.';
    prompt=ffp?prompt+' '+role:prompt.replace('The aligned motion guide supplies',role+'\nThe aligned motion guide supplies');
  }
  if(tara)prompt=prompt.replace('The aligned motion guide supplies','<Video 1> supplies');
  if(character){
    add(85,'CLIPLoader',{clip_name:'qwen3.5_9b_w4a8_gptq.safetensors',type:'minimax',device:'default'},'Describe the current photo, not a stored person or outfit');
    prompt=add(86,'TextGenerate',{clip:['85',0],image:['30',0],max_length:768,sampling_mode:'off',thinking:false,use_default_template:true,
      prompt:'Inspect only the attached reference photo. Write one English paragraph for a video renderer, beginning with body_swap:. '+
        'First write subject_definitions: and describe <Subject 1> in <Picture 1> with concrete visible facial proportions, eye shape and colour, nose, lips, jaw, hair colour, hairstyle and length, '+
        'visible body proportions, exact garment type, neckline, sleeves, fit, colour, fabric, patterns and accessories. Never guess identity, ethnicity, nationality, age or gender identity. '+
        'Omit anything hidden or uncertain. Do not beautify, invent details, smooth the skin or change clothing. '+
        'Then write summary: and detailed_description:. The subject and complete visible outfit must keep the appearance in <Picture 1> throughout the clip. '+
        'The aligned guide supplies only the body and hand motion, head rotation, gaze, mouth movement, expressions, timing and camera movement. '+
        'Follow them frame by frame without importing the original performer appearance or clothes. Preserve the picture natural texture, proportions, colours, lighting character and scene appearance. '+
        'A stationary guide camera stays stationary; reproduce actual pans, tilts, rolls, zooms and framing changes without adding any. '+
        'Output only that paragraph, no preface, Markdown or reasoning. Use real visible attributes from this image rather than generic placeholders.'},
      'One photo-derived character description shared by every render window');
  }
  add(40,'KSamplerSelect',{sampler_name:sampling.sampler});
  const samplingModel=tara?'9':focused?'10':'8';
  add(41,'BasicScheduler',{model:[samplingModel,0],scheduler:sampling.scheduler,steps:sampling.steps,denoise:1});
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
      prompt,
      width:source.canvasWidth,height:source.canvasHeight,length:seg.modelFrames,ref_image_size:'max',
      'ref_images.ref_image_1':reference,...(face?{'ref_images.ref_image_2':face}:{}),
      ...(tara?{'ref_videos.ref_video_1':guide}:{})},'Photo supplies full appearance in every segment');
    let continuation=null;
    if(seg.contextFrames&&previous){
      continuation=add(b+6,'ImageFromBatch',{image:previous.image,
        batch_index:previous.lastFrame-seg.contextFrames+1,length:seg.contextFrames});
    }
    if(anchored||(character&&continuation)){
      const count=continuation?seg.contextFrames:1;
      const rest=add(b+14,'ImageFromBatch',{image:guide,batch_index:count,length:seg.modelFrames-count});
      // Replace the conflicting source prefix; do not append a second guide
      // containing the original outfit at the same frame positions.
      guide=add(b+15,'ImageBatch',{image1:continuation||firstFrame,image2:rest},
        continuation?'Continue generated appearance on the exact source-time overlap':'Edited photo is frame zero of the guide');
    }
    let positive=tara?[String(b+4),0]:add(b+5,'MiniMaxH3AddGuide',{positive:[String(b+4),0],latent:[String(b+4),1],vae:['3',0],
      image:guide,frame_idx:0},'All aligned motion frames; no native reference-video duplicate');
    if(continuation&&!anchored&&!character){
      positive=add(b+7,'MiniMaxH3AddGuide',{positive,latent:[String(b+4),1],vae:['3',0],image:continuation,frame_idx:0},
        'Previous generated frames at matching source overlap');
    }
    const noise=add(b+8,'RandomNoise',{noise_seed:ffp?42:42+i});
    const guider=add(b+9,'CFGGuider',{model:[samplingModel,0],positive,negative:positive,cfg:1});
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
