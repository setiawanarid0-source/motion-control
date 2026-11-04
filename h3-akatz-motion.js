// Akatz's native Ref2VA image/video path, adapted to Vanta's final 1080 canvas.
// Relay is unavailable on the inspected worker. This is explicitly the
// native bounded-window variant, not an imitation of Relay's mask implementation.
import {prepareH3Input,probeH3Input,h3PhotoPlan,h3ModelFrames} from './minimax-h3-motion.js';
import {validUploadedH3Lora} from './h3-appearance-model.js';
import {randomInt} from 'node:crypto';

export const AKATZ_PROFILE='akatz-v1.5-native4-ref2v';
export const AKATZ_REVISION='akatz-native-1080-v6';
export const AKATZ_MAX_FRAMES=362;
export const AKATZ_WINDOW_FRAMES=124;
export const AKATZ_CONTEXT_FRAMES=5;
export const AKATZ_SAMPLING=Object.freeze({steps:4,sampler:'euler',scheduler:'simple',videoShift:12,audioShift:3});
export const AKATZ_OUTPUT_CRF=12;
export const AKATZ_ASSET=Object.freeze({
  name:'minimax_h3_akatz_character_swap_v1_5',
  url:'https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/0f409f0c2a18f123f3985041ec52982c813f5a9c/h3_character_swap_v1.5.safetensors',
  sha256:'8f2c3c3eba161df8d0c6099598b4730f641f5ce01e04cd16d2427cff8a35218f',size:155110792
});
export const AKATZ_TURBO_ASSET=Object.freeze({
  name:'minimax_h3_akatz_ref2v_turbo4_v0_1',
  url:'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/30f485ed874aa44c8183348ad361c5eabad318da/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  sha256:'5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c',size:1956193000
});
const V1_NODE_CLASSES=Object.freeze({
  1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',6:'RHLoraLoader',7:'RHLoraLoader',
  8:'MiniMaxH3SigmaShift',9:'ModelAttentionBackend',10:'BlockSparseAttention',
  30:'LoadImage',31:'ImagePadForOutpaint',33:'VHS_LoadVideo',34:'ImageFromBatch',
  35:'RepeatImageBatch',36:'ImageBatch',40:'KSamplerSelect',41:'BasicScheduler',50:'VHS_LoadAudioUpload',
  85:'CLIPLoader',86:'TextGenerate',87:'StringConcatenate',100:'MiniMaxH3ReferenceToVideo',101:'MiniMaxH3AddGuide',
  102:'RandomNoise',103:'CFGGuider',104:'SamplerCustomAdvanced',105:'LTXVSeparateAVLatent',
  106:'VAEDecode',107:'ImageFromBatch',108:'ImageCrop',490:'VHS_VideoCombine'
});
export const AKATZ_NODE_CLASSES=Object.freeze({
  1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',6:'RHLoraLoader',7:'RHLoraLoader',
  8:'MiniMaxH3SigmaShift',9:'ModelAttentionBackend',
  30:'LoadImage',31:'ImagePadForOutpaint',40:'KSamplerSelect',41:'BasicScheduler',49:'ImageBatchMulti',
  50:'VHS_LoadAudioUpload',85:'CLIPLoader',86:'TextGenerate',87:'StringConcatenate',490:'VHS_VideoCombine'
});
const WINDOW_NODE_CLASSES=['VHS_LoadVideo','ImageFromBatch','RepeatImageBatch','ImageBatch',
  'VHS_LoadAudioUpload','MiniMaxH3ReferenceToVideo','ImageFromBatch','MiniMaxH3AddGuide',
  'MiniMaxH3AddGuide','RandomNoise','CFGGuider','SamplerCustomAdvanced','LTXVSeparateAVLatent',
  'VAEDecode','ImageFromBatch','ImageCrop','MathExpression|pysssss'];
export function akatzNodeClass(node,plan){
  if(plan?.revision==='akatz-native-1080-v1')return V1_NODE_CLASSES[String(node)]||null;
  if(!['akatz-native-1080-v2','akatz-native-1080-v3','akatz-native-1080-v4','akatz-native-1080-v5',AKATZ_REVISION].includes(plan?.revision))return null;
  if(String(node)==='10'&&['akatz-native-1080-v2','akatz-native-1080-v3'].includes(plan.revision))return 'BlockSparseAttention';
  if(AKATZ_NODE_CLASSES[String(node)])return AKATZ_NODE_CLASSES[String(node)];
  const n=Number(node),index=Math.floor((n-1000)/40),offset=(n-1000)%40;
  if(offset===16&&!['akatz-native-1080-v5',AKATZ_REVISION].includes(plan.revision))return null;
  if(plan.revision===AKATZ_REVISION&&offset===6)return null;
  if(plan.revision===AKATZ_REVISION&&offset===7)return index>0&&index<plan.samplerCount?'MiniMaxH3MotionContext':null;
  return Number.isSafeInteger(n)&&n>=1000&&index<plan.samplerCount&&offset<WINDOW_NODE_CLASSES.length?
    WINDOW_NODE_CLASSES[offset]||null:null;
}
export async function prepareAkatzInput(video,mode,image){
  const probe=await probeH3Input(video,mode);
  if(probe.totalFrames>AKATZ_MAX_FRAMES)
    throw Error('Akatz Native menerima video 0,25–15 detik. Video tidak dipotong otomatis.');
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
  const cuts=source.sceneCuts||[];
  if(!Array.isArray(cuts)||cuts.some(n=>!Number.isSafeInteger(n)||n<=0||n>=source.totalFrames))
    throw Error('Batas scene Akatz tidak valid.');
  const segments=[];
  // The raw latent tail always ends at the MODEL end, not at inputFrames.
  // Fill every predecessor to the legal 124-frame grid. Only the final
  // window may have padding; it is never fed into another window.
  for(let start=0;start<source.totalFrames;){
    const contextFrames=start?AKATZ_CONTEXT_FRAMES:0;
    const length=Math.min(source.totalFrames-start,AKATZ_WINDOW_FRAMES-contextFrames);
    const inputFrames=length+contextFrames;
    segments.push({start,length,contextFrames,loadStart:start-contextFrames,inputFrames,
      modelFrames:h3ModelFrames(inputFrames),seed:(seed+segments.length)%2**32});
    start+=length;
  }
  if(segments.length*AKATZ_SAMPLING.steps>12)throw Error('Beban Akatz melampaui batas profil 15 detik. Task belum dikirim.');
  return {segments,seed};
}
export function akatzExecutionPlan(source){
  const p=plan(source);
  return {revision:AKATZ_REVISION,inferenceProfile:AKATZ_PROFILE,frames:source.totalFrames,fps:24,
    sampling:{...AKATZ_SAMPLING,character:'Akatz V1.5',turbo:'Ref2VA Turbo 4-step v0.1',
      characterSha256:AKATZ_ASSET.sha256,turboSha256:AKATZ_TURBO_ASSET.sha256},
    nativeWindowFrames:AKATZ_WINDOW_FRAMES,samplerCount:p.segments.length,seed:p.seed,
    seedTransport:'linked_int_expression_with_api_override',
    providerSeedVerification:'pending_output_metadata',
    workBudget:{totalSteps:p.segments.length*AKATZ_SAMPLING.steps,maxTotalSteps:12,
      targetSeconds:1500,providerHardLimitSeconds:2400,measuredRuntimeSeconds:null},
    canvas:[source.canvasWidth,source.canvasHeight],output:[source.outputWidth,source.outputHeight],
    driverCanvas:source.driverCanvas||null,driverGeometry:'original_pixels_with_grid_padding',
    referenceColor:source.referenceColor||null,guideAppearance:'akatz_native_video_reference',
    photoRole:'identity_hair_body_clothes_accessories_texture_and_scene_target',
    attentionConditioning:'dense_target_and_reference_all_steps',
    driverEncoding:source.driverEncoding||null,outputEncoding:{format:'video/h264-mp4',crf:AKATZ_OUTPUT_CRF},
    expressionConditioning:'source_video_timing_and_intensity_photo_identity_only',
    segments:p.segments.map(s=>({start:s.start,frames:s.length,inputFrames:s.inputFrames,
      loadStart:s.loadStart,modelFrames:s.modelFrames,contextFrames:s.contextFrames,seed:s.seed})),
    continuation:'sampler_av_latent_tail',continuationFrames:AKATZ_CONTEXT_FRAMES,
    continuationNode:'MiniMaxH3MotionContext',continuationVaeRoundTrips:0,
    predecessorPaddingFrames:0,workerSchemaGate:'typed_raw_latent_and_trim_output_required',
    gpuExecutionQualified:false,
    referenceVideoWindowed:true,peakWindowFrames:Math.max(...p.segments.map(s=>s.modelFrames)),
    relay:false,sourceBackplatePinned:false,postDecodeResize:false,postRefinement:false,
    visualAcceptance:'pending_owner_test'};
}
function inputName(value){
  if(typeof value!=='string'||!value||value.length>500||/[\u0000-\u001f\\]/.test(value)||
    value.startsWith('/')||value.includes('://')||value.split('/').includes('..'))throw Error('File Akatz tidak valid.');
}
// RunningHub resets seed widgets unless nodeInfoList preserves them. Its
// override of noise_seed previously arrived at RandomNoise as a string and
// failed inside the final sampler. Override a decimal STRING instead, then
// use MathExpression's INT output for the seed. Never replace this link with
// an API noise_seed override. This node already executes on the Vanta worker.
export function akatzSeedNodeInfo(source){
  return plan(source).segments.map((seg,i)=>({
    nodeId:String(1016+i*40),fieldName:'expression',fieldValue:String(seg.seed)
  }));
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
  add(8,'MiniMaxH3SigmaShift',{model:['9',0],shift_video:AKATZ_SAMPLING.videoShift,shift_audio:AKATZ_SAMPLING.audioShift});
  // The four-step student keeps its matched schedule. Use the existing dense
  // backend for every step, including fine-detail reconstruction: sparse target
  // approximations must not become the appearance carried into later windows.
  add(30,'LoadImage',{image:imageName});
  add(31,'ImagePadForOutpaint',{image:['30',0],left:0,top:0,right:source.referencePadRight,
    bottom:source.referencePadBottom,feathering:0});
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
    'At every corresponding video moment, reproduce the source facial expression and its intensity: eyebrow raises and furrows, eyelid opening and blinks, '+
    'eye direction, cheek movement, smiles, mouth corners, lip shape, mouth opening and speech articulation, with the same onset and release timing. '+
    'The photo defines facial identity and texture, not a frozen expression. Let those same facial features move with the video performance; '+
    'do not keep the photo smile or neutral mouth when the video expression changes. '+
    'keep a stationary source camera stationary. Do not stabilize, add drift or replace the moving pose with the photo pose. '+
    'Keep the same character and materials from the first frame to the last. Visible photo appearance: ';
  add(87,'StringConcatenate',{string_a:instructions,string_b:['86',0],delimiter:''});
  // Match the publisher's Ref2VA four-step student and native Comfy workflow;
  // do not truncate the previous FL2VA eight-step checkpoint to four steps.
  add(40,'KSamplerSelect',{sampler_name:AKATZ_SAMPLING.sampler});
  add(41,'BasicScheduler',{model:['8',0],scheduler:AKATZ_SAMPLING.scheduler,steps:AKATZ_SAMPLING.steps,denoise:1});
  const exports=[];let previous=null;
  for(const [i,seg] of p.segments.entries()){
    const b=1000+i*40,link=(offset,out=0)=>[String(b+offset),out];
    let driver=add(b,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
      frame_load_cap:seg.inputFrames,skip_first_frames:seg.loadStart,select_every_nth:1,format:'None'});
    if(seg.modelFrames>seg.inputFrames){
      const last=add(b+1,'ImageFromBatch',{image:driver,batch_index:seg.inputFrames-1,length:1});
      const pad=add(b+2,'RepeatImageBatch',{image:last,amount:seg.modelFrames-seg.inputFrames});
      driver=add(b+3,'ImageBatch',{image1:driver,image2:pad});
    }
    const audio=source.hasAudio?add(b+4,'VHS_LoadAudioUpload',{audio:videoName,
      start_time:seg.loadStart/24,duration:seg.inputFrames/24}):null;
    let positive=add(b+5,'MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt:['87',0],
      width:source.canvasWidth,height:source.canvasHeight,length:seg.modelFrames,ref_image_size:'max',
      'ref_images.ref_image_1':['31',0],'ref_videos.ref_video_1':driver,
      ...(audio?{'ref_video_audios.ref_video_audio_1':audio}:{})});
    if(previous&&seg.contextFrames){
      // Carry the original sampler AV latent, including the real temporal
      // phase. No decoded-image selection, resizing or VAE re-encoding.
      // Native reference conditioning (including the original photo) stays
      // on the incoming conditioning; source performance remains Video 1.
      positive=add(b+7,'MiniMaxH3MotionContext',{conditioning:positive,vae:['3',0],
        latent:link(5,1),context_latent:previous.latent,
        context_length:String(seg.contextFrames),audio_context_length:0});
    }
    if(audio)positive=add(b+8,'MiniMaxH3AddGuide',{positive,latent:link(5,1),audio_vae:['4',0],audio,frame_idx:0});
    add(b+16,'MathExpression|pysssss',{expression:String(seg.seed)});
    add(b+9,'RandomNoise',{noise_seed:link(16)});
    add(b+10,'CFGGuider',{model:['8',0],positive,negative:positive,cfg:1});
    add(b+11,'SamplerCustomAdvanced',{noise:link(9),guider:link(10),sampler:['40',0],sigmas:['41',0],latent_image:link(5,1)});
    add(b+12,'LTXVSeparateAVLatent',{av_latent:link(11)});
    const decoded=add(b+13,'VAEDecode',{samples:link(12),vae:['3',0]});
    previous={latent:link(11)};
    const trimmed=add(b+14,'ImageFromBatch',{image:decoded,batch_index:seg.contextFrames,length:seg.length});
    exports.push(add(b+15,'ImageCrop',{image:trimmed,width:source.outputWidth,height:source.outputHeight,x:source.padLeft,y:source.padTop}));
  }
  const images=exports.length===1?exports[0]:add(49,'ImageBatchMulti',{inputcount:exports.length,
    ...Object.fromEntries(exports.map((value,i)=>['image_'+(i+1),value]))});
  add(490,'VHS_VideoCombine',{images,...(source.hasAudio?{audio:['50',0]}:{}),frame_rate:24,loop_count:0,
    filename_prefix:'VANTA-H3-AKATZ-V1_5-NATIVE1080',format:'video/h264-mp4',pix_fmt:'yuv420p',crf:AKATZ_OUTPUT_CRF,
    save_metadata:true,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false});
  return g;
}

