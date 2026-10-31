// Isolated, NON-EXPLICIT short-clip comparison. Not a replacement for production H3.
// Recreates the aligned-guide conditioning from the user's BFS workflow using
// native nodes, with a head-specific adapter and inference at the export canvas.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {probeH3Input} from '../../minimax-h3.js';
const run=promisify(execFile);
export const REVIEW_MODELS=Object.freeze({
  unet:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae:'minimax_h3_video_vae_fp16.safetensors',
  audioVae:'minimax_h3_audio_vae_fp32.safetensors',
  turbo:'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors',
  head:'minimax_h3_head_swap_v1.0_r32.safetensors'
});
export function reviewPlan(source,mode){
  if(mode!=='plus')throw Error('Uji H3 aligned 1080p membutuhkan machine Plus.');
  if(!source||source.fps!==24||source.duration<.25||source.duration>5.05)
    throw Error('Uji H3 ini khusus klip non-eksplisit 0,25–5 detik.');
  const frames=source.totalFrames;
  if(!Number.isSafeInteger(frames)||frames<6||frames>121)throw Error('Frame uji H3 tidak valid.');
  const width=source.outputWidth,height=source.outputHeight;
  if(![width,height].every(v=>Number.isSafeInteger(v)&&v>=1080&&v%2===0)||Math.max(width,height)>2160)
    throw Error('Rasio video belum didukung pada uji 1080p ini.');
  const canvasWidth=Math.ceil(width/32)*32,canvasHeight=Math.ceil(height/32)*32;
  const modelFrames=5+17*Math.max(1,Math.ceil((frames-5)/17));
  return {fps:24,frames,modelFrames,outputWidth:width,outputHeight:height,
    canvasWidth,canvasHeight,padLeft:Math.floor((canvasWidth-width)/2),
    padTop:Math.floor((canvasHeight-height)/2)};
}
export async function prepareAlignedReview(file,mode){
  const source=await probeH3Input(file,mode),plan=reviewPlan(source,mode);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-aligned-'));
  const release=()=>fs.rm(dir,{recursive:true,force:true});
  const output=path.join(dir,'aligned-guide.mp4');
  try{
    const filter=`setpts=PTS-STARTPTS,fps=24,trim=end_frame=${plan.frames},`+
      `scale=${plan.outputWidth}:${plan.outputHeight}:flags=lanczos,setsar=1,`+
      `pad=${plan.canvasWidth}:${plan.canvasHeight}:${plan.padLeft}:${plan.padTop}:color=black,`+
      `tpad=stop_mode=clone:stop_duration=${(plan.modelFrames-plan.frames)/24}`;
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-i',file.path,
      '-map','0:v:0','-map','0:a:0?','-vf',filter,'-af',`atrim=end=${plan.frames/24},asetpts=PTS-STARTPTS`,
      '-frames:v',String(plan.modelFrames),'-t',String(plan.modelFrames/24),
      '-c:v','libx264','-preset','fast','-crf','16','-maxrate','12M','-bufsize','24M',
      '-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','192k','-movflags','+faststart',output],
      {timeout:120000,maxBuffer:65536});
    const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries',
      'stream=width,height,nb_frames,r_frame_rate','-of','json',output],{timeout:30000,maxBuffer:65536});
    const v=JSON.parse(stdout).streams?.[0],size=(await fs.stat(output)).size;
    if(v?.width!==plan.canvasWidth||v?.height!==plan.canvasHeight||
       Number(v?.nb_frames)!==plan.modelFrames||v?.r_frame_rate!=='24/1'||size>100*1024*1024)
      throw Error('Persiapan guide H3 tidak selaras; belum ada task berbayar.');
    return {...plan,file:{path:output,originalname:'aligned-guide.mp4',mimetype:'video/mp4',size},release};
  }catch(error){await release();throw error;}
}
function name(value){
  if(typeof value!=='string'||!value||value.length>500||/[\u0000-\u001f\\]/.test(value)||
    value.includes('://')||value.startsWith('/')||value.split('/').includes('..'))
    throw Error('Nama aset uji H3 tidak valid.');
  return value;
}
export function alignedReviewGraph({imageName,videoName,source,referenceDetails,models=REVIEW_MODELS}){
  name(imageName);name(videoName);for(const key of Object.keys(REVIEW_MODELS))name(models[key]);
  if(!source||source.fps!==24||
     !['frames','modelFrames','canvasWidth','canvasHeight','outputWidth','outputHeight','padLeft','padTop']
       .every(k=>Number.isSafeInteger(source[k]))||source.frames<6||source.frames>121||
     source.modelFrames!==5+17*Math.max(1,Math.ceil((source.frames-5)/17))||
     source.canvasWidth%32||source.canvasHeight%32||
     Math.min(source.outputWidth,source.outputHeight)!==1080||
     source.outputWidth%2||source.outputHeight%2||Math.max(source.outputWidth,source.outputHeight)>2160||
     source.canvasWidth!==Math.ceil(source.outputWidth/32)*32||
     source.canvasHeight!==Math.ceil(source.outputHeight/32)*32||
     source.padLeft!==Math.floor((source.canvasWidth-source.outputWidth)/2)||
     source.padTop!==Math.floor((source.canvasHeight-source.outputHeight)/2))
    throw Error('Metadata uji H3 belum tervalidasi.');
  const details=String(referenceDetails||'').trim();
  if(details.length<10||details.length>1200||/[\u0000-\u0008]/.test(details))
    throw Error('Uji ini membutuhkan deskripsi wajah/rambut dari gambar referensi yang sebenarnya.');
  const prompt='head_swap: subject_definitions: <Subject 1> is the head identity in <Picture 1>. '+
    'Facial details of <Subject 1>: '+details+'. '+
    '<Subject 2> is the original main person in the aligned guide <Video 1>. '+
    'summary: Replace only the complete head and hair of <Subject 2> with <Subject 1>. '+
    'retention_analysis: Preserve the original body, neck, clothing, hands, other people, objects, '+
    'camera, framing, motion, performance, expressions, lighting, background and timing. '+
    'detailed_description: Maintain the exact face shape, facial features, hairline, hairstyle, '+
    'hair color and hair length of <Subject 1> throughout. The head follows the original rotation, '+
    'scale, perspective and expressions and connects naturally to the source neck. '+
    'Match source illumination and shadows. Preserve occlusions and original scene details. '+
    'Do not transfer the reference outfit or body. Prevent identity drift and texture flicker.';
  const g={},n=(id,class_type,inputs,title)=>{g[id]={class_type,inputs,...(title?{_meta:{title}}:{})};return [id,0];};
  n('1','UNETLoader',{unet_name:models.unet,weight_dtype:'default'});
  n('2','CLIPLoader',{clip_name:models.clip,type:'minimax',device:'default'});
  n('3','VAELoader',{vae_name:models.videoVae});n('4','VAELoader',{vae_name:models.audioVae});
  n('5','LoraLoaderModelOnly',{model:['1',0],lora_name:models.turbo,strength_model:1},'BFS recipe · DMD 8-step');
  n('6','LoraLoaderModelOnly',{model:['5',0],lora_name:models.head,strength_model:1},'Head-specific aligned-guide adapter');
  n('7','MiniMaxH3SigmaShift',{model:['6',0],shift_video:12,shift_audio:3});
  n('30','LoadImage',{image:imageName});
  n('33','VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
    frame_load_cap:source.modelFrames,skip_first_frames:0,select_every_nth:1,format:'None'});
  n('40','MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt,
    width:source.canvasWidth,height:source.canvasHeight,length:source.modelFrames,
    ref_image_size:'max','ref_images.ref_image_0':['30',0]},'Picture identity only; source is NOT a native reference video');
  n('41','MiniMaxH3AddGuide',{positive:['40',0],latent:['40',1],vae:['3',0],audio_vae:['4',0],
    image:['33',0],audio:['33',2],frame_idx:0},'All aligned source frames · no truncated guide tail');
  n('42','RandomNoise',{noise_seed:42});
  n('43','CFGGuider',{model:['7',0],positive:['41',0],negative:['41',0],cfg:1});
  n('44','KSamplerSelect',{sampler_name:'euler'});
  n('45','BasicScheduler',{model:['7',0],scheduler:'simple',steps:8,denoise:1});
  n('46','SamplerCustomAdvanced',{noise:['42',0],guider:['43',0],sampler:['44',0],sigmas:['45',0],latent_image:['40',1]});
  n('47','VAEDecode',{samples:['46',0],vae:['3',0]});
  n('48','ImageFromBatch',{image:['47',0],batch_index:0,length:source.frames},'Remove H3 alignment padding frames');
  n('49','ImageCrop',{image:['48',0],width:source.outputWidth,height:source.outputHeight,
    x:source.padLeft,y:source.padTop},'Remove grid padding; no final image upscale');
  n('490','VHS_VideoCombine',{images:['49',0],audio:['33',2],frame_rate:24,loop_count:0,
    filename_prefix:'VANTA-H3-ALIGNED-REVIEW',format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,
    save_metadata:true,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false},
    'NON-EXPLICIT REVIEW · native output-size inference · quality unverified');
  return g;
}
