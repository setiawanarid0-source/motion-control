// Experimental face-performance conditioning, inside the existing H3 job.
// Only conditioning copies are cropped. Native decoded output is untouched.
import fs from 'node:fs';

export const AKATZ_EXPRESSION_REVISION='akatz-native-1080-turbo8-expression-v2-framealigned';
export const AKATZ_EXPRESSION_LEGACY_REVISION='akatz-native-1080-turbo8-expression-v1';
export const AKATZ_EXPRESSION_FILENAME='VANTA_AKATZ_UJI_MIMIK_RUNNINGHUB.json';
export const AKATZ_EXPRESSION_SCHEMAS=JSON.parse(fs.readFileSync(
  new URL('./workflows/runninghub-akatz-expression-node-schemas.json',import.meta.url),'utf8')).nodes;
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const reserved=new Set(['760060','900001','900002','900003']);

export function parseAkatzExpressionOption(workflow,value){
  if(value==null||value==='')return false; // Existing clients keep their baseline.
  if(!['true','false'].includes(value))throw Error('Pilihan uji mimik Akatz tidak valid.');
  if(value==='true'&&workflow!=='minimaxH3Akatz')throw Error('Uji mimik hanya tersedia untuk Akatz V1.5 Native.');
  return value==='true';
}

const facePrompt='The aligned <Video 2> has the same full-frame composition, subject scale and camera trajectory as <Video 1>; '+
  'only its facial performance has been retargeted to the character in <Picture 1>. '+
  'At each matching moment use it for eyebrow and eyelid motion, blinks, gaze, cheeks, mouth and lip articulation, '+
  'and expression onset, intensity and release. Preserve the facial identity, facial proportions, hair and skin texture of <Picture 1>. '+
  '<Video 1> remains the reference for body and hand movement, head trajectory, scene timing, camera motion and genuine camera shake. '+
  'Keep a single continuous full-frame shot matching <Video 1>, with the character appearance of <Picture 1>. ';
const identityCaption='Describe only stable visible appearance in the attached photo: facial structure, eye shape and colour, '+
  'eyebrow shape, nose and lip structure, hair colour, style and length, skin tone, exact garments, fabric, accessories, '+
  'and the visible scene and illumination. Omit the current facial expression, smiles or frowns, mouth opening, '+
  'eyelid opening, gaze direction, head angle and pose: those will be supplied by the performance videos. '+
  'Do not invent objects, identity, age, ethnicity, hidden details or beauty changes. Return only the appearance description.';

export function withAkatzExpression(baseline,source,segments){
  if(source.akatzExpression!==true)return baseline;
  if(!Array.isArray(segments)||!segments.length||source.fps!==24)throw Error('Timeline uji mimik belum valid.');
  const graph=structuredClone(baseline);
  if(graph['30']?.class_type!=='LoadImage'||graph['86']?.class_type!=='TextGenerate'||
    graph['87']?.class_type!=='StringConcatenate')throw Error('Basis uji mimik tidak sesuai Akatz.');
  let next=Math.max(...Object.keys(graph).map(Number))+1;
  const add=(class_type,inputs)=>{
    while(graph[String(next)]||reserved.has(String(next)))next++;
    const id=String(next++);graph[id]={class_type,inputs};return [id,0];
  };
  const pipeline=add('DownloadAndLoadLivePortraitModels',{precision:'fp16',mode:'human'});
  const cropper=add('LivePortraitLoadMediaPipeCropper',{landmarkrunner_onnx_device:'CPU',keep_model_loaded:true});
  // Source appearance features are extracted ONCE, from the single photo.
  // LivePortraitCropper is intentionally not run on every driving frame.
  const sourceCrop=add('LivePortraitCropper',{pipeline,cropper,source_image:['30',0],dsize:512,
    scale:2.3,vx_ratio:0,vy_ratio:-0.125,face_index:0,face_index_order:'large-small',rotate:true});
  let globalAnchor;
  for(const [index,s] of segments.entries()){
    const ref=graph[String(s.base+5)],batch=graph[String(s.base+3)];
    if(ref?.class_type!=='MiniMaxH3ReferenceToVideo'||batch?.class_type!=='ImageBatch'||!edge(batch.inputs.image1)||
      s.inputFrames<1||s.inputFrames>124)throw Error('Sambungan window uji mimik tidak sesuai basis.');
    // Keep the existing bounded source slice, before its repeated tail padding.
    const tracked=add('H3FaceTrackCrop',{images:structuredClone(batch.inputs.image1),
      detector:'face_yolov8m.pt',confidence:0.35,crop_factor:2.3,
      canvas_width:512,canvas_height:512,canvas_mode:'manual',smooth_window:5,size_smooth_window:9,
      smooth_method:'gaussian',size_mode:'per_frame',select:'largest_face',select_index:0,
      identity_track:false,fallback_detector:'none',cut_detection:'none',absent_shots:'off'});
    if(index===0)globalAnchor=add('ImageFromBatch',{image:tracked,batch_index:0,length:1});
    // LP relative motion anchors to its first driving frame. Prepending the
    // SAME original frame 0 to EVERY call prevents a reset at each H3 window.
    const driving=add('ImageBatch',{image1:globalAnchor,image2:tracked});
    const face=add('LivePortraitProcess',{pipeline,crop_info:[sourceCrop[0],1],source_image:['30',0],
      driving_images:driving,lip_zero:false,lip_zero_threshold:0.03,stitching:true,delta_multiplier:1,
      mismatch_method:'constant',relative_motion_mode:'relative',driving_smooth_observation_variance:0.000003,
      expression_friendly:true,expression_friendly_multiplier:1});
    const faceCrops=add('ImageFromBatch',{image:face,batch_index:1,length:s.inputFrames});
    // A detached square face clip is a global H3 video reference, NOT a local
    // face control. It leaked its close-up composition into the v1 render.
    // Restore the face into the SAME unpadded driving frames before ref2.
    // Stitching is only on this conditioning copy, never the decoded output.
    let performance=add('H3FaceStitch',{base_images:structuredClone(batch.inputs.image1),
      refined_crops:faceCrops,transform:[tracked[0],1],paste_region:'face_ellipse',
      mask_dilation:0,feather:8,colour_match:0,blend:1,undetected_frames:'fade_out',
      feather_scales_with_crop:false});
    if(s.inputFrames<124){
      const last=add('ImageFromBatch',{image:performance,batch_index:s.inputFrames-1,length:1});
      const pad=add('RepeatImageBatch',{image:last,amount:124-s.inputFrames});
      performance=add('ImageBatch',{image1:performance,image2:pad});
    }
    ref.inputs['ref_videos.ref_video_2']=performance;
  }
  const marker='Visible photo appearance: ',prompt=graph['87'].inputs.string_a;
  if(typeof prompt!=='string'||!prompt.endsWith(marker))throw Error('Pengikat prompt uji mimik tidak sesuai basis.');
  graph['87'].inputs.string_a=prompt.slice(0,-marker.length)+facePrompt+marker;
  graph['86'].inputs.prompt=identityCaption;
  return graph;
}

export function akatzExpressionPlan(source,segments){
  if(source.akatzExpression!==true)return null;
  return {revision:AKATZ_EXPRESSION_REVISION,role:'full_frame_face_performance_reference',
    characterSource:'uploaded_edited_first_frame',drivingSource:'original_video_face_crops',
    globalDrivingAnchorFrame:0,relativeMode:'relative',expressionFriendly:true,
    photoFeatureExtractions:1,drivingFeatureCropper:'H3FaceTrackCrop',
    maxDrivingFramesPerCall:125,prefixFramesRemoved:1,temporalExpressionSmoothing:false,
    windowRanges:segments.map(s=>({loadStart:s.loadStart,inputFrames:s.inputFrames,referenceFrames:124})),
    facialCropSize:[512,512],referenceVideoSize:[source.canvasWidth,source.canvasHeight],
    referenceFraming:'original_full_frame_video',facialOutputRole:'conditioning_only',
    framingRestoration:{node:'H3FaceStitch',position:'per_frame_tracking_transform',
      base:'same_unpadded_source_window',region:'face_ellipse',colourMatch:0,
      undetectedFrames:'fade_out',beforeTailPadding:true,detachedCropReference:false},
    sourceCameraRole:'original_full_frame_video',postOutputRefinement:false,
    semanticConditioning:true,hardPerFrameFacialControl:false,gpuExecutionQualified:false,visualAcceptance:'pending_owner_test'};
}

// Convert the actual registry declarations into editor port/widget definitions.
// Autogrow's prefix and max live INSIDE template on the installed V3 schema.
export function akatzExpressionEditorSchemas(){
  const result={};
  for(const [name,node] of Object.entries(AKATZ_EXPRESSION_SCHEMAS)){
    const inputs=[],defaults={},widgetOrder=[];
    for(const group of ['required','optional'])for(const [key,spec] of Object.entries(node.input[group]||{})){
      const type=spec[0],config=spec[1]||{};
      if(type==='COMFY_AUTOGROW_V3'){
        const t=config.template,entry=Object.values(t.input.required)[0];
        for(let i=t.min||0;i<t.max;i++)inputs.push({name:key+'.'+t.prefix+i,type:entry[0],shape:7});
        continue;
      }
      const combo=Array.isArray(type)||type==='COMBO';
      const widget=combo||['INT','FLOAT','BOOLEAN','STRING'].includes(type);
      inputs.push({name:key,type:combo?'COMBO':type,...(group==='optional'?{shape:7}:{}),
        ...(widget?{widget:{name:key}}:{})});
      if(widget){
        const choices=Array.isArray(type)?type:config.options;
        defaults[key]=config.default??choices?.[0]??(type==='STRING'?'':type==='BOOLEAN'?false:0);
        widgetOrder.push(key);
      }
    }
    result[name]={inputs,outputs:node.output.map((type,i)=>({name:node.output_name?.[i]||type,type})),defaults,widgetOrder};
  }
  return result;
}
