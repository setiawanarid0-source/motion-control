// Candidate for controlled GPU screening; not the ordinary generation default.
// Full source RGB reaches pose analysis only. An optional, private face-crop
// reference tests facial acting; it is never a full-frame appearance guide.
// Continuation guides contain generated frames, never source RGB.
export const NATIVE_POSE_MODELS=Object.freeze({
  unet:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  clip:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae:'minimax_h3_video_vae_fp16.safetensors',audioVae:'minimax_h3_audio_vae_fp32.safetensors',
  turbo:'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  patch:'minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors',
  pose:'sdpose_wholebody_fp16.safetensors',detector:'rt_detr_v4-x-hgnet_fp16.safetensors',
  caption:'qwen3.5_9b_w4a8_gptq.safetensors'
});
const fileName=v=>typeof v==='string'&&v.length>0&&v.length<500&&!v.startsWith('/')&&
  !v.includes('://')&&!v.split('/').includes('..')&&!/[\u0000-\u001f\\]/.test(v);
export function nativePoseCandidateGraph({imageName,videoName,source,segments,models=NATIVE_POSE_MODELS,recipe='native4',retarget=false,visualDetails=false,facePerformance=false,faceGuard=false,attributes=false,globalAttention=false,diagnostics=true}){
  if(!['native4','dmd8'].includes(recipe))throw Error('Invalid pose sampling recipe');
  if(visualDetails&&!retarget)throw Error('Detailed pose needs whole-sequence retargeting');
  if(facePerformance&&!visualDetails)throw Error('Face performance needs the detailed pose candidate');
  if(faceGuard&&!facePerformance)throw Error('Face guard needs the facial performance candidate');
  if(attributes&&!faceGuard)throw Error('Attribute inventory needs guarded face performance');
  if(globalAttention&&!attributes)throw Error('Global native shot needs the guarded attribute recipe');
  const dmd8=recipe==='dmd8';
  if(!fileName(imageName)||!fileName(videoName))throw Error('Invalid input filename');
  for(const key of Object.keys(NATIVE_POSE_MODELS))if(!fileName(models[key])||!models[key].endsWith('.safetensors'))
    throw Error('Missing or invalid native pose model: '+key);
  if(!source||source.fps!==24||typeof source.hasAudio!=='boolean'||!Array.isArray(segments)||!segments.length||
    ![source.canvasWidth,source.canvasHeight].every(n=>Number.isSafeInteger(n)&&n>=1080&&n%32===0)||
    Math.min(source.outputWidth,source.outputHeight)!==1080)throw Error('Invalid native output plan');
  let next=0;
  for(const [i,s] of segments.entries()){
    if(s.start!==next||s.contextFrames!==(i?(visualDetails?22:5):0)||s.loadStart+s.contextFrames!==s.start||
      s.modelFrames%17!==5||s.modelFrames>(globalAttention?362:124)||s.inputFrames>s.modelFrames||s.inputFrames!==s.length+s.contextFrames)
      throw Error('Invalid pose window timeline');
    next+=s.length;
  }
  if(next!==source.totalFrames)throw Error('Incomplete pose timeline');
  const g={},add=(id,class_type,inputs,title)=>{const key=String(id);g[key]={class_type,inputs,...(title?{_meta:{title}}:{})};return [key,0];};
  add(1,'UNETLoader',{unet_name:models.unet,weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:models.clip,type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:models.videoVae});add(4,'VAELoader',{vae_name:models.audioVae});
  add(6,'LoraLoaderModelOnly',{model:['1',0],lora_name:dmd8?'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors':models.turbo,strength_model:1});
  if(dmd8)add(8,'MiniMaxH3SigmaShift',{model:['6',0],shift_video:12,shift_audio:3});
  if(globalAttention){
    add(9,'ModelAttentionBackend',{model:[dmd8?'8':'6',0],attention:'comfy kitchen attention'});
    add(10,'BlockSparseAttention',{model:['9',0],selection:'sol-attn','selection.tau':1,start_percent:0,end_percent:1,
      dense_blocks:'0,1',min_tokens:12288,extra_tokens:256,sink_conditioning:'exact_kv',verbose:true},
      'Experimental full-shot acceleration; exact reference KV, dense first two blocks; visual QA required');
  }
  add(13,'ModelPatchLoader',{name:models.patch});
  add(16,'CheckpointLoaderSimple',{ckpt_name:models.pose});
  add(17,'UNETLoader',{unet_name:models.detector,weight_dtype:'default'});
  add(30,'LoadImage',{image:imageName});
  add(31,'ImagePadForOutpaint',{image:['30',0],left:0,top:0,right:source.referencePadRight,bottom:source.referencePadBottom,feathering:0},
    'Native reference pixels; only grid padding');
  if(!visualDetails){
  add(85,'CLIPLoader',{clip_name:models.caption,type:'minimax',device:'default'});
  add(86,'TextGenerate',{clip:['85',0],image:['30',0],max_length:768,sampling_mode:'off',thinking:false,use_default_template:true,
    prompt:'Describe only the current reference photo in one detailed English video-generation caption. '+
      'Describe the visible face, hair, unexaggerated body build and proportions, exact outfit and accessories, garment material and surface detail, '+
      'the complete setting and the actual lighting direction, contrast and colours. Omit unseen or uncertain details. '+
      'Picture 1 defines the entire appearance of the generated person and scene. Animate it using the aligned pose control, including the hands, head and facial expression. '+
      'Preserve the reference body proportions, clothing, fabric texture, skin detail and lighting through that motion. '+
      'Keep the camera behaviour and performance timing of the pose sequence. Add no accessories or objects, no smoothing, beauty changes or invented wardrobe. '+
      'Output only the caption using actual visible image attributes, no Markdown or prefatory explanation.'});
  }
  let appearancePrompt=visualDetails?
    'Animate the same person and complete scene in <Picture 1>, following the aligned pose sequence at the same times. '+
    '<Picture 1> alone defines the face, facial geometry, hair, unaltered body proportions, outfit, fabric weave, skin detail, '+
    'accessories, background, colours and lighting. Retain these visible photographic attributes. '+
    'Transfer the pose sequence\'s body and hand actions, head motion, gaze, mouth opening, facial expressions, timing and camera motion. '+
    'Preserve the intensity and timing of the facial acting; do not hold the still photo\'s neutral expression. '+
    'Do not reshape, beautify, smooth or restyle the person. Add no objects or accessories. '+
    'Keep exposure, colour temperature, garment material and scene illumination continuous throughout.': ['86',0];
  if(facePerformance)appearancePrompt+=' <Video 1> is a tightly cropped facial performance at the matching times. '+
    'Transfer its mouth movement, eye movements, gaze and facial expression to the person in <Picture 1>. '+
    'The facial performance is not an appearance reference: retain <Picture 1>\'s face, hair, skin, makeup and lighting. '+
    'Preserve the performance\'s mouth opening and expression changes instead of keeping the still photo\'s neutral expression.';
  if(attributes){
    add(85,'CLIPLoader',{clip_name:models.caption,type:'minimax',device:'default'});
    add(86,'TextGenerate',{clip:['85',0],image:['30',0],max_length:384,sampling_mode:'off',thinking:false,use_default_template:true,
      prompt:'Inspect only this current reference photo. Write a concise factual English inventory of its visible appearance. '+
        'Describe actual hair colour, length and style; every visible clothing piece, its colour, material, sleeve and hem coverage; '+
        'hand coverings including any gloves, belts, jewellery and other visible accessories; the setting and actual lighting. '+
        'Check both hands and wrists carefully. State only visible facts and visible coverage; do not infer items hidden out of frame. '+
        'Do not describe body shape, body measurements, attractiveness, age, pose or performance. Do not beautify or reinterpret the outfit. '+
        'Output a single plain paragraph of at most 140 words, no Markdown and no generation instructions.'});
    const fixed=appearancePrompt+' Preserve the complete garment coverage and every visible accessory in <Picture 1>, '+
      'including hand coverings. Any bare fingers or skin seen in the performance clip supply action only; '+
      'they must not remove gloves or change the reference outfit. The following inventory describes <Picture 1> only, '+
      'while its native pixels continue to define all body proportions and facial geometry.';
    appearancePrompt=add(87,'StringConcatenate',{string_a:fixed,string_b:['86',0],delimiter:'\nReference photo inventory: '});
    if(diagnostics)add(495,'SaveText',{text:['86',0],filename_prefix:'VANTA-PHOTO-INVENTORY-QA',format:'txt'});
  }
  add(40,'KSamplerSelect',{sampler_name:dmd8?'euler':'res_multistep'});
  let facialSequence=null;
  if(retarget){
    // One whole-sequence fit prevents a different body-ratio solve at every join.
    // Resizing here is solely for keypoint analysis. Native appearance stays on 30 -> 31.
    const analysisHeight=visualDetails?source.canvasHeight/2:1024;
    const analysisWidth=visualDetails?source.canvasWidth/2:Math.round(source.canvasWidth/source.canvasHeight*analysisHeight);
    add(60,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',
      custom_width:visualDetails?analysisWidth:0,custom_height:visualDetails?analysisHeight:0,
      frame_load_cap:source.totalFrames,skip_first_frames:0,select_every_nth:1,format:'None'});
    const resized=(id,image)=>add(id,'ImageScale',{image,upscale_method:'lanczos',width:analysisWidth,height:analysisHeight,crop:'disabled'});
    const guideAnalysis=resized(61,['60',0]),photoAnalysis=resized(64,['30',0]);
    for(const [id,analysis] of [[62,guideAnalysis],[65,photoAnalysis]]){
      const boxes=add(id,'RTDETR_detect',{model:['17',0],image:analysis,threshold:.5,class_name:'person',max_detections:1});
      add(id+1,'SDPoseKeypointExtractor',{model:['16',0],vae:['16',2],image:analysis,bboxes:boxes,batch_size:4});
    }
    add(67,'BodyRatioMapperProportionTransfer',{pose_keypoint:['63',0],ref_pose_keypoint:['66',0],
      enable_rpca:false,hand_scaling:true,foot_scaling:true,offset_stabilizer_y:false,offset_stabilizer_x:false,
      best_hand_search:true,best_neck_search:false,final_offset_alignment:true,base_offset_mode:true,
      head_fixed_mode:false,match_original_ear_scale:false,confidence_threshold:.3,output_absolute_coordinates:true,
      print_detailed_logs:false,anchor_output_mode:'single_frame_multi_person'},
      'Fit photo bone proportions once; retain source head, hand and root motion without stabilization');
    if(visualDetails){
      const draw=(id,keypoints,drawFace=true)=>add(id,'BodyRatioMapperSDPoseRender',{pose_keypoint:keypoints,resolution_x:source.canvasWidth,
        score_threshold:.3,scale_for_xinsir:false,stick_width:4,face_point_size:2,draw_face:drawFace,draw_mouth:drawFace,
        draw_hands:true,draw_feet:true,draw_thigh:true,draw_calf:true});
      draw(68,['67',0],!facePerformance);
      if(diagnostics){
      draw(73,['66',0]);
      const first=add(75,'ImageFromBatch',{image:['61',0],batch_index:0,length:1});
      const firstBoxes=add(76,'RTDETR_detect',{model:['17',0],image:first,threshold:.5,class_name:'person',max_detections:1});
      add(77,'SDPoseKeypointExtractor',{model:['16',0],vae:['16',2],image:first,bboxes:firstBoxes,batch_size:1});
      draw(69,['77',0]);
      const raw=add(70,'ImageFromBatch',{image:['69',0],batch_index:0,length:1});
      const mapped=add(71,'ImageFromBatch',{image:['68',0],batch_index:0,length:1});
      add(72,'ImageBatch',{image1:raw,image2:mapped});
      add(492,'SaveImage',{images:['72',0],filename_prefix:'VANTA-NATIVE-POSE-QA-raw-mapped'});
      add(493,'SaveImage',{images:['73',0],filename_prefix:'VANTA-NATIVE-POSE-QA-photo'});
      }
      if(facePerformance){
        add(78,'SDPoseFaceBBoxes',{keypoints:['63',0],scale:1,force_square:false});
        add(79,'CropByBBoxes',{image:['61',0],bboxes:['78',0],output_width:256,output_height:256,padding:0,keep_aspect:'pad'},
          'Private candidate: verify crop excludes accessories and retains every source frame before any promotion');
        facialSequence=['79',0];
        if(faceGuard){
          add(80,'GetImageSize',{image:facialSequence});
          add(81,'MathExpression|pysssss',{a:['80',2],b:['80',0],c:['80',1],
            expression:`256/((a==${source.totalFrames})*(b==256)*(c==256))`},
            'Stop before sampling if face detection drops frames or falls back to a full RGB frame');
          facialSequence=add(82,'ImageScale',{image:facialSequence,upscale_method:'nearest-exact',width:['81',0],height:256,crop:'disabled'},
            '256-to-256 identity pass after frame-count assertion; guide input only');
        }
        if(diagnostics)add(494,'VHS_VideoCombine',{images:facialSequence,frame_rate:24,loop_count:0,filename_prefix:'VANTA-FACE-PERFORMANCE-QA',
          format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,save_metadata:false,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false});
      }
    }else add(68,'SDPoseDrawKeypoints',{keypoints:['67',0],draw_body:true,draw_hands:true,draw_face:true,
      draw_feet:true,stick_width:4,face_point_size:2,score_threshold:.5,draw_head:true});
  }
  let previous=null;const exports=[];
  for(const [i,s] of segments.entries()){
    const b=1000+i*30;
    let pose;
    if(retarget){
      pose=add(b+19,'ImageFromBatch',{image:['68',0],batch_index:s.loadStart,length:s.inputFrames});
      if(s.modelFrames>s.inputFrames){
        const last=add(b+20,'ImageFromBatch',{image:pose,batch_index:s.inputFrames-1,length:1});
        const pad=add(b+21,'RepeatImageBatch',{image:last,amount:s.modelFrames-s.inputFrames});
        pose=add(b+22,'ImageBatch',{image1:pose,image2:pad});
      }
    }else{
    let raw=add(b,'VHS_LoadVideo',{video:videoName,force_rate:24,force_size:'Disabled',custom_width:0,custom_height:0,
      frame_load_cap:s.inputFrames,skip_first_frames:s.loadStart,select_every_nth:1,format:'None'});
    if(s.modelFrames>s.inputFrames){
      const last=add(b+1,'ImageFromBatch',{image:raw,batch_index:s.inputFrames-1,length:1});
      const pad=add(b+2,'RepeatImageBatch',{image:last,amount:s.modelFrames-s.inputFrames});
      raw=add(b+3,'ImageBatch',{image1:raw,image2:pad});
    }
    const analysis=add(b+4,'ResizeImageMaskNode',{input:raw,resize_type:'scale longer dimension',
      'resize_type.longer_size':1024,scale_method:'lanczos'},'Resize only motion-analysis frames; preserve reference and generated pixels');
    const boxes=add(b+5,'RTDETR_detect',{model:['17',0],image:analysis,threshold:.5,class_name:'person',max_detections:1});
    const points=add(b+6,'SDPoseKeypointExtractor',{model:['16',0],vae:['16',2],image:analysis,bboxes:boxes,batch_size:4});
    pose=add(b+7,'SDPoseDrawKeypoints',{keypoints:points,draw_body:true,draw_hands:true,draw_face:true,
      draw_feet:true,stick_width:4,face_point_size:2,score_threshold:.5,draw_head:true});
    }
    const model=add(b+8,'MiniMaxH3FunControlNetApply',{model:[globalAttention?'10':dmd8?'8':'6',0],model_patch:['13',0],vae:['3',0],
      strength:1,start_percent:0,end_percent:1,control_video:pose},'Trained native pose control; no source RGB or inpaint source');
    let faceClip=null;
    if(facePerformance){
      faceClip=add(b+23,'ImageFromBatch',{image:facialSequence,batch_index:s.loadStart,length:s.inputFrames});
      if(s.modelFrames>s.inputFrames){
        const last=add(b+24,'ImageFromBatch',{image:faceClip,batch_index:s.inputFrames-1,length:1});
        const pad=add(b+25,'RepeatImageBatch',{image:last,amount:s.modelFrames-s.inputFrames});
        faceClip=add(b+26,'ImageBatch',{image1:faceClip,image2:pad});
      }
    }
    let positive=add(b+9,'MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],
      prompt:appearancePrompt,width:source.canvasWidth,height:source.canvasHeight,length:s.modelFrames,ref_image_size:'max',
      'ref_images.ref_image_1':['31',0],...(facePerformance?{'ref_videos.ref_video_1':faceClip}:{})});
    const schedule=add(b+10,'BasicScheduler',{model,scheduler:'simple',steps:dmd8?8:4,denoise:1});
    if(previous){
      const context=add(b+11,'ImageFromBatch',{image:previous.image,batch_index:previous.lastFrame-s.contextFrames+1,length:s.contextFrames});
      positive=add(b+12,'MiniMaxH3AddGuide',{positive,latent:[String(b+9),1],vae:['3',0],image:context,frame_idx:0},
        'Generated appearance continuation only; never RGB from the driving video');
    }
    const noise=add(b+13,'RandomNoise',{noise_seed:42+i});
    const guider=add(b+14,'BasicGuider',{model,conditioning:positive});
    const sample=add(b+15,'SamplerCustomAdvanced',{noise,guider,sampler:['40',0],sigmas:schedule,latent_image:[String(b+9),1]});
    const decoded=add(b+16,'VAEDecode',{samples:sample,vae:['3',0]});
    previous={image:decoded,lastFrame:s.contextFrames+s.length-1};
    const trim=add(b+17,'ImageFromBatch',{image:decoded,batch_index:s.contextFrames,length:s.length});
    exports.push(add(b+18,'ImageCrop',{image:trim,x:source.padLeft,y:source.padTop,width:source.outputWidth,height:source.outputHeight},
      'Remove grid border only; no output resizing or refinement'));
  }
  const images=exports.length===1?exports[0]:add(49,'ImageBatchMulti',{inputcount:exports.length,
    ...Object.fromEntries(exports.map((value,i)=>['image_'+(i+1),value]))});
  const audio=source.hasAudio?add(50,'VHS_LoadAudioUpload',{audio:videoName,start_time:0,duration:source.totalFrames/24}):null;
  add(490,'VHS_VideoCombine',{images,...(audio?{audio}:{}),frame_rate:24,loop_count:0,filename_prefix:'VANTA-H3-NATIVE-POSE-CANDIDATE',
    format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,save_metadata:true,trim_to_audio:false,pingpong:false,save_output:true,no_preview:false});
  return g;
}
