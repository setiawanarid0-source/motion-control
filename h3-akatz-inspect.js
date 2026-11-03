// Fixed, expiring schema checks for the author's Akatz/Relay recipe.
// There are no samplers, video encoders or user-supplied graphs in this route.
import fs from 'node:fs/promises';
import path from 'node:path';
import {consistencyTrialAuthorized} from './h3-consistency-trial.js';
import {findValidationRejection} from './runninghub-graph-validation.js';

export const AKATZ_INVALID_IMAGE='VANTA_AKATZ_SCHEMA_ONLY_DO_NOT_EXECUTE.invalid';
export const AKATZ_NEGATIVE_NODE='VANTA_AKATZ_UNREGISTERED_NODE_NEGATIVE_CONTROL.invalid';
export const AKATZ_CHECK_NODES=Object.freeze([
  'H3RelayPrepareSource','H3RelayWindowPlan','H3RelayWindowInputs',
  'H3RelayApplyHistory','H3RelayApplyEditMask','H3RelayAppendWindow',
  'H3RelayFinishWindows','H3RelayTextMemory','H3RelaySamplingMemory',
  'H3RelaySelectMask','H3RelayRecoverMasks','H3RelayExpandMask',
  'StartLoop','EndLoop','SelectCLIPDevice',
  'SAM3_Detect','SAM3_VideoTrack','SAM3_TrackToMask',
  'LTXVSeparateAVLatent','LTXVConcatAVLatent','SetLatentNoiseMask',
  'MiniMaxH3ReferenceToVideo','MiniMaxH3AddGuide'
]);
export function akatzInspectionGraph(check){
  if(!['models','negative-control'].includes(check)&&!AKATZ_CHECK_NODES.includes(check))throw Error('Unknown Akatz check');
  const graph={
    guard:{class_type:'LoadImage',inputs:{image:AKATZ_INVALID_IMAGE}},
    output:{class_type:'PreviewImage',inputs:{images:['guard',0]}}
  };
  if(check!=='models'){
    // ComfyUI checks every class identifier before validating output ancestors.
    // This establishes presence only, not input compatibility or execution.
    graph.catalog={class_type:check==='negative-control'?AKATZ_NEGATIVE_NODE:check,inputs:{}};
    return graph;
  }
  graph.model={class_type:'UNETLoader',inputs:{unet_name:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}};
  graph.turbo={class_type:'LoraLoaderModelOnly',inputs:{model:['model',0],
    lora_name:'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',strength_model:1}};
  graph.adapter={class_type:'LoraLoaderModelOnly',inputs:{model:['turbo',0],
    lora_name:'h3_character_swap_v1.5.safetensors',strength_model:1}};
  graph.dimensions={class_type:'GetImageSize',inputs:{image:['guard',0]}};
  graph.dependency={class_type:'MathExpression|pysssss',inputs:{a:['dimensions',0],c:['adapter',0],expression:'a'}};
  graph.blank={class_type:'EmptyImage',inputs:{width:['dependency',0],height:64,batch_size:1,color:0}};
  graph.output.inputs.images=['blank',0];
  return graph;
}
export function akatzInspectionSummary(response,check){
  const id=response?.data?.taskId||response?.taskId;
  if(id)return {status:'unexpected_acceptance',check,taskId:String(id),schemaOnly:true};
  const rejection=findValidationRejection(response);
  if(!rejection)return {status:'unconfirmed',check,providerCode:Number(response?.code)||null};
  const strings=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(strings):
    v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
  const known=new Set([...AKATZ_CHECK_NODES,AKATZ_NEGATIVE_NODE,'LoadImage','PreviewImage','UNETLoader','LoraLoaderModelOnly','GetImageSize','MathExpression|pysssss','EmptyImage']);
  const errorText=JSON.stringify(rejection.error||{});
  const missingNodes=[...known].filter(n=>rejection.error?.type==='missing_node_type'&&errorText.includes(n));
  const nodes=Object.entries(rejection.node_errors||{}).map(([nodeId,n])=>({id:nodeId,type:n.class_type,
    errors:(n.errors||[]).map(e=>String(e.type||'').slice(0,80))}));
  const advertised=Object.values(rejection.node_errors||{}).flatMap(n=>(n.errors||[]).flatMap(e=>[
    ...strings(e.extra_info?.input_config),
    ...[...String(e.details||'').matchAll(/['"]([^'"\r\n]{1,240}\.safetensors)['"]/g)].map(m=>m[1])
  ]));
  const models=[...new Set(advertised.filter(v=>v.length<240&&
    /^[\p{L}\p{N}_./ ()-]+\.safetensors$/u.test(v)&&!v.includes('..')&&
    /(?:minimax|h3|akatz|character_swap)/i.test(v)))].slice(0,100);
  const guardRejected=nodes.some(n=>n.id==='guard'&&n.type==='LoadImage');
  return {status:'rejected_before_execution',check,type:rejection.error?.type,missingNodes,nodes,models,
    ...(check==='models'?{}:{validatorRecognizesNode:rejection.error?.type==='prompt_outputs_failed_validation'&&guardRejected}),
    schemaOnly:true};
}
export function installAkatzInspection({app,rootDir,getTask,probe,cancelUnexpected,taskId,hash,expires}){
  if(!/^\d{10,25}$/.test(String(taskId||''))||!/^[a-f0-9]{64}$/.test(String(hash||''))||
    !Number.isFinite(Date.parse(expires)))return;
  const route='/api/internal/h3-akatz-inspect/:check';
  const authorized=(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    if(!consistencyTrialAuthorized(req.get('X-Vanta-H3-Inspect'),hash,expires))return res.sendStatus(404);
    if(!['models','negative-control'].includes(req.params.check)&&!AKATZ_CHECK_NODES.includes(req.params.check))return res.sendStatus(404);
    const task=getTask(taskId);
    if(!task||!/MiniMax H3/.test(task.workflow||''))return res.sendStatus(404);
    req.akatzTask=task;next();
  };
  const file=check=>path.join(rootDir,'h3-benchmark-checkpoints','akatz-schema-v1-'+check+'-'+taskId+'.json');
  const read=async check=>{try{return JSON.parse(await fs.readFile(file(check),'utf8'));}catch{return {status:'not_checked',check};}};
  app.get(route,authorized,async(req,res)=>res.json(await read(req.params.check)));
  const pending=new Map();
  app.post(route,authorized,async(req,res)=>{
    const check=req.params.check;
    if(pending.has(check))return res.json(await pending.get(check));
    const result=(async()=>{
      await fs.mkdir(path.dirname(file(check)),{recursive:true,mode:0o700});
      try{await fs.writeFile(file(check),JSON.stringify({status:'checking',check}),{flag:'wx',mode:0o600});}
      catch(e){if(e.code==='EEXIST')return read(check);throw e;}
      let report;
      try{
        report=akatzInspectionSummary(await probe(req.akatzTask,akatzInspectionGraph(check)),check);
        if(report.status==='unexpected_acceptance'){
          report.cancelled=false;
          if(/^\d{10,25}$/.test(report.taskId)&&report.taskId!==String(taskId)&&cancelUnexpected)
            try{await cancelUnexpected(req.akatzTask,report.taskId);report.cancelled=true;}catch{}
        }
      }catch{report={status:'unconfirmed',check};}
      await fs.writeFile(file(check),JSON.stringify(report),{mode:0o600});
      return report;
    })();
    pending.set(check,result);
    try{res.json(await result);}catch{res.status(502).json({status:'unconfirmed',check});}
  });
}
