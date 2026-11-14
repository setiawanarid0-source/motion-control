// Experimental H3 Fun ControlNet branch. All face images below are control
// inputs to the sampler; the native decoded delivery path is never composited.
import fs from 'node:fs';

export const AKATZ_FACE_CONTROL_REVISION='akatz-native-1080-turbo8-face-controlnet-v1';
export const AKATZ_FACE_CONTROL_FILENAME='VANTA_AKATZ_CONTROLNET_WAJAH_RUNNINGHUB.json';
export const AKATZ_FACE_CONTROL_PATCH='minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors';
export const AKATZ_FACE_CONTROL_SCHEMAS=JSON.parse(fs.readFileSync(
  new URL('./workflows/runninghub-akatz-face-control-node-schemas.json',import.meta.url),'utf8')).nodes;
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const reserved=new Set(['760060','900001','900002','900003']);
const cropSettings={dsize:512,scale:2.3,vx_ratio:0,vy_ratio:-0.125,
  face_index:0,face_index_order:'large-small',rotate:true};
const trackSettings={detector:'face_yolov8m.pt',confidence:0.35,crop_factor:2.3,
  canvas_width:512,canvas_height:512,canvas_mode:'manual',smooth_window:5,size_smooth_window:9,
  smooth_method:'gaussian',size_mode:'per_frame',select:'largest_face',select_index:0,
  identity_track:false,fallback_detector:'none',cut_detection:'none',absent_shots:'off'};

export function parseAkatzFaceControlOption(workflow,value,expressionEnabled){
  if(value==null||value==='')return false;
  if(!['true','false'].includes(value))throw Error('Pilihan ControlNet wajah Akatz tidak valid.');
  if(value==='true'&&(workflow!=='minimaxH3Akatz'||expressionEnabled!==true))
    throw Error('ControlNet wajah memerlukan mode mimik Akatz V1.5 Native.');
  return value==='true';
}

export function withAkatzFaceControl(baseline,source,segments){
  if(source.akatzFaceControl!==true)return baseline;
  if(source.akatzExpression!==true||source.fps!==24||!Array.isArray(segments)||!segments.length)
    throw Error('Timeline ControlNet wajah Akatz belum valid.');
  const graph=structuredClone(baseline);
  if(graph['30']?.class_type!=='LoadImage'||graph['86']?.class_type!=='TextGenerate'||
    graph['87']?.class_type!=='StringConcatenate'||graph['3']?.class_type!=='VAELoader')
    throw Error('Basis ControlNet wajah tidak sesuai Akatz.');
  let next=Math.max(...Object.keys(graph).map(Number))+1;
  const add=(class_type,inputs)=>{
    while(graph[String(next)]||reserved.has(String(next)))next++;
    const id=String(next++);graph[id]={class_type,inputs};return [id,0];
  };
  const patch=add('ModelPatchLoader',{name:AKATZ_FACE_CONTROL_PATCH});
  const pipeline=add('DownloadAndLoadLivePortraitModels',{precision:'fp16',mode:'human'});
  const cropper=add('LivePortraitLoadMediaPipeCropper',{landmarkrunner_onnx_device:'CPU',keep_model_loaded:true});
  // Establish one photo coordinate space. LP's canonical crop is NOT the same
  // as H3FaceTrackCrop's square; its inverse transform must be applied below.
  const photo=add('H3FaceTrackCrop',{images:['30',0],...trackSettings});
  const sourceCrop=add('LivePortraitCropper',{pipeline,cropper,source_image:photo,...cropSettings});
  let globalAnchor;
  for(const [index,s] of segments.entries()){
    const batch=graph[String(s.base+3)],guider=graph[String(s.base+10)],ref=graph[String(s.base+5)];
    if(batch?.class_type!=='ImageBatch'||!edge(batch.inputs.image1)||guider?.class_type!=='CFGGuider'||
      !edge(guider.inputs.model)||ref?.class_type!=='MiniMaxH3ReferenceToVideo'||
      s.inputFrames<1||s.inputFrames>124||ref.inputs['ref_videos.ref_video_2'])
      throw Error('Sambungan window ControlNet wajah tidak sesuai basis.');
    const original=structuredClone(batch.inputs.image1);
    const tracked=add('H3FaceTrackCrop',{images:original,...trackSettings});
    // Match LP crop framing/scale, but preserve driving roll. Counter-rotating
    // EVERY driving face would erase its roll before motion extraction. The
    // photo's inverse warp restores its initial angle after the relative delta.
    // Each driving feature cropper remains bounded to 124 frames.
    const canonical=add('LivePortraitCropper',{pipeline,cropper,source_image:tracked,...cropSettings,rotate:false});
    if(index===0)globalAnchor=add('ImageFromBatch',{image:canonical,batch_index:0,length:1});
    const driving=add('ImageBatch',{image1:globalAnchor,image2:canonical});
    const face=add('LivePortraitProcess',{pipeline,crop_info:[sourceCrop[0],1],source_image:photo,
      driving_images:driving,lip_zero:false,lip_zero_threshold:0.03,stitching:true,delta_multiplier:1,
      mismatch_method:'constant',relative_motion_mode:'relative',driving_smooth_observation_variance:0.000003,
      expression_friendly:true,expression_friendly_multiplier:1});
    // Composite uses LP_OUT (including M_c2o) for every frame. Remove the
    // prepended anchor AFTER this inverse warp, not before the LP_OUT loop.
    const restored=add('LivePortraitComposite',{source_image:photo,cropped_image:face,liveportrait_out:[face[0],1]});
    const aligned=add('ImageFromBatch',{image:restored,batch_index:1,length:s.inputFrames});
    const canny=add('Canny',{image:aligned,low_threshold:0.1,high_threshold:0.2});
    // LP crop failure produces an all-black canonical frame. Gate that frame
    // instead of giving ControlNet a fabricated face. A 1x1 per-frame mask is
    // broadcast by native ImageCompositeMasked, as in Comfy's implementation.
    const mean=add('ImageScale',{image:canonical,upscale_method:'area',width:1,height:1,crop:'disabled'});
    const meanMask=add('ImageToMask',{image:mean,channel:'red'});
    const valid=add('ThresholdMask',{mask:meanMask,value:0.01});
    const blackCrop=add('EmptyImage',{width:512,height:512,batch_size:s.inputFrames,color:0});
    const gated=add('ImageCompositeMasked',{destination:blackCrop,source:canny,x:0,y:0,resize_source:false,mask:valid});
    // Runtime source dimensions matter: the native video may have a different
    // resolution from the edited photo. Keep tracker coordinates in its own
    // canvas; the native control node performs the model-canvas encoding.
    const size=add('GetImageSize',{image:original});
    const blackCanvas=add('EmptyImage',{width:size,height:[size[0],1],batch_size:s.inputFrames,color:0});
    let control=add('H3FaceStitch',{base_images:blackCanvas,refined_crops:gated,transform:[tracked[0],1],
      paste_region:'face_ellipse',mask_dilation:0,feather:0,colour_match:0,blend:1,
      undetected_frames:'fade_out',feather_scales_with_crop:false});
    if(s.inputFrames<124){
      const last=add('ImageFromBatch',{image:control,batch_index:s.inputFrames-1,length:1});
      const pad=add('RepeatImageBatch',{image:last,amount:124-s.inputFrames});
      control=add('ImageBatch',{image1:control,image2:pad});
    }
    // A separate patched MODEL per window prevents another segment's control
    // video from replacing this one. Native mask/source_video are inpainting
    // inputs, not spatial residual gates, and intentionally remain absent.
    const controlled=add('MiniMaxH3FunControlNetApply',{model:structuredClone(guider.inputs.model),
      model_patch:patch,vae:['3',0],strength:1,start_percent:0,end_percent:1,control_video:control});
    guider.inputs.model=controlled;
  }
  const marker='Visible photo appearance: ',prompt=graph['87'].inputs.string_a;
  if(typeof prompt!=='string'||!prompt.endsWith(marker))throw Error('Pengikat prompt ControlNet wajah tidak sesuai basis.');
  graph['87'].inputs.string_a=prompt.slice(0,-marker.length)+
    'The per-frame facial control follows the facial performance timing of <Video 1>, retargeted to the character in <Picture 1>. '+
    'Follow its eyebrow and eyelid motion, blinks, gaze, cheeks, mouth articulation and expression changes. '+
    'Keep the facial identity and appearance of <Picture 1>. Preserve the full-frame composition, body and hand motion, '+
    'head trajectory, camera movement and genuine camera shake of <Video 1>. '+marker;
  graph['86'].inputs.prompt='Describe only stable visible appearance in the attached photo: facial structure, eye shape and colour, '+
    'eyebrow shape, nose and lip structure, hair colour, style and length, skin tone, exact garments, fabric, accessories, '+
    'and the visible scene and illumination. Omit the current facial expression, smiles or frowns, mouth opening, '+
    'eyelid opening, gaze direction, head angle and pose: those will be supplied by the performance video. '+
    'Do not invent objects, identity, age, ethnicity, hidden details or beauty changes. Return only the appearance description.';
  return graph;
}

export function akatzFaceControlPlan(source,segments){
  return {revision:AKATZ_FACE_CONTROL_REVISION,role:'model_patch_face_edge_control',
    patch:AKATZ_FACE_CONTROL_PATCH,applyNode:'MiniMaxH3FunControlNetApply',
    strength:1,startPercent:0,endPercent:1,perWindowModel:true,
    characterSource:'uploaded_edited_first_frame',drivingSource:'original_video_face_crops',
    globalDrivingAnchorFrame:0,relativeMode:'relative',expressionFriendly:true,
    drivingRotationNormalized:false,photoRotationRestoredByInverseWarp:true,
    photoFeatureExtractions:1,drivingFeatureCropper:'LivePortraitCropper_after_H3FaceTrackCrop',
    maxDrivingCropFramesPerCall:124,maxDrivingFramesPerCall:125,prefixFramesRemoved:1,
    inverseCropWarp:'LivePortraitComposite_before_prefix_removal',
    controlMap:{type:'Canny',lowThreshold:0.1,highThreshold:0.2,background:'black',
      region:'face_ellipse',framing:'runtime_original_source_canvas',
      invalidCropGate:'canonical_mean_red_above_0.01',undetectedFrames:'fade_out'},
    windowRanges:segments.map(s=>({loadStart:s.loadStart,inputFrames:s.inputFrames,controlFrames:124})),
    inpaintMask:false,extraSemanticVideoReference:false,facialOutputRole:'conditioning_only',
    postOutputRefinement:false,hardPerFrameFacialControl:false,
    gpuExecutionQualified:false,visualAcceptance:'pending_owner_test'};
}
