// Spatial editing inside native H3 sampling. No decoded output is composited.
import fs from 'node:fs';

export const AKATZ_SUBJECT_MASK_REVISION='akatz-native-1080-turbo8-subject-mask-v1';
export const AKATZ_SUBJECT_MASK_FILENAME='VANTA_AKATZ_MASK_SUBJEK_RUNNINGHUB.json';
export const AKATZ_SUBJECT_MASK_CHECKPOINT='sam3.1_multiplex_fp16.safetensors';
export const AKATZ_SUBJECT_MASK_SCHEMAS=JSON.parse(fs.readFileSync(
  new URL('./workflows/runninghub-akatz-subject-mask-node-schemas.json',import.meta.url),'utf8')).nodes;
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const reserved=new Set(['760060','900001','900002','900003']);

export function parseAkatzSubjectMaskOption(workflow,value,expression,faceControl){
  if(value==null||value==='')return false;
  if(!['true','false'].includes(value))throw Error('Pilihan mask subjek Akatz tidak valid.');
  if(value==='true'&&(workflow!=='minimaxH3Akatz'||expression||faceControl))
    throw Error('Mask subjek hanya tersedia pada Akatz V1.5 Native dan dipilih terpisah dari uji mimik/ControlNet.');
  return value==='true';
}

export function withAkatzSubjectMask(baseline,source,segments){
  if(source.akatzSubjectMask!==true)return baseline;
  if(source.akatzExpression===true||source.akatzFaceControl===true||source.fps!==24||!segments?.length)
    throw Error('Pilihan atau timeline mask subjek Akatz tidak valid.');
  const graph=structuredClone(baseline);
  if(graph['3']?.class_type!=='VAELoader'||graph['30']?.class_type!=='LoadImage')
    throw Error('Basis mask subjek tidak sesuai Akatz.');
  let next=Math.max(...Object.keys(graph).map(Number))+1;
  const add=(class_type,inputs)=>{
    while(graph[String(next)]||reserved.has(String(next)))next++;
    const id=String(next++);graph[id]={class_type,inputs};return [id,0];
  };
  // This is the same SAM checkpoint already used by MotionFly, not its video
  // model. The H3 model, LoRAs, prompt, reference paths and sampler stay intact.
  const sam=add('CheckpointLoaderSimple',{ckpt_name:AKATZ_SUBJECT_MASK_CHECKPOINT});
  const subject=add('CLIPTextEncode',{clip:[sam[0],1],text:'person'});
  for(const s of segments){
    const ref=graph[String(s.base+5)],sampler=graph[String(s.base+11)];
    if(ref?.class_type!=='MiniMaxH3ReferenceToVideo'||ref.inputs.length!==124||
      sampler?.class_type!=='SamplerCustomAdvanced'||
      JSON.stringify(sampler.inputs.latent_image)!==JSON.stringify([String(s.base+5),1])||
      !edge(ref.inputs['ref_videos.ref_video_1']))
      throw Error('Sambungan window mask subjek tidak sesuai basis.');
    // The base can append one redundant tail frame to a full window. Native
    // reference encoding trims it internally; source VAE/masks must do so too.
    const frames=add('ImageFromBatch',{image:structuredClone(ref.inputs['ref_videos.ref_video_1']),batch_index:0,length:124});
    // Only this source-latent input copy is aligned to the generation canvas.
    // Keep aspect ratio with padding; never resize or refine decoded delivery.
    const canvas=add('ImageResizeKJv2',{image:frames,width:source.canvasWidth,height:source.canvasHeight,
      upscale_method:'lanczos',keep_proportion:'pad',pad_color:'0, 0, 0',crop_position:'center',divisible_by:1,device:'cpu'});
    // Tracking is bounded per sampler window, including its source overlap.
    const track=add('SAM3_VideoTrack',{images:canvas,model:sam,conditioning:subject,
      detection_threshold:0.5,max_objects:1,detect_interval:1});
    const mask=add('SAM3_TrackToMask',{track_data:track,object_indices:''});
    // Do not silently turn a completely missed subject into an unchanged
    // source plate. A close-up may legitimately occupy the entire canvas.
    const checked=add('SAM3_ValidateMask',{mask,min_ratio:0.001,max_ratio:1});
    const expanded=add('GrowMask',{mask:checked,expand:64,tapered_corners:true});
    // auto reads the actual H3 VAE's 1,4,4,4,4 cycle, token drop and 2x2
    // DiT cells. A pixel-frame batch must not be interpolated across time.
    const reduced=add('MVEx_MaskToLatentSpace',{masks:expanded,compression:'auto',vae:['3',0],
      spatial_method:'max',temporal_method:'max',grow_spatial:0,grow_temporal:0,grow_temp_mode:'both'});
    const encoded=add('VAEEncode',{pixels:canvas,vae:['3',0]});
    const masked=add('LTXVSetVideoLatentNoiseMasks',{samples:encoded,masks:reduced});
    // These are generic AV packing operators, explicitly supporting H3.
    // Keep the target's audio shape and metadata; leave audio fully denoisable.
    const target=add('LTXVSeparateAVLatent',{av_latent:structuredClone(sampler.inputs.latent_image)});
    const av=add('LTXVConcatAVLatent',{video_latent:masked,audio_latent:[target[0],1]});
    sampler.inputs.latent_image=av;
  }
  return graph;
}

export function akatzSubjectMaskPlan(source,segments){
  return {revision:AKATZ_SUBJECT_MASK_REVISION,role:'spatial_edit_mask_during_sampling',
    characterSource:'uploaded_edited_first_frame',performanceSource:'original_rgb_video_reference',
    sourceLatent:'VAEEncode_aligned_original_video',mask:'SAM3_single_person',
    samCheckpoint:AKATZ_SUBJECT_MASK_CHECKPOINT,trackingScope:'per_window',maxObjects:1,
    detectionThreshold:0.5,detectInterval:1,emptyMaskPolicy:'reject_window_mean_below_0.001',
    expansionPixels:64,compression:'H3_VAE_auto',temporalReduction:'max',spatialReduction:'max',
    videoMaskShape:'B,1,T,H/16,W/16',audioSource:'native_H3_target_audio_latent',
    audioDenoiseMask:'ones',sourceCanvas:[source.canvasWidth,source.canvasHeight],
    sourceCanvasFit:'conditioning_only_aspect_preserving_pad',
    windowRanges:segments.map(s=>({loadStart:s.loadStart,inputFrames:s.inputFrames,modelFrames:124})),
    firstFrameGuidePreserved:true,rawMotionContextPreserved:true,postOutputRefinement:false,
    hardPerFrameFacialControl:false,gpuExecutionQualified:false,visualAcceptance:'pending_owner_test'};
}

export function akatzSubjectMaskEditorSchemas(){
  const result={};
  for(const [name,node] of Object.entries(AKATZ_SUBJECT_MASK_SCHEMAS)){
    const inputs=[],defaults={},widgetOrder=[];
    for(const group of ['required','optional'])for(const [key,spec] of Object.entries(node.input[group]||{})){
      const type=spec[0],config=spec[1]||{},combo=Array.isArray(type)||type==='COMBO';
      const dynamic=type==='COMFY_DYNAMICCOMBO_V3';
      const widget=combo||dynamic||['INT','FLOAT','BOOLEAN','STRING'].includes(type);
      inputs.push({name:key,type:combo?'COMBO':type,...(group==='optional'?{shape:7}:{}),
        ...(widget?{widget:{name:key}}:{})});
      if(widget){
        const choices=Array.isArray(type)?type:config.options;
        defaults[key]=config.default??(dynamic?choices?.[0]?.key:choices?.[0])??
          (type==='STRING'?'':type==='BOOLEAN'?false:0);
        widgetOrder.push(key);
      }
    }
    result[name]={inputs,outputs:node.output.map((type,i)=>({name:node.output_name?.[i]||type,type})),defaults,widgetOrder};
  }
  return result;
}
