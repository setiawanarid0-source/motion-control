// Owner-only, fixed, once-only schema inspection. No sampler or media upload.
// Every possible output depends on a deliberately nonexistent image.
import fs from 'node:fs/promises';
import path from 'node:path';
import {findValidationRejection} from './runninghub-graph-validation.js';

export const CONTEXT_INSPECT_ROUTE='/api/internal/h3-context-inspect';
export const CONTEXT_INSPECT_TASK='2117861200645943298';
export const CONTEXT_INSPECT_EXPIRES='2026-11-05T07:00:00Z';
export const CONTEXT_NODE='MiniMaxH3ContextWindows';
export const MOTION_CONTEXT_NODE='MiniMaxH3MotionContext';
export const MOTION_INSPECT_ROUTE='/api/internal/h3-motion-context-inspect';
export const CONTEXT_GUARD='VANTA_H3_CONTEXT_SCHEMA_ONLY_DO_NOT_EXECUTE.invalid';
export const CONTEXT_NEGATIVE='VANTA_H3_CONTEXT_UNREGISTERED_NEGATIVE.invalid';
const checks=['negative-control','registration','signature'];
const motionChecks=['negative-control','registration','latent-contract','signature'];
const allowedClasses=new Set(['LoadImage','ImageFromBatch','PreviewImage','PreviewAny','UNETLoader',
  'CLIPLoader','VAELoader','MiniMaxH3ReferenceToVideo','CFGGuider',CONTEXT_NODE,MOTION_CONTEXT_NODE,CONTEXT_NEGATIVE]);
const allowedErrors=new Set(['custom_validation_failed','required_input_missing',
  'value_not_in_list','return_type_mismatch','invalid_input_type','exception_during_validation']);
const providerMessages=new Set(['USER_BANNED','NOT_ENOUGH_BALANCE','TASK_QUEUE_MAXED',
  'API_KEY_INVALID','API_KEY_IS_NOT_EXIST','API_KEY_NOT_FOUND','WORKFLOW_NOT_EXIST']);
const motionCheckpoint=rootDir=>path.join(rootDir,'h3-benchmark-checkpoints',
  'motion-context-schema-v2-'+CONTEXT_INSPECT_TASK+'.json');
export async function assertH3MotionContextSchema(rootDir){
  let report;
  try{report=JSON.parse(await fs.readFile(motionCheckpoint(rootDir),'utf8'));}catch{}
  const expected=['negative_control_passed','registered','latent_contract_recognized','schema_recognized'];
  if(report?.status!=='schema_recognized'||report.requestedNode!==MOTION_CONTEXT_NODE||
    report.samplerPresent!==false||!Array.isArray(report.results)||report.results.length!==motionChecks.length||
    report.results.some((r,i)=>r.check!==motionChecks[i]||r.status!==expected[i]||r.taskCreated!==false))
    throw Error('Sambungan latent H3 belum lolos pemeriksaan worker. Task belum dikirim.');
}
export async function selectContextInspectionTask(source,accounts,readStatus){
  const inspect=async account=>{
    try{
      const status=await readStatus(account.key);
      const coins=status?.remainCoins;
      return {account,eligible:Number.isFinite(coins)&&coins>=100,
        reason:Number.isFinite(coins)?coins>=100?'ready':'below_pool_minimum':'invalid_status'};
    }catch(e){return {account,eligible:false,reason:providerMessages.has(e.message)?e.message:'unconfirmed'};}
  };
  const original=await inspect({key:source.key,id:source.accountId,name:source.accountName});
  const summary={sourceCredentialStatus:original.reason,selection:'source_task'};
  if(original.eligible)return {task:source,summary};
  // Account labels can change when low-credit accounts retire. Use distinct
  // stored keys and live read-only status, never a label or an old task balance.
  const seen=new Set([source.key]);
  const candidates=accounts.filter(a=>a?.key&&!seen.has(a.key)&&(seen.add(a.key),true)).slice(0,8);
  const checked=await Promise.all(candidates.map(inspect));
  const chosen=checked.find(x=>x.eligible);
  summary.selection=chosen?'active_pool':'none';
  return {task:chosen?{...source,key:chosen.account.key}:null,summary};
}
export function contextInspectionGraph(check,mode='window'){
  if(!['window','motion'].includes(mode))throw Error('Unknown fixed context recipe');
  const target=mode==='motion'?MOTION_CONTEXT_NODE:CONTEXT_NODE;
  if(!(mode==='motion'?motionChecks:checks).includes(check))throw Error('Unknown fixed context check');
  if(!['signature','latent-contract'].includes(check))return {
    guard:{class_type:'LoadImage',inputs:{image:CONTEXT_GUARD}},
    output:{class_type:'PreviewImage',inputs:{images:['guard',0]}},
    catalog:{class_type:check==='negative-control'?CONTEXT_NEGATIVE:target,inputs:{}}
  };
  const graph={
    guard:{class_type:'LoadImage',inputs:{image:CONTEXT_GUARD}},
    model:{class_type:'UNETLoader',inputs:{
      unet_name:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}},
    context:{class_type:CONTEXT_NODE,inputs:{model:['model',0],context_length:124,
      context_overlap:39,fuse_method:'pyramid',freenoise:false,split_conds_to_windows:false}},
    clip:{class_type:'CLIPLoader',inputs:{
      clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}},
    conditioning:{class_type:'MiniMaxH3ReferenceToVideo',inputs:{clip:['clip',0],
      prompt:'Schema inspection only',width:1088,height:1952,length:362,
      ref_image_size:'max','ref_images.ref_image_1':['guard',0]}},
    guider:{class_type:'CFGGuider',inputs:{model:['context',0],
      positive:['conditioning',0],negative:['conditioning',0],cfg:1}},
    output:{class_type:'PreviewAny',inputs:{source:['guider',0]}}
  };
  if(mode==='motion'){
    graph.vae={class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_fp16.safetensors'}};
    graph.context={class_type:MOTION_CONTEXT_NODE,inputs:{conditioning:['conditioning',0],
      vae:['vae',0],latent:['conditioning',1],context_latent:['conditioning',1],
      context_length:'5',audio_context_length:0}};
    graph.guider.inputs={model:['model',0],positive:['context',0],negative:['context',0],cfg:1};
    graph.trim={class_type:'ImageFromBatch',inputs:{image:['guard',0],batch_index:['context',1],length:1}};
    graph.trim_output={class_type:'PreviewImage',inputs:{images:['trim',0]}};
    // Unknown optional fields are sometimes ignored by graph validators.
    // A deliberate CLIP -> LATENT mismatch proves context_latent is an
    // actual typed input on this worker, rather than an ignored field.
    if(check==='latent-contract')graph.context.inputs.context_latent=['clip',0];
  }
  return graph;
}
export function contextInspectionSummary(response,check,mode='window'){
  const target=mode==='motion'?MOTION_CONTEXT_NODE:CONTEXT_NODE;
  const id=response?.data?.taskId||response?.taskId;
  if(id)return {check,status:'unexpected_acceptance',
    taskId:/^\d{10,25}$/.test(String(id))?String(id):null,taskCreated:true};
  const rejection=findValidationRejection(response);
  if(!rejection)return {check,status:'unconfirmed',taskCreated:false,
    providerCode:Number.isFinite(Number(response?.code))?Number(response.code):null,
    providerMessage:providerMessages.has(response?.msg)?response.msg:null};
  const type=rejection.error?.type;
  const error=JSON.stringify(rejection.error||{});
  const missingNodes=[...allowedClasses].filter(n=>type==='missing_node_type'&&error.includes(n));
  const graph=contextInspectionGraph(check,mode);
  const nodeErrors=Object.entries(rejection.node_errors||{}).filter(([id])=>graph[id]).map(([id,n])=>({
    id,type:allowedClasses.has(n.class_type)?n.class_type:'other',
    errors:(Array.isArray(n.errors)?n.errors:[]).map(e=>allowedErrors.has(e.type)?e.type:'other')
  }));
  const guardRejected=nodeErrors.some(n=>n.id==='guard'&&n.type==='LoadImage');
  let status='unconfirmed';
  if(check==='negative-control'){
    if(type==='missing_node_type'&&missingNodes.includes(CONTEXT_NEGATIVE))status='negative_control_passed';
  }else if(missingNodes.includes(target))status='unsupported';
  else if(type==='missing_node_type')status='missing_dependency';
  else if(type==='prompt_outputs_failed_validation'&&guardRejected){
    const rawTypeProven=rejection.node_errors?.context?.errors?.some(e=>
      e.type==='return_type_mismatch'&&e.extra_info?.input_name==='context_latent');
    status=check==='latent-contract'?(rawTypeProven?'latent_contract_recognized':'schema_incompatible'):
      check==='registration'?'registered':
      nodeErrors.every(n=>n.id==='guard')?'schema_recognized':'schema_incompatible';
  }
  return {check,status,taskCreated:false,validationType:type,missingNodes,nodeErrors};
}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(report,canCheck,route=CONTEXT_INSPECT_ROUTE){
  return '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Pemeriksaan H3 VANTA</title><style>body{font:16px system-ui;background:#101318;color:#e6e9ee;max-width:900px;margin:50px auto;padding:24px}'+
    'h1{font-size:27px}p{line-height:1.6;color:#b9c2ce}button{padding:13px 20px;border:0;border-radius:9px;background:#b7f46d;color:#15210a;font:600 16px system-ui}'+
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:22px;border-radius:12px;background:#1b212a;line-height:1.5}</style>'+
    '<h1>Pemeriksaan kompatibilitas H3</h1><p>Pemeriksaan skema tanpa sampling, unggah model, atau generate video. Workflow aktif tetap menggunakan konfigurasi sebelumnya.</p>'+
    '<pre>'+escapeHtml(JSON.stringify(report,null,2))+'</pre>'+
    (canCheck?'<form method="post" action="'+route+'"><button type="submit">Periksa dukungan RunningHub</button></form>':'')+'</html>';
}
export function installH3ContextInspection({app,rootDir,getTask,isOwner,probe,cancelUnexpected,
  resolveTask=async task=>({task,summary:{selection:'source_task'}}),
  taskId=CONTEXT_INSPECT_TASK,expires=CONTEXT_INSPECT_EXPIRES,now=Date.now,mode='window'}){
  if(!['window','motion'].includes(mode))throw Error('Unknown fixed context recipe');
  const route=mode==='motion'?MOTION_INSPECT_ROUTE:CONTEXT_INSPECT_ROUTE;
  const prefix=mode==='motion'?'motion-context-schema-v2-':'context-schema-v2-';
  const file=path.join(rootDir,'h3-benchmark-checkpoints',prefix+taskId+'.json');
  let pending=null;
  const read=async()=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return {status:'not_checked'};}};
  const authorized=(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!isOwner(req)||now()>=Date.parse(expires)){res.sendStatus(404);return false;}
    return true;
  };
  app.get(route,async(req,res)=>{
    if(!authorized(req,res))return;
    const report=await read();
    res.type('html').send(page(report,report.status==='not_checked',route));
  });
  app.post(route,async(req,res)=>{
    if(!authorized(req,res))return;
    let origin;
    try{origin=new URL(req.get('origin'));}catch{return res.sendStatus(403);}
    if(origin.host!==req.get('host')||!['https:','http:'].includes(origin.protocol))return res.sendStatus(403);
    const task=getTask(taskId);
    if(!task?.key||!/MiniMax H3/.test(task.workflow||''))return res.status(409).type('html').send(page({status:'source_task_unavailable'},false));
    if(!pending)pending=(async()=>{
      await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try{await fs.writeFile(file,JSON.stringify({status:'checking'}),{flag:'wx',mode:0o600});}
      catch(e){if(e.code==='EEXIST')return read();throw e;}
      let prepared;
      try{prepared=await resolveTask(task);}catch{prepared={task:null,summary:{selection:'unconfirmed'}};}
      const results=[];let status=prepared.task?'unconfirmed':'no_eligible_inspection_account';
      const inspectionTask=prepared.task;
      for(const check of mode==='motion'?motionChecks:checks){
        if(!inspectionTask)break;
        let result;
        try{result=contextInspectionSummary(await probe(inspectionTask,contextInspectionGraph(check,mode)),check,mode);}
        catch{result={check,status:'unconfirmed',taskCreated:false};}
        if(result.status==='unexpected_acceptance'){
          result.cancelled=false;
          if(result.taskId&&result.taskId!==String(taskId)&&cancelUnexpected)
            try{await cancelUnexpected(inspectionTask,result.taskId);result.cancelled=true;}catch{}
        }
        results.push(result);
        const expected=check==='negative-control'?'negative_control_passed':check==='registration'?'registered':
          check==='latent-contract'?'latent_contract_recognized':'schema_recognized';
        if(result.status!==expected){status=result.status;break;}
        if(check==='signature')status='schema_recognized';
      }
      const report={status,requestedNode:mode==='motion'?MOTION_CONTEXT_NODE:CONTEXT_NODE,
        sourceTaskId:String(taskId),accountPreflight:prepared.summary,samplerPresent:false,modelUpload:false,
        gpuExecutionQualified:false,visualQualified:false,checkedAt:new Date(now()).toISOString(),results};
      await fs.writeFile(file,JSON.stringify(report),{mode:0o600});
      return report;
    })();
    try{await pending;res.redirect(303,route);}
    catch{res.status(502).type('html').send(page({status:'unconfirmed'},false));}
  });
}

