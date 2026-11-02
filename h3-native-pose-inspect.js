// Expiring inspection of one reported task, plus a once-only validation probe.
// Every output depends on a deliberately invalid required loader, including
// the MathExpression output used by the frame-count validation probe.
// Neither probe is a render request with runnable weights.
import fs from 'node:fs/promises';
import path from 'node:path';
import {consistencyTrialAuthorized} from './h3-consistency-trial.js';
import {findValidationRejection} from './runninghub-graph-validation.js';

export const POSE_PROBE_MARKER='VANTA_VALIDATION_ONLY_DO_NOT_RENDER.invalid';
export function nativePoseValidationGraph(phase='catalog'){
  if(!['catalog','checkpoint','retarget','visual','face','faceguard'].includes(phase))throw Error('Invalid validation phase');
  const g={},add=(id,type,inputs)=>{g[id]={class_type:type,inputs};};
  add(1,'UNETLoader',{unet_name:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',weight_dtype:'default'});
  add(2,'CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'});
  add(3,'VAELoader',{vae_name:'minimax_h3_video_vae_fp16.safetensors'});
  add(4,'VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'});
  add(5,'ModelPatchLoader',{name:POSE_PROBE_MARKER});
  add(6,'LoraLoaderModelOnly',{model:['1',0],lora_name:'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',strength_model:1});
  add(7,'MiniMaxH3FunControlNetApply',{model:['6',0],model_patch:['5',0],vae:['3',0],
    strength:1,start_percent:0,end_percent:1,control_video:['20',0]});
  add(8,'MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],
    prompt:'Validation only.',width:1088,height:1952,length:22,ref_image_size:'max'});
  add(9,'BasicGuider',{model:['7',0],conditioning:['8',0]});
  add(10,'KSamplerSelect',{sampler_name:'res_multistep'});
  add(11,'BasicScheduler',{model:['7',0],scheduler:'simple',steps:4,denoise:1});
  add(12,'RandomNoise',{noise_seed:42});
  add(13,'SamplerCustomAdvanced',{noise:['12',0],guider:['9',0],sampler:['10',0],sigmas:['11',0],latent_image:['8',1]});
  add(14,'VAEDecode',{samples:['13',0],vae:['3',0]});
  add(15,'EmptyImage',{width:64,height:64,batch_size:22,color:0});
  add(16,'CheckpointLoaderSimple',{ckpt_name:'sdpose_wholebody_fp16.safetensors'});
  add(17,'UNETLoader',{unet_name:'rt_detr_v4-x-hgnet_fp16.safetensors',weight_dtype:'default'});
  add(18,'RTDETR_detect',{model:['17',0],image:['15',0],threshold:.5,class_name:'person',max_detections:1});
  add(19,'SDPoseKeypointExtractor',{model:['16',0],vae:['16',2],image:['15',0],bboxes:['18',0],batch_size:1});
  add(20,'SDPoseDrawKeypoints',{keypoints:['19',0],draw_body:true,draw_hands:true,draw_face:true,
    draw_feet:true,stick_width:4,face_point_size:2,score_threshold:.5,draw_head:true});
  add(490,'VHS_VideoCombine',{images:['14',0],frame_rate:24,loop_count:0,filename_prefix:'VANTA-VALIDATION-NO-RENDER',
    format:'video/h264-mp4',pix_fmt:'yuv420p',crf:16,save_metadata:false,trim_to_audio:false,pingpong:false,save_output:true,no_preview:true});
  if(phase==='checkpoint'){
    g['5'].inputs.name='minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors';
    // RunningHub accepts arbitrary UNETLoader names until runtime. Only the
    // ModelPatchLoader guard was confirmed to reject at graph validation.
    add(21,'ModelPatchLoader',{name:POSE_PROBE_MARKER});
    add(22,'MiniMaxH3FunControlNetApply',{model:['7',0],model_patch:['21',0],vae:['3',0],
      strength:1,start_percent:0,end_percent:1,control_video:['20',0]});
    g['9'].inputs.model=['22',0];g['11'].inputs.model=['22',0];
  }
  if(['retarget','visual','face','faceguard'].includes(phase)){
    add(23,'BodyRatioMapperProportionTransfer',{pose_keypoint:['19',0],ref_pose_keypoint:['19',0],
      enable_rpca:false,hand_scaling:true,foot_scaling:true,offset_stabilizer_y:false,offset_stabilizer_x:false,
      best_hand_search:true,best_neck_search:false,final_offset_alignment:true,base_offset_mode:true,
      head_fixed_mode:false,match_original_ear_scale:false,confidence_threshold:.3,output_absolute_coordinates:true,
      print_detailed_logs:false,anchor_output_mode:'single_frame_multi_person'});
    g['20'].inputs.keypoints=['23',0];
    if(['visual','face','faceguard'].includes(phase))g['20']={class_type:'BodyRatioMapperSDPoseRender',inputs:{pose_keypoint:['23',0],resolution_x:1088,
      score_threshold:.3,scale_for_xinsir:false,stick_width:4,face_point_size:2,draw_face:true,draw_mouth:true,
      draw_hands:true,draw_feet:true,draw_thigh:true,draw_calf:true}};
    if(['face','faceguard'].includes(phase)){
      add(24,'SDPoseFaceBBoxes',{keypoints:['19',0],scale:1,force_square:false});
      add(25,'CropByBBoxes',{image:['15',0],bboxes:['24',0],output_width:256,output_height:256,padding:0,keep_aspect:'pad'});
      g['8'].inputs['ref_videos.ref_video_1']=['25',0];
      if(phase==='faceguard'){
        add(26,'GetImageSize',{image:['25',0]});
        // MathExpression is itself an output node. The otherwise-unused c
        // dependency makes its separate output require the invalid patch too.
        add(27,'MathExpression|pysssss',{a:['26',2],b:['26',0],c:['5',0],expression:'256/((a==22)*(b==256))'});
        add(28,'ImageScale',{image:['25',0],upscale_method:'lanczos',width:['27',0],height:256,crop:'disabled'});
        g['8'].inputs['ref_videos.ref_video_1']=['28',0];
      }
    }
  }
  return g;
}
export function poseValidationSummary(response){
  if(response?.taskId||response?.data?.taskId)return {status:'unexpected_acceptance',
    taskId:String(response?.data?.taskId||response?.taskId)};
  const rejected=findValidationRejection(response);
  if(!rejected)return {status:'unconfirmed',providerCode:Number.isFinite(Number(response?.code))?Number(response.code):null};
  const strings=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(strings):
    v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const safeModel=v=>typeof v==='string'&&v.length<240&&!v.includes('..')&&
    /^[\p{L}\p{N}_./ ()-]+\.safetensors$/u.test(v);
  const advertisedModels=n=>[...new Set((n.errors||[]).flatMap(e=>[
    ...strings(e.extra_info?.input_config),
    ...[...String(e.details||'').matchAll(/['"]([^'"\r\n]{1,240}\.safetensors)['"]/g)].map(m=>m[1])
  ]).filter(safeModel))];
  const missing=[...new Set((JSON.stringify(rejected.error||{}).match(
    /MiniMaxH3FunControlNetApply|ModelPatchLoader|SDPoseKeypointExtractor|SDPoseDrawKeypoints|SDPoseFaceBBoxes|CropByBBoxes|GetImageSize|MathExpression\|pysssss|RTDETR_detect|BodyRatioMapperProportionTransfer|BodyRatioMapperSDPoseRender/g)||[]))];
  return {status:'rejected_before_execution',type:rejected.error?.type,missingNodes:missing,
    nodes:Object.entries(rejected.node_errors||{}).slice(0,25).map(([id,n])=>({id,
      type:String(n.class_type||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,80),
      errors:(n.errors||[]).map(e=>String(e.type||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,80)),
      availableModelCount:advertisedModels(n).length,
      models:advertisedModels(n).filter(v=>/(minimax|h3|sdpose|rt_detr)/i.test(v)).slice(0,40)}))};
}
export function installNativePoseInspection({app,rootDir,getTask,getReference,probe,cancelUnexpected,
  taskId,hash,expires}){
  if(!/^\d{10,25}$/.test(String(taskId||''))||!/^[a-f0-9]{64}$/.test(String(hash||''))||
    !Number.isFinite(Date.parse(expires)))return;
  const route='/api/internal/h3-native-pose-inspect';
  const auth=(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(!consistencyTrialAuthorized(req.get('X-Vanta-H3-Inspect'),hash,expires))return res.sendStatus(404);
    const task=getTask(taskId);
    if(!task||!/MiniMax H3/.test(task.workflow||''))return res.sendStatus(404);
    req.h3InspectedTask=task;next();
  };
  const checkpoint=phase=>path.join(rootDir,'h3-benchmark-checkpoints',
    ({checkpoint:'native-pose-checkpoint-v1-',retarget:'native-pose-retarget-v1-',visual:'native-pose-visual-v1-',face:'native-pose-face-v1-',faceguard:'native-pose-faceguard-v1-'}[phase]||'native-pose-validation-')+taskId+'.json');
  const read=async(phase='catalog')=>{try{return JSON.parse(await fs.readFile(checkpoint(phase),'utf8'));}catch{return {status:'not_checked'};}};
  app.get(route,auth,async(req,res)=>res.json({taskId,status:req.h3InspectedTask.status,
    inputDiagnostics:req.h3InspectedTask.inputDiagnostics||null,
    references:{image:!!getReference(taskId,'image'),video:!!getReference(taskId,'video'),previewOnly:true},
    validation:await read(),checkpointValidation:await read('checkpoint'),retargetValidation:await read('retarget'),visualValidation:await read('visual'),faceValidation:await read('face'),faceGuardValidation:await read('faceguard')}));
  app.get(route+'/source/:kind',auth,(req,res)=>{
    if(!['image','video'].includes(req.params.kind))return res.sendStatus(404);
    const file=getReference(taskId,req.params.kind);if(!file)return res.sendStatus(404);
    res.type(req.params.kind==='image'?'image/jpeg':'video/mp4');res.sendFile(file);
  });
  const pending=new Map();
  const validate=phase=>async(req,res)=>{
    if(pending.has(phase))return res.json(await pending.get(phase));
    const result=(async()=>{
      const file=checkpoint(phase);
      await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try{await fs.writeFile(file,JSON.stringify({status:'checking'}),{flag:'wx',mode:0o600});}
      catch(e){if(e.code==='EEXIST')return read(phase);throw e;}
      let report;
      try{
        const response=await probe(req.h3InspectedTask,nativePoseValidationGraph(phase));
        report=poseValidationSummary(response);
        if(report.status==='unexpected_acceptance'){
          const id=String(response?.data?.taskId||response?.taskId||'');
          report.cancelled=false;
          if(/^\d{10,25}$/.test(id)&&id!==String(taskId)&&cancelUnexpected){
            try{await cancelUnexpected(req.h3InspectedTask,id);report.cancelled=true;}catch{}
          }
        }
      }catch{report={status:'unconfirmed'};}
      await fs.writeFile(file,JSON.stringify(report),{mode:0o600});return report;
    })();
    pending.set(phase,result);
    try{res.json(await result);}catch{res.status(502).json({status:'unconfirmed'});}
  };
  app.post(route+'/validate',auth,validate('catalog'));
  app.post(route+'/validate-checkpoint',auth,validate('checkpoint'));
  app.post(route+'/validate-retarget',auth,validate('retarget'));
  app.post(route+'/validate-visual',auth,validate('visual'));
  app.post(route+'/validate-face',auth,validate('face'));
  app.post(route+'/validate-faceguard',auth,validate('faceguard'));
}
