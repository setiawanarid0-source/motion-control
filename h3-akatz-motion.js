// Akatz's native Ref2VA image/video path, adapted to Vanta's final 1080 canvas.
// Relay is unavailable on the inspected worker. This is explicitly the native
// single-shot variant, not an imitation of Relay's mask/history implementation.
import {prepareH3Input,probeH3Input,h3PhotoPlan,h3ModelFrames} from './minimax-h3-motion.js';
import {validUploadedH3Lora} from './h3-appearance-model.js';
import {randomInt} from 'node:crypto';

export const AKATZ_PROFILE='akatz-v1.5-native8';
export const AKATZ_REVISION='akatz-native-1080-v1';
export const AKATZ_MAX_FRAMES=362;
export const AKATZ_ASSET=Object.freeze({
  name:'minimax_h3_akatz_character_swap_v1_5',
  url:'https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/0f409f0c2a18f123f3985041ec52982c813f5a9c/h3_character_swap_v1.5.safetensors',
  sha256:'8f2c3c3eba161df8d0c6099598b4730f641f5ce01e04cd16d2427cff8a35218f',size:155110792
});
export const AKATZ_TURBO_ASSET=Object.freeze({
  name:'minimax_h3_akatz_fl2v_turbo8',
  url:'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
  sha256:'08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980',size:1956193000
});
export const AKATZ_NODE_CLASSES=Object.freeze({
  1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',6:'RHLoraLoader',7:'RHLoraLoader',
  8:'MiniMaxH3SigmaShift',9:'ModelAttentionBackend',10:'BlockSparseAttention',
  30:'LoadImage',31:'ImagePadForOutpaint',33:'VHS_LoadVideo',34:'ImageFromBatch',
  35:'RepeatImageBatch',36:'ImageBatch',40:'KSamplerSelect',41:'BasicScheduler',50:'VHS_LoadAudioUpload',
  85:'CLIPLoader',86:'TextGenerate',87:'StringConcatenate',100:'MiniMaxH3ReferenceToVideo',101:'MiniMaxH3AddGuide',
  102:'RandomNoise',103:'CFGGuider',104:'SamplerCustomAdvanced',105:'LTXVSeparateAVLatent',
  106:'VAEDecode',107:'ImageFromBatch',108:'ImageCrop',490:'VHS_VideoCombine'
});
export async function prepareAkatzInput(video,mode,image){
  const probe=await probeH3Input(video,mode);
  if(probe.totalFrames>AKATZ_MAX_FRAMES)
    throw Error('Akatz Native menerima video 0,25–15 detik untuk satu render utuh. Video tidak dipotong otomatis.');
  const source=await prepareH3Input(video,mode,image,{inferenceProfile:AKATZ_PROFILE,identityFocus:false,nativeDriver:true});
  return {...source,seed:randomInt(0,2**32)};
}
function plan(source){
  if(source?.inferenceProfile!==AKATZ_PROFILE||source.fps!==24||typeof source.hasAudio!=='boolean'||
    !Number.isSafeInteger(source.totalFrames)||source.totalFrames<6||source.totalFrames>AKATZ_MAX_FRAMES)
    throw Error('Metadata Akatz Native tidak valid.');
  const expected=h3PhotoPlan(source.referenceWidth,source.referenceHeight);
  if(Object.entries(expected).some(([k,v])=>source[k]!==v))throw Error('Canvas Akatz Native tidak valid.');
  const seed=source.seed??42;
  if(!Number.isSafeInteger(seed)||seed<0||seed>=2**32)throw Error('Seed Akatz harus berupa bilangan bulat yang valid.');
  return {modelFrames:h3ModelFrames(source.totalFrames),seed};
}
export function akatzExecutionPlan(source){
  const p=plan(source);
  return {revision:AKATZ_REVISION,inferenceProfile:AKATZ_PROFILE,frames:source.totalFrames,fps:24,
    sampling:{steps:8,sampler:'er_sde',scheduler:'normal',character:'Akatz V1.5',
      turbo:'FL2V Turbo 8-step',characterSha256:AKATZ_ASSET.sha256,turboSha256:AKATZ_TURBO_ASSET.sha256},
    nativeWindowFrames:p.modelFrames,samplerCount:1,seed:p.seed,
    canvas:[source.canvasWidth,source.canvasHeight],output:[source.outputWidth,source.outputHeight],
    driverCanvas:source.driverCanvas||null,driverGeometry:'original_pixels_with_grid_padding',
    referenceColor:source.referenceColor||null,guideAppearance:'akatz_native_video_reference',
    photoRole:'identity_hair_body_clothes_accessories_texture_and_scene_target',
    attentionConditioning:'sol_after_20pct_exact_reference_kv',
    segments:[{start:0,frames:source.totalFrames,modelFrames:p.modelFrames,contextFrames:0}],
    relay:false,sourceBackplatePinned:false,postDecodeResize:false,postRefinement:false,
    visualAcceptance:'pending_owner_test'};
}
function inputName(value){
  if(typeof value!=='string'||!value||value.length>500||/[\u0000-\u001f\\]/.test(value)||
    value.startsWith('/')||value.includes('://')||value.split('/').includes('..'))throw Error('File Akatz tidak valid.');
}
export function akatzGraphForInputs({imageName,videoName,source,characterLoraFile,turboLoraFile}){
  inputName(imageName);inputName(videoName);const p=plan(source);
  if(!validUploadedH3Lora(characterLoraFile)||!validUploadedH3Lora(turboLoraFile))
    throw Error('Kedua model Akatz belum terpasang dengan benar. Task belum dikirim.');
  const g={},add=(id,class_type,inputs)=>{g[id]={class_type,inputs};return [String(id),0];};
  add(1,'UNETLoader',{unet_name:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:'minimax_h3_video_vae_fp16.safetensors'});
  add(4,'VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'});
  add(6,'RHLoraLoader',{model:['1',0],clip:['2',0],lora_name:'',file_name:turboLoraFile,strength_model:1,strength_clip:0});
  add(7,'RHLoraLoader',{model:['6',0],clip:['2',0],lora_name:'',file_name:characterLoraFile,strength_model:1,strength_clip:0});
  add(9,'ModelAttentionBackend',{model:['7',0],attention:'comfy kitchen attention'});
  add(8,'MiniMaxH3SigmaShift',{model:['9',0],shift_video:12,shift_audio:3});
  // Preserve exact image/video reference attention; accelerate target attention
  // after the opening steps. No output enhancement or shorter-step substitute.
  add(10,'BlockSparseAttention',{model:['8',0],selection:'sol-attn','selection.tau':1,
    start_percent:.2,end_percent:1,dense_blocks:'0,1',min_tokens:12288,extra_tokens:256,
    sink_conditioning:'exact_kv',verbose:true});
  add(30,'LoadImage',{image:imageName});
  add(31,'ImagePadForOutpaint',{image:['30',0],left:0,top:0,right:source.referencePadRight,
    bottom:source.referencePadBottom,feathering:0});
  let driver=add(33,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
    frame_load_cap:source.totalFrames,skip_first_frames:0,select_every_nth:1,format:'None'});
  if(p.modelFrames>source.totalFrames){
    add(34,'ImageFromBatch',{image:driver,batch_index:source.totalFrames-1,length:1});
    add(35,'RepeatImageBatch',{image:['34',0],amount:p.modelFrames-source.totalFrames});
    driver=add(36,'ImageBatch',{image1:driver,image2:['35',0]});
  }
  if(source.hasAudio)add(50,'VHS_LoadAudioUpload',{audio:videoName,start_time:0,duration:source.totalFrames/24});
  add(85,'CLIPLoader',{clip_name:'qwen3.5_9b_w4a8_gptq.safetensors',type:'minimax',device:'default'});
  add(86,'TextGenerate',{clip:['85',0],image:['30',0],max_length:512,sampling_mode:'off',thinking:false,
    use_default_template:true,prompt:'Describe only the attached photo in concise English: visible facial details, hair colour, style and length, '+
      'skin colour, visible garments and their exact colours, neckline, sleeves, material and pattern, visible accessories and hand coverings, '+
      'and visible scene and illumination. Describe only what can actually be seen. Do not invent watches, jewellery, clothing, hidden body parts, '+
      'identity, age or ethnicity. Do not estimate, reshape or beautify the body. Do not describe a different photo or a video. '+
      'Return only the visible appearance description, without headings, instructions or reasoning.'});
  const instructions='Animate the subject and scene shown in <Picture 1> using the performance and camera trajectory in <Video 1>. '+
    'Use the current photo as the appearance reference throughout: the same face and individual facial features, hair style, colour and length, '+
    'skin tone, natural shadows, body proportions and volume, exact outfit, accessories and natural skin and fabric texture. '+
    'Do not borrow the video performer identity, hair, body shape, clothes, wrist accessories or other appearance details. '+
    'Keep the photo scene and illumination character; do not import unrelated video objects, add jewellery, alter garments, smooth textures or apply artificial bokeh. '+
    'Transfer the video body and hand motion, head movement, gaze and performance timing. Follow the source camera, including genuine shake, roll and framing changes; '+
    'keep a stationary source camera stationary. Do not stabilize, add drift or replace the moving pose with the photo pose. '+
    'Keep the same character and materials from the first frame to the last. Visible photo appearance: ';
  add(87,'StringConcatenate',{string_a:instructions,string_b:['86',0],delimiter:''});
  add(100,'MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt:['87',0],
    width:source.canvasWidth,height:source.canvasHeight,length:p.modelFrames,ref_image_size:'max',
    'ref_images.ref_image_1':['31',0],'ref_videos.ref_video_1':driver,
    ...(source.hasAudio?{'ref_video_audios.ref_video_audio_1':['50',0]}:{})});
  const positive=source.hasAudio?add(101,'MiniMaxH3AddGuide',{positive:['100',0],latent:['100',1],
    audio_vae:['4',0],audio:['50',0],frame_idx:0}):['100',0];
  add(40,'KSamplerSelect',{sampler_name:'er_sde'});
  add(41,'BasicScheduler',{model:['10',0],scheduler:'normal',steps:8,denoise:1});
  add(102,'RandomNoise',{noise_seed:p.seed});
  add(103,'CFGGuider',{model:['10',0],positive,negative:positive,cfg:1});
  add(104,'SamplerCustomAdvanced',{noise:['102',0],guider:['103',0],sampler:['40',0],sigmas:['41',0],latent_image:['100',1]});
  add(105,'LTXVSeparateAVLatent',{av_latent:['104',0]});
  add(106,'VAEDecode',{samples:['105',0],vae:['3',0]});
  add(107,'ImageFromBatch',{image:['106',0],batch_index:0,length:source.totalFrames});
  add(108,'ImageCrop',{image:['107',0],width:source.outputWidth,height:source.outputHeight,x:source.padLeft,y:source.padTop});
  add(490,'VHS_VideoCombine',{images:['108',0],...(source.hasAudio?{audio:['50',0]}:{}),frame_rate:24,loop_count:0,
    filename_prefix:'VANTA-H3-AKATZ-V1_5-NATIVE1080',format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,
    save_metadata:true,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false});
  return g;
}
