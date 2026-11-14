// Fixed worker-schema probes only. Every output requires a missing image;
// there is no sampler, encode, output file, media upload, or generation path.
import fs from 'node:fs/promises';
import path from 'node:path';
import {findValidationRejection} from './runninghub-graph-validation.js';

export const EXPRESSION_INSPECT_ROUTE='/api/internal/h3-expression-inspect';
export const EXPRESSION_INSPECT_TASK='2121484132689473537';
export const EXPRESSION_INSPECT_EXPIRES='2026-11-17T00:00:00Z';
export const EXPRESSION_GUARD='VANTA_EXPRESSION_SCHEMA_ONLY_MISSING_IMAGE_20261114.invalid';
export const EXPRESSION_NEGATIVE='VANTA_EXPRESSION_UNREGISTERED_20261114.invalid';
export const EXPRESSION_CHECKS=Object.freeze(['validator-control','registration','source-contract',
  'reference-contract','relative-contract','friendly-contract','signature']);
const targets=['DownloadAndLoadLivePortraitModels','LivePortraitLoadMediaPipeCropper',
  'LivePortraitCropper','LivePortraitProcess','MiniMaxH3ReferenceToVideo'];
const allowedClasses=new Set([...targets,'LoadImage','CLIPLoader','VAELoader',
  'PreviewImage','PreviewAny',EXPRESSION_NEGATIVE]);
const errorTypes=new Set(['custom_validation_failed','required_input_missing','value_not_in_list',
  'return_type_mismatch','invalid_input_type','exception_during_validation']);
const contracts={
  'source-contract':['process','crop_info'],
  'reference-contract':['conditioning','ref_videos.ref_video_2'],
  'relative-contract':['process','relative_motion_mode'],
  'friendly-contract':['process','expression_friendly']
};
const expected=check=>check==='validator-control'?'validator_control_passed':
  check==='registration'?'nodes_registered':contracts[check]?'typed_input_recognized':'schema_recognized';

export function expressionInspectionGraph(check){
  if(!EXPRESSION_CHECKS.includes(check))throw Error('Unknown fixed expression check');
  const g={guard:{class_type:'LoadImage',inputs:{image:EXPRESSION_GUARD}}};
  if(['validator-control','registration'].includes(check)){
    g.output={class_type:'PreviewImage',inputs:{images:['guard',0]}};
    const classes=check==='validator-control'?[EXPRESSION_NEGATIVE]:targets;
    classes.forEach((class_type,i)=>{g['catalog'+i]={class_type,inputs:{}};});
    return g;
  }
  g.pipeline={class_type:'DownloadAndLoadLivePortraitModels',inputs:{precision:'fp16',mode:'human'}};
  g.cropper={class_type:'LivePortraitLoadMediaPipeCropper',inputs:{
    landmarkrunner_onnx_device:'CPU',keep_model_loaded:false}};
  g.source_crop={class_type:'LivePortraitCropper',inputs:{pipeline:['pipeline',0],cropper:['cropper',0],
    source_image:['guard',0],dsize:512,scale:2.3,vx_ratio:0,vy_ratio:-0.125,
    face_index:0,face_index_order:'large-small',rotate:true}};
  g.process={class_type:'LivePortraitProcess',inputs:{pipeline:['pipeline',0],
    crop_info:['source_crop',1],source_image:['guard',0],driving_images:['guard',0],
    lip_zero:false,lip_zero_threshold:0.03,stitching:true,delta_multiplier:1,
    mismatch_method:'constant',relative_motion_mode:'relative',
    driving_smooth_observation_variance:0.000003,expression_friendly:true,
    expression_friendly_multiplier:1}};
  g.clip={class_type:'CLIPLoader',inputs:{
    clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}};
  g.vae={class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_fp16.safetensors'}};
  g.conditioning={class_type:'MiniMaxH3ReferenceToVideo',inputs:{clip:['clip',0],vae:['vae',0],
    prompt:'Schema validation only.',width:1088,height:1952,length:124,ref_image_size:'max',
    'ref_images.ref_image_1':['guard',0],'ref_videos.ref_video_1':['guard',0],
    'ref_videos.ref_video_2':['process',0]}};
  // Both the source CROPINFO producer and IMAGE bridge are output ancestors.
  g.face_output={class_type:'PreviewImage',inputs:{images:['process',0]}};
  g.output={class_type:'PreviewAny',inputs:{source:['conditioning',0]}};
  if(contracts[check]){
    const [node,input]=contracts[check];g[node].inputs[input]=['clip',0];
  }
  return g;
}

export function assertExpressionInspectionGraph(graph,check){
  // Exact comparison prevents callers or future plumbing from submitting an
  // arbitrary graph through this diagnostic's account credentials.
  if(JSON.stringify(graph)!==JSON.stringify(expressionInspectionGraph(check)))
    throw Error('Expression inspection graph differs from fixed recipe');
  const outputs=Object.keys(graph).filter(id=>/^Preview/.test(graph[id].class_type));
  if(!outputs.length||graph.guard?.inputs.image!==EXPRESSION_GUARD)throw Error('Missing validation guard');
  for(const output of outputs){
    const reachable=new Set();
    const visit=id=>{if(reachable.has(id))return;reachable.add(id);
      for(const value of Object.values(graph[id].inputs))
        if(Array.isArray(value)&&graph[value[0]])visit(value[0]);};
    visit(output);
    if(!reachable.has('guard'))throw Error('Output can execute without missing image');
  }
  if(Object.values(graph).some(node=>!allowedClasses.has(node.class_type)))throw Error('Unexpected node');
  return true;
}

export function expressionWorkerGraph(check){
  const graph=expressionInspectionGraph(check);assertExpressionInspectionGraph(graph,check);
  // RunningHub's task wrapper uses numeric IDs in production graphs. Do not
  // require it to accept ComfyUI's otherwise valid symbolic node identifiers.
  const ids=Object.fromEntries(Object.keys(graph).map((id,i)=>[id,String(i+1)]));
  return Object.fromEntries(Object.entries(graph).map(([id,node])=>[ids[id],{
    class_type:node.class_type,inputs:Object.fromEntries(Object.entries(node.inputs).map(([name,value])=>
      [name,Array.isArray(value)&&ids[value[0]]?[ids[value[0]],value[1]]:value]))
  }]));
}

function responseEvidence(response){
  const numeric=value=>['number','string'].includes(typeof value)&&/^-?\d{1,10}$/.test(String(value))?Number(value):null;
  const msg=typeof response?.msg==='string'?response.msg:'';
  const category=/WORKFLOW_NOT_EXIST/.test(msg)?'workflow_not_found':
    /TASK_QUEUE_MAXED|QUEUE|CONCURRENCY/.test(msg)?'queue_limit':
    /BALANCE|COINS|CREDIT/.test(msg)?'balance':
    /TOKEN|SESSION|AUTH|BANNED/.test(msg)?'authentication':
    /VALIDAT|NODE|PROMPT/.test(msg)?'validation':msg?'unrecognized':'absent';
  const fields=obj=>obj&&typeof obj==='object'?Object.keys(obj).filter(k=>
    /^[A-Za-z][A-Za-z0-9_]{0,50}$/.test(k)&&!/key|token|secret|password|url|access|refresh/i.test(k)).slice(0,24):[];
  return {providerCode:numeric(response?.code),messageCategory:category,
    responseFields:fields(response),dataFields:fields(response?.data)};
}

export function expressionInspectionFailure(error){
  const codes=new Set(['RH_ACCESS_TOKEN_REQUIRED','RH_WEB_AUTH_EXPIRED','RH_WEB_TRANSPORT_ERROR',
    'RH_WEB_PROTOCOL_ERROR','RH_WEB_REFRESH_REJECTED','RH_WEB_REFRESH_MISSING',
    'RH_WEB_IDENTITY_MISMATCH','RH_WEB_INVALID_GRAPH','RH_WEB_ERROR','RH_WEB_STORAGE_ERROR']);
  return {status:'unconfirmed',taskCreated:error?.definitelyRejected===true?false:null,
    errorCode:codes.has(error?.code)?error.code:'unrecognized',
    providerCode:Number.isInteger(error?.providerCode)?error.providerCode:null};
}

export function expressionInspectionSummary(response,check){
  const graph=expressionInspectionGraph(check);
  const taskId=response?.data?.taskId||response?.taskId;
  if(taskId)return {check,status:'unexpected_acceptance',taskCreated:true,
    taskId:/^\d{10,25}$/.test(String(taskId))?String(taskId):null};
  const rejection=findValidationRejection(response);
  if(!rejection)return {check,status:'unconfirmed',taskCreated:null,...responseEvidence(response)};
  const type=rejection.error?.type;
  const missing=type==='missing_node_type'?[...allowedClasses].filter(n=>
    JSON.stringify(rejection.error).includes(n)):[];
  const names=Object.keys(graph);
  const raw=Object.fromEntries(Object.entries(rejection.node_errors||{}).map(([id,value])=>
    [graph[id]?id:/^[1-9]\d*$/.test(id)&&names[Number(id)-1]?names[Number(id)-1]:id,value]));
  const nodeErrors=Object.entries(raw).map(([id,node])=>({
    id:graph[id]?id:'other',classType:allowedClasses.has(node?.class_type)?node.class_type:'other',
    errors:(Array.isArray(node?.errors)?node.errors:[]).map(e=>({
      type:errorTypes.has(e.type)?e.type:'other',
      input:Object.values(contracts).some(([n,p])=>n===id&&p===e.extra_info?.input_name)?e.extra_info.input_name:null
    }))
  }));
  let status='unconfirmed';
  if(check==='validator-control'){
    if(missing.includes(EXPRESSION_NEGATIVE))status='validator_control_passed';
  }else if(type==='missing_node_type')status=missing.length?'unsupported':'unconfirmed';
  else if(type==='prompt_outputs_failed_validation'){
    const guardRejected=raw.guard?.class_type==='LoadImage'&&raw.guard.errors?.some(e=>e.type==='custom_validation_failed');
    const contract=contracts[check];
    const errorsExpected=Object.entries(raw).every(([id,node])=>
      id==='guard'||(contract&&id===contract[0]&&node.class_type===graph[id].class_type&&
        node.errors?.length&&node.errors.every(e=>e.type==='return_type_mismatch'&&e.extra_info?.input_name===contract[1])));
    if(guardRejected&&errorsExpected){
      if(contract)status=raw[contract[0]]?.errors?.some(e=>e.type==='return_type_mismatch'&&
        e.extra_info?.input_name===contract[1])?'typed_input_recognized':'input_unconfirmed';
      else status=expected(check);
    }else status='schema_incompatible';
  }
  return {check,status,taskCreated:false,validationType:type,missing,nodeErrors};
}

const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(report,canCheck){
  return '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Pemeriksaan ekspresi · VANTA</title><style>body{font:16px system-ui;background:#101318;color:#e6e9ee;max-width:850px;margin:35px auto;padding:22px}'+
    'p{line-height:1.6}pre{background:#1b212a;padding:20px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}'+
    'button{padding:14px;border:0;border-radius:10px;background:#b7f46d;font:600 16px system-ui}</style>'+
    '<h1>Pemeriksaan sambungan ekspresi H3</h1><p>Memeriksa dukungan node dan tipe sambungan LivePortrait ke H3. '+
    'Tidak menjalankan render video. Kelulusan skema belum membuktikan ekspresi atau identitas hasil.</p>'+
    '<pre>'+htmlEscape(JSON.stringify(report,null,2))+'</pre>'+
    (canCheck?'<form method="post" action="'+EXPRESSION_INSPECT_ROUTE+'"><button>Periksa dukungan worker</button></form>':'')+'</html>';
}

export function installExpressionInspection({app,rootDir,getTask,isOwner,probe,cancelUnexpected,
  resolveTask=async task=>({task,summary:{selection:'source_task'}}),
  expires=EXPRESSION_INSPECT_EXPIRES,now=Date.now,log=()=>{}}){
  const file=path.join(rootDir,'h3-benchmark-checkpoints','expression-schema-v2-'+EXPRESSION_INSPECT_TASK+'.json');
  let pending=null;
  const read=async()=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}
    catch(e){return {status:e.code==='ENOENT'?'not_checked':'checkpoint_unreadable'};}};
  const authorized=(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!isOwner(req)||now()>=Date.parse(expires)){res.sendStatus(404);return false;}return true;
  };
  app.get(EXPRESSION_INSPECT_ROUTE,async(req,res)=>{
    if(!authorized(req,res))return;
    const report=await read();res.type('html').send(page(report,report.status==='not_checked'));
  });
  app.post(EXPRESSION_INSPECT_ROUTE,async(req,res)=>{
    if(!authorized(req,res))return;
    let origin;try{origin=new URL(req.get('origin'));}catch{return res.sendStatus(403);}
    if(origin.host!==req.get('host')||!['http:','https:'].includes(origin.protocol))return res.sendStatus(403);
    if(Object.keys(req.body||{}).length)return res.sendStatus(400);
    const task=getTask(EXPRESSION_INSPECT_TASK);
    if(!task?.key||!/MiniMax H3/.test(task.workflow||''))
      return res.status(409).type('html').send(page({status:'source_task_unavailable'},false));
    if(!pending)pending=(async()=>{
      await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try{await fs.writeFile(file,JSON.stringify({status:'checking'}),{flag:'wx',mode:0o600});}
      catch(e){if(e.code==='EEXIST')return read();throw e;}
      let prepared;try{prepared=await resolveTask(task);}catch{prepared={task:null};}
      const results=[];let status=prepared?.task?'unconfirmed':'no_eligible_inspection_account';
      for(const check of EXPRESSION_CHECKS){
        if(!prepared?.task)break;
        const graph=expressionWorkerGraph(check);
        let result;try{result=expressionInspectionSummary(await probe(prepared.task,graph),check);}
        catch(error){result={check,...expressionInspectionFailure(error)};}
        if(result.status==='unexpected_acceptance'){
          result.cancelled=false;
          if(result.taskId&&result.taskId!==EXPRESSION_INSPECT_TASK&&cancelUnexpected)
            try{await cancelUnexpected(prepared.task,result.taskId);result.cancelled=true;}catch{}
        }
        results.push(result);status=result.status;
        if(status!==expected(check))break;
      }
      const report={status,revision:'numeric-worker-v2',sourceTaskId:EXPRESSION_INSPECT_TASK,requestedNodes:targets,
        samplerPresent:false,mediaUploaded:false,gpuExecutionQualified:false,visualQualified:false,
        checkedAt:new Date(now()).toISOString(),results};
      await fs.writeFile(file,JSON.stringify(report),{mode:0o600});
      try{log(report);}catch{}return report;
    })();
    try{await pending;res.redirect(303,EXPRESSION_INSPECT_ROUTE);}
    catch{res.status(502).type('html').send(page({status:'unconfirmed'},false));}
  });
}
