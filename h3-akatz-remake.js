// Adaptation of the active recipe in akatz-labs/h3-character-swap-tool.
// Full-resolution reference operators replace the installed conditioner's
// 736-pixel guard. Text tokenization/precision differences are disclosed below.
import {h3PhotoPlan,prepareH3Input} from './minimax-h3-motion.js';
import {AKATZ_PROFILE} from './h3-akatz-motion.js';
import {assertAkatzBaseline} from './h3-akatz-options.js';
import {runningHubWorkflowContent} from './runninghub-workflow-content.js';

export const REMAKE_LEGACY_REVISION='akatz-source-viggle-remake-65e798f-v1';
export const REMAKE_PREVIOUS_REVISION='akatz-source-viggle-remake-65e798f-v2';
export const REMAKE_REVISION='akatz-source-viggle-remake-65e798f-v3';
export const REMAKE_SOURCE='https://github.com/akatz-labs/h3-character-swap-tool';
export const REMAKE_COMMIT='65e798fa778b58ee4abc77251b58ec35c086db89';
export const REMAKE_EDITOR_FILENAME='VANTA_AKATZ_SOURCE_VIGGLE_REMAKE_6STEP_RUNNINGHUB.json';
// Actual RunningHub task 2122281866291929089 rejected 39 frames with this
// runtime range. An INT connection does not remove the worker's own guard.
// Keep this platform contract separate from the upstream recipe parameters.
export const REMAKE_WORKER_FRAMES=Object.freeze({min:90,max:345,step:17,offset:5});
export const REMAKE_RECIPE=Object.freeze({
  model:'minimax_h3_fl2va_int8_convrot.safetensors',
  lora:'viggle-remake/comfyui/viggle_remake_swap_comfyui.safetensors',
  loraSha256:'9967f1cd71a81d9263d1148e3eebb951e24579d9388b9ae671b966ca1f0a1c3b',
  loraUrl:'https://huggingface.co/Viggle/Viggle-Remake/resolve/7e5be143702dd53b9154482de673b8519ed2d4d6/comfyui/viggle_remake_swap_comfyui.safetensors',
  // Unique content-labelled basename prevents collision with older swap files.
  workerLora:'vanta_viggle_remake_swap_9967f1cd71a81d92.safetensors',
  strength:1,steps:6,sampler:'euler',
  sigmas:Object.freeze([1,0.990476,0.965243,0.923077,0.8,0.631579,0]),
  keyframeUntil:0.9,window:124,history:18,fps:24,seed:194731
});
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const file=v=>typeof v==='string'&&v.length>0&&v.length<=500&&!/[\u0000-\u001f\\]/.test(v)&&
  !v.startsWith('/')&&!v.includes('://')&&!v.split('/').includes('..');
const invalid=message=>Object.assign(new Error(message),{code:'AKATZ_REMAKE_INPUT_INVALID',definitelyRejected:true});
const roundEven=n=>{const i=Math.floor(n);return n-i===0.5?i+i%2:Math.round(n);};

// The source concatenates separately tokenized labels. Stock CLIPTextEncode
// accepts one text string instead. Preserve the presentation and text-only
// modality, while recording this tokenization difference in the plan.
export function remakePresentation(frames){
  const times=Array.from({length:Math.ceil(frames/12)},(_,i)=>i/2);
  if(times.length%2)times.push(times.at(-1));
  const labels=[];
  for(let i=0;i<times.length;i+=2)labels.push('<'+(roundEven((times[i]+times[i+1])*5)/10).toFixed(1)+' seconds>');
  return '<Video 1>: '+labels.join('')+'<Picture 1>: '+remakePrompt();
}

const fullReference=(name,reference,port,frames)=>({name,mode:'Full Reference',concept_type:'generic',
  background_retention:1,ref_resolution:['42',0],pool_h:16,pool_w:16,latent_frames:frames,identity:0,
  merge:false,motion_only:false,multiplier:1,max_tokens:0,description:'',save:false,
  vae:['3',0],extraction_preset:'manual',subfolder:'',budget_policy:'error',[port]:reference});
const fullApply=(conditioning,mods)=>({conditioning,mods,override:false,retention:1,
  curve_direction:'constant',scramble_seed:-1,curve_shape:'linear',curve_value:1,
  graph_preset:'(none)',scramble_mode:'shuffle',scramble_keep:1,max_total_tokens:0,save_preset_as:''});

export function prepareRemakeInput(video,mode,image){
  // Remake reads its output canvas directly from source pixels. Old Turbo8
  // lets ReferenceToVideo resize the driver later, so that preflight cannot
  // be reused unchanged here. Align only the driver copy, with CRF12 intact.
  return prepareH3Input(video,mode,image,{inferenceProfile:AKATZ_PROFILE,identityFocus:false,nativeDriver:true,
    alignDriverToPhoto:true,maxSeconds:null,maxGuideBytes:null,detectScenes:false});
}

export function remakeTemporalPlan(source){
  assertAkatzBaseline(source);
  if(!Number.isSafeInteger(source?.totalFrames)||source.totalFrames<6||source.fps!==24||typeof source.hasAudio!=='boolean')
    throw invalid('Metadata video Akatz belum valid.');
  for(const key of ['canvasWidth','canvasHeight','outputWidth','outputHeight'])
    if(!Number.isSafeInteger(source[key])||source[key]<64||source[key]>8192)throw invalid('Canvas Akatz belum valid.');
  for(const key of ['referenceWidth','referenceHeight'])
    if(!Number.isSafeInteger(source[key])||source[key]<64||source[key]>8192)throw invalid('Ukuran foto Akatz belum valid.');
  if(source.canvasWidth%32||source.canvasHeight%32||Math.min(source.outputWidth,source.outputHeight)!==1080||
    source.outputWidth>source.canvasWidth||source.outputHeight>source.canvasHeight)throw invalid('Ukuran native Akatz belum valid.');
  if(source.driverCanvas&&(source.driverCanvas[0]!==source.canvasWidth||source.driverCanvas[1]!==source.canvasHeight))
    throw invalid('Canvas video panduan Akatz belum sejajar dengan canvas generasi.');
  for(const key of ['padLeft','padTop'])if(!Number.isSafeInteger(source[key])||source[key]<0||source[key]>31)
    throw invalid('Padding Akatz belum valid.');
  const segments=[];
  for(let start=0;start<source.totalFrames;){
    const history=start?REMAKE_RECIPE.history:0;
    const delivered=Math.min(REMAKE_RECIPE.window-history,source.totalFrames-start);
    const inputFrames=history+delivered;
    const {min,max,step,offset}=REMAKE_WORKER_FRAMES;
    const modelFrames=offset+step*Math.ceil((Math.max(min,inputFrames)-offset)/step);
    if(modelFrames>max)throw invalid('Segmen Akatz melampaui batas frame node RunningHub.');
    const index=segments.length;
    segments.push({index,base:10000+index*100,start,end:start+delivered,loadStart:start-history,
      delivered,history,inputFrames,modelFrames,paddedTail:modelFrames-inputFrames,latentFrames:2+(modelFrames-5)/17*5,
      seed:REMAKE_RECIPE.seed});
    start+=delivered;
  }
  return {window:REMAKE_RECIPE.window,history:REMAKE_RECIPE.history,segments};
}

export function remakePrompt(){
  // Same six-section presentation as remake_render.model_prompt; the owner's
  // edited first-frame image supplies the complete requested character edit.
  return [
    'subject_definitions: <Video 1> supplies the source people, motion and scene. <Picture 1> supplies the target character appearance. It is the edited first frame of this same video.',
    'summary: The source performance with the target character appearance from <Picture 1>.',
    'retention_analysis: Retain source motion, timing, camera movement and shake, framing, background, lighting and shadows except where the character appearance in <Picture 1> requests a change.',
    'detailed_description: Replace the subject with the character in <Picture 1>, preserving the edited face, hair, body proportions, clothing and other appearance details consistently throughout the video. Follow the source facial performance, expressions, gaze, blinks, mouth movements, body motion and timing. Preserve natural skin detail and source scene continuity.',
    'overall_soundscape: Retain the source soundtrack and speech timing.',
    'non_diegetic_music: Retain any source music.'
  ].join('\n');
}

export function remakeGraphForInputs({imageName,videoName,source}){
  if(!file(imageName)||!file(videoName))throw invalid('Nama media Akatz belum valid.');
  const plan=remakeTemporalPlan(source),g={};
  const add=(id,class_type,inputs)=>{id=String(id);if(g[id])throw Error('ID Akatz ganda.');g[id]={class_type,inputs};return [id,0];};
  add(1,'UNETLoader',{unet_name:REMAKE_RECIPE.model,weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:'minimax_h3_video_vae_fp16.safetensors'});
  add(4,'VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'});
  // SDVN downloads first, then the stock loader's zero-strength early return
  // leaves both base weights and CLIP untouched. The next loader applies the
  // pinned Viggle adapter through the source's exact bypass implementation.
  add(6,'SDVN Lora Download',{model:['1',0],clip:['2',0],Download_url:REMAKE_RECIPE.loraUrl,
    Lora_url_name:REMAKE_RECIPE.workerLora,strength_model:0,strength_clip:0});
  add(9,'PrimitiveString',{value:REMAKE_RECIPE.workerLora});
  add(8,'easy anythingIndexSwitch',{index:0,value0:['9',0]});
  add(7,'LoraLoaderBypassModelOnly',{model:['6',0],lora_name:['8',0],strength_model:REMAKE_RECIPE.strength});
  add(10,'RemakeKeyframeUntil',{model:['7',0],keyframe_until:REMAKE_RECIPE.keyframeUntil});
  add(30,'LoadImage',{image:imageName});
  add(31,'ImageFromBatch',{image:['30',0],batch_index:0,length:1});
  const shortEdge=Math.min(source.canvasWidth,source.canvasHeight);
  const refWidth=Math.max(32,roundEven(source.referenceWidth*shortEdge/Math.min(source.referenceWidth,source.referenceHeight)/32)*32);
  const refHeight=Math.max(32,roundEven(source.referenceHeight*shortEdge/Math.min(source.referenceWidth,source.referenceHeight)/32)*32);
  add(32,'ImageScale',{image:['31',0],upscale_method:'lanczos',width:refWidth,height:refHeight,crop:'disabled'});
  add(33,'MiniMaxH3RefModExtract',fullReference('vanta_akatz_picture',['32',0],'refs_image.ref_image_1',1));
  add(40,'KSamplerSelect',{sampler_name:REMAKE_RECIPE.sampler});
  add(41,'ManualSigmas',{sigmas:REMAKE_RECIPE.sigmas.join(', ')});
  // Full Reference supports this 1088 short edge. Never send it to the
  // installed RemakeConditioning, which enforces a 736-pixel cap.
  add(42,'PrimitiveInt',{value:shortEdge});
  const delivered=[];
  for(const s of plan.segments){
    const b=s.base,n=(offset,type,inputs)=>add(b+offset,type,inputs);
    let pixels=n(0,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
      frame_load_cap:s.inputFrames,skip_first_frames:s.loadStart,select_every_nth:1,format:'None'});
    if(s.paddedTail){
      const last=n(1,'ImageFromBatch',{image:pixels,batch_index:s.inputFrames-1,length:1});
      const tail=n(2,'RepeatImageBatch',{image:last,amount:s.paddedTail});
      pixels=n(3,'ImageBatch',{image1:pixels,image2:tail});
    }
    const frameCount=n(4,'PrimitiveInt',{value:s.modelFrames});
    const text=n(12,'CLIPTextEncode',{clip:['2',0],text:remakePresentation(s.modelFrames)});
    const videoRef=n(14,'MiniMaxH3RefModExtract',fullReference('vanta_akatz_video_'+s.index,pixels,'refs_video.ref_video_1',s.modelFrames));
    const withVideo=n(15,'MiniMaxH3RefModApply',fullApply(text,videoRef));
    let positive=n(5,'MiniMaxH3RefModApply',fullApply(withVideo,['33',0]));
    const empty=n(17,'EmptyMiniMaxH3LatentAV',{width:source.canvasWidth,height:source.canvasHeight,length:frameCount});
    const audioMask=n(18,'SolidMask',{value:0,width:1,height:1});
    const audioSamples=Math.ceil(Math.round((s.modelFrames+1)/24*32000)/800)*800;
    // Add one spare silence sample, then trim with the native rounded sample
    // clock. This avoids float truncation and the audio VAE's centre crop.
    const silence=n(54,'EmptyAudio',{duration:(audioSamples+1)/32000,sample_rate:32000,channels:2});
    let audio=silence;
    if(source.hasAudio){
      const cropped=n(50,'TrimAudioDuration',{audio:[String(b),2],start_index:0,duration:s.modelFrames/24});
      const resampled=n(51,'AudioResample',{audio:cropped,new_sample_rate:32000});
      audio=n(55,'AudioConcat',{audio1:resampled,audio2:silence,direction:'after'});
    }
    const padded=n(56,'TrimAudioDuration',{audio,start_index:0,duration:audioSamples/32000});
    const encodedAudio=n(57,'VAEEncodeAudio',{audio:padded,vae:['4',0]});
    const cutAudio=n(58,'LatentCut',{samples:encodedAudio,dim:'x',index:0,amount:Math.round(s.modelFrames/24*40)});
    const heldAudio=n(59,'SetLatentNoiseMask',{samples:cutAudio,mask:audioMask});
    let latent=n(19,'LTXVConcatAVLatent',{video_latent:empty,audio_latent:heldAudio});
    if(s.history){
      const previous=plan.segments[s.index-1];
      const history=n(20,'ImageFromBatch',{image:[String(previous.base+11),0],batch_index:previous.delivered-18,length:18});
      const first17=n(21,'ImageFromBatch',{image:history,batch_index:0,length:17});
      const lastClean=n(22,'ImageFromBatch',{image:history,batch_index:16,length:1});
      const pad5=n(23,'RepeatImageBatch',{image:lastClean,amount:5});
      const prefixPixels=n(24,'ImageBatch',{image1:first17,image2:pad5});
      const encoded=n(25,'VAEEncode',{pixels:prefixPixels,vae:['3',0]});
      const clean5=n(26,'LatentCut',{samples:encoded,dim:'t',index:0,amount:5});
      const split=n(27,'LTXVSeparateAVLatent',{av_latent:latent});
      const zero5=n(28,'LatentCut',{samples:split,dim:'t',index:0,amount:5});
      // Keep target metadata/mask and dtype while inserting the clean prefix.
      const prefix=n(29,'LatentAdd',{samples1:zero5,samples2:clean5});
      const tail=n(30,'LatentCut',{samples:split,dim:'t',index:5,amount:s.latentFrames-5});
      const joined=n(31,'LatentConcat',{samples1:prefix,samples2:tail,dim:'t'});
      const black=n(32,'SolidMask',{value:0,width:1,height:1});
      const blackImage=n(33,'MaskToImage',{mask:black});
      const five=n(34,'RepeatImageBatch',{image:blackImage,amount:5});
      const white=n(35,'SolidMask',{value:1,width:1,height:1});
      const whiteImage=n(36,'MaskToImage',{mask:white});
      const maskImages=n(37,'ImageBatch',{image1:five,image2:whiteImage});
      const masks=n(38,'ImageToMask',{image:maskImages,channel:'red'});
      const masked=n(39,'LTXVSetVideoLatentNoiseMasks',{samples:joined,masks});
      latent=n(43,'LTXVConcatAVLatent',{video_latent:masked,audio_latent:[String(b+27),1]});
      const boundary=n(44,'ImageFromBatch',{image:history,batch_index:17,length:1});
      positive=n(45,'MiniMaxH3AddGuide',{positive,latent,vae:['3',0],image:boundary,frame_idx:17});
    }
    const noise=n(6,'RemakeNoise',{positive,seed:s.seed});
    const guider=n(7,'BasicGuider',{model:['10',0],conditioning:positive});
    const sampled=n(8,'SamplerCustomAdvanced',{noise,guider,sampler:['40',0],sigmas:['41',0],latent_image:latent});
    const split=n(9,'LTXVSeparateAVLatent',{av_latent:sampled});
    const decoded=n(10,'VAEDecode',{samples:split,vae:['3',0]});
    delivered.push(n(11,'ImageFromBatch',{image:decoded,batch_index:s.history,length:s.delivered}));
  }
  let nextJoin=800000;
  function join(items){
    if(items.length===1)return items[0];
    const middle=Math.ceil(items.length/2);
    return add(nextJoin++,'ImageBatch',{image1:join(items.slice(0,middle)),image2:join(items.slice(middle))});
  }
  const frames=add(49,'ImageCrop',{image:join(delivered),width:source.outputWidth,height:source.outputHeight,x:source.padLeft,y:source.padTop});
  if(source.hasAudio)add(50,'VHS_LoadAudioUpload',{audio:videoName,start_time:0,duration:0});
  const final={images:frames,frame_rate:24,loop_count:0,filename_prefix:'VANTA_AKATZ_SOURCE_VIGGLE_REMAKE',
    format:'video/h264-mp4',pix_fmt:'yuv420p',crf:12,save_metadata:true,trim_to_audio:false,pingpong:false,
    no_preview:false,...(source.hasAudio?{audio:['50',0]}:{})};
  add(490,'VHS_VideoCombine',{...final,save_output:true});
  add(493,'VHS_VideoCombine',{...final,save_output:false});
  add(494,'VHS_SelectFilename',{filenames:['493',0],index:-1});
  add(496,'CompressImages',{'images or video_path':['494',0],filename_prefix:'VANTA_AKATZ_SOURCE_VIDEO_ZIP',image_format:'PNG',password:''});
  for(const [id,index] of [[5103,0],[5104,Math.floor((source.totalFrames-1)/2)],[5105,source.totalFrames-1]])
    add(id,'ImageFromBatch',{image:frames,batch_index:index,length:1});
  add(5106,'ImageBatch',{image1:['5103',0],image2:['5104',0]});
  add(5107,'ImageBatch',{image1:['5106',0],image2:['5105',0]});
  add(5108,'CompressImages',{'images or video_path':['5107',0],filename_prefix:'VANTA_AKATZ_3_FRAME_PNG',image_format:'PNG',password:''});
  return g;
}

export function remakeExecutionPlan(source){
  const p=remakeTemporalPlan(source),graph=remakeGraphForInputs({imageName:'inspection.png',videoName:'inspection.mp4',source});
  return {revision:REMAKE_REVISION,sourceRepository:REMAKE_SOURCE,sourceCommit:REMAKE_COMMIT,
    inferenceProfile:source.inferenceProfile,frames:source.totalFrames,fps:24,canvas:[source.canvasWidth,source.canvasHeight],
    output:[source.outputWidth,source.outputHeight],sampling:{...REMAKE_RECIPE},segments:p.segments,samplerCount:p.segments.length,
    nativeWindowFrames:p.window,workerFrameRange:{...REMAKE_WORKER_FRAMES},
    continuationFrames:18,continuation:'generated_rgb_17_clean_plus_1_boundary',
    conditioningAdapter:'native_1080_full_reference_composition',
    textPresentation:'text_only_joint_tokenization',sourceTextTokenization:'per_segment',referenceLatentDtype:'float16',
    appearance:'edited_first_frame_as_picture_reference',firstFrameGuide:false,durationStrategy:'automatic_bounded_windows',
    applicationMaxSeconds:null,postDecodeResize:false,postRefinement:false,sourceAudioHeldClean:true,
    memoryPolicy:'RunningHub_native_automatic_offloading',perSegmentMp4RoundTrip:false,
    nodeClasses:Object.fromEntries(Object.entries(graph).map(([id,n])=>[id,n.class_type])),
    workBudget:{totalSteps:p.segments.length*6,measuredRuntimeSeconds:null,providerHardLimitSeconds:null},
    frameDiagnostics:{zipNode:'5108',positions:['first','middle','last']},
    gpuExecutionQualified:false,visualAcceptance:'pending_owner_test'};
}

export function remakeEditorForFrames({frames=360,width=1080,height=1920}={}){
  const source={...h3PhotoPlan(width,height),totalFrames:frames,fps:24,hasAudio:true};
  const graph=remakeGraphForInputs({imageName:'UPLOAD_EDITED_FIRST_FRAME.png',videoName:'UPLOAD_SOURCE_VIDEO.mp4',source});
  const editor=JSON.parse(runningHubWorkflowContent(graph));
  editor.extra.vanta_export={source_revision:REMAKE_REVISION,source_repository:REMAKE_SOURCE,source_commit:REMAKE_COMMIT,
    conditioning_adapter:'native_1080_full_reference_composition',text_tokenization:'joint_text_only',reference_latent_dtype:'float16',
    preset_frames:frames,preset_seconds:frames/24,generation_window_frames:124,continuation_frames:18,
    worker_frame_range:{...REMAKE_WORKER_FRAMES},
    automatic_window_count:true,generation_executed:false,visual_acceptance:'pending_owner_test'};
  return editor;
}

export function remakeNodeClass(id,plan){
  return [REMAKE_REVISION,REMAKE_PREVIOUS_REVISION,REMAKE_LEGACY_REVISION].includes(plan?.revision)?plan.nodeClasses?.[String(id)]||null:null;
}
