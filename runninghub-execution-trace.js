// Optional, read-only provider progress. Polling remains authoritative.
// Binary preview frames, URLs, prompts, error text and credentials are ignored.
import {AKATZ_REVISION,AKATZ_NODE_CLASSES} from './h3-akatz-motion.js';
const BASE_NODES={1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',5:'LoraLoaderModelOnly',
  6:'LoraLoaderModelOnly',7:'LoraLoaderModelOnly',8:'MiniMaxH3SigmaShift',30:'LoadImage',
  31:'ImagePadForOutpaint',40:'KSamplerSelect',41:'BasicScheduler',49:'ImageBatchMulti',
  50:'VHS_LoadAudioUpload',490:'VHS_VideoCombine'};
const WINDOW_NODES=['VHS_LoadVideo','ImageFromBatch','RepeatImageBatch','ImageBatch',
  'MiniMaxH3ReferenceToVideo','MiniMaxH3AddGuide','ImageFromBatch','MiniMaxH3AddGuide',
  'RandomNoise','CFGGuider','SamplerCustomAdvanced','VAEDecode','ImageFromBatch','ImageCrop'];
export function h3NodeClass(node,plan){
  if(plan?.revision===AKATZ_REVISION)return AKATZ_NODE_CLASSES[String(node)]||null;
  if(!/^motion-transfer-native-1080-v[123456]$/.test(String(plan?.revision)))return null;
  if(plan.inferenceProfile==='native-photo-inventory-check')return ({30:'LoadImage',85:'CLIPLoader',86:'TextGenerate',495:'SaveText'})[node]||null;
  if(['native-fun-pose4-caption','native-fun-pose8-caption','native-fun-retarget4-caption','native-fun-retarget4-visual','native-fun-retarget4-face-performance','native-fun-retarget4-face-guard','native-fun-global4-face-attributes','native-fun-global8-face-attributes','native-fun-global4-warm-photo','native-fun-global4-face128','native-fun-global4-face128-keypoints'].includes(plan.inferenceProfile)){
    const globals={1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',6:'LoraLoaderModelOnly',13:'ModelPatchLoader',
      8:'MiniMaxH3SigmaShift',9:'ModelAttentionBackend',10:'BlockSparseAttention',16:'CheckpointLoaderSimple',17:'UNETLoader',30:'LoadImage',31:'ImagePadForOutpaint',40:'KSamplerSelect',
      49:'ImageBatchMulti',50:'VHS_LoadAudioUpload',60:'VHS_LoadVideo',61:'ImageScale',62:'RTDETR_detect',63:'SDPoseKeypointExtractor',
      64:'ImageScale',65:'RTDETR_detect',66:'SDPoseKeypointExtractor',67:'BodyRatioMapperProportionTransfer',68:'SDPoseDrawKeypoints',
      69:'BodyRatioMapperSDPoseRender',70:'ImageFromBatch',71:'ImageFromBatch',72:'ImageBatch',73:'BodyRatioMapperSDPoseRender',
      75:'ImageFromBatch',76:'RTDETR_detect',77:'SDPoseKeypointExtractor',
      78:'SDPoseFaceBBoxes',79:'CropByBBoxes',492:'SaveImage',493:'SaveImage',494:'VHS_VideoCombine',
      80:'GetImageSize',81:'MathExpression|pysssss',82:'ImageScale',
      85:'CLIPLoader',86:'TextGenerate',87:'StringConcatenate',490:'VHS_VideoCombine',495:'SaveText'};
    if(String(node)==='68'&&['native-fun-retarget4-visual','native-fun-retarget4-face-performance','native-fun-retarget4-face-guard','native-fun-global4-face-attributes','native-fun-global8-face-attributes','native-fun-global4-warm-photo','native-fun-global4-face128','native-fun-global4-face128-keypoints'].includes(plan.inferenceProfile))return 'BodyRatioMapperSDPoseRender';
    if(globals[node])return globals[node];
    const n=Number(node),index=Math.floor((n-1000)/30),offset=(n-1000)%30;
    const types=['VHS_LoadVideo','ImageFromBatch','RepeatImageBatch','ImageBatch','ResizeImageMaskNode','RTDETR_detect',
      'SDPoseKeypointExtractor','SDPoseDrawKeypoints','MiniMaxH3FunControlNetApply','MiniMaxH3ReferenceToVideo','BasicScheduler',
      'ImageFromBatch','MiniMaxH3AddGuide','RandomNoise','BasicGuider','SamplerCustomAdvanced','VAEDecode','ImageFromBatch','ImageCrop',
      'ImageFromBatch','ImageFromBatch','RepeatImageBatch','ImageBatch',
      'ImageFromBatch','ImageFromBatch','RepeatImageBatch','ImageBatch'];
    return Number.isSafeInteger(n)&&n>=1000&&index<plan.samplerCount&&offset<types.length?types[offset]:null;
  }
  const character=plan.inferenceProfile==='guide-dmad4-character-caption';
  if(character){
    if(String(node)==='7')return 'RHLoraLoader';
    if(String(node)==='85')return 'CLIPLoader';
    if(String(node)==='86')return 'TextGenerate';
  }
  if(String(node)==='9'&&plan.inferenceProfile==='tara-native')return 'BFSMiniMaxH3NativeTemporal';
  if(String(node)==='9'&&plan.inferenceProfile==='guide-kitchen')return 'ModelAttentionBackend';
  if(character||['guide-sol-focus','guide-dmad4-focus'].includes(plan.inferenceProfile)){
    if(String(node)==='9')return 'ModelAttentionBackend';
    if(String(node)==='10')return 'BlockSparseAttention';
    if(!character&&String(node)==='32')return 'ImageCrop';
  }
  if(BASE_NODES[node])return BASE_NODES[node];
  const n=Number(node),offset=(n-1000)%30,index=Math.floor((n-1000)/30);
  if(character&&Number.isSafeInteger(n)&&index>0&&index<plan.samplerCount){
    if(offset===14)return 'ImageFromBatch';
    if(offset===15)return 'ImageBatch';
  }
  return Number.isSafeInteger(n)&&n>=1000&&index<plan.samplerCount&&offset<WINDOW_NODES.length?
    WINDOW_NODES[offset]:null;
}
export function allowedProgressUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='wss:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&
      ['runninghub.ai','runninghub.cn'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain));
  }catch{return false;}
}
// Both status requests and accepted-create replies must resolve the task record.
// Account-only objects lack workflow/plan metadata. Pass no account credentials
// to the observer, and keep optional diagnostics out of paid-task error handling.
export function observeRegisteredH3Progress({taskId,url,registry,monitor}){
  if(!allowedProgressUrl(url))return false;
  try{
    const task=registry.get(String(taskId));
    if(!task||['success','failed'].includes(task.status))return false;
    return monitor.observe({taskId:task.taskId,workflow:task.workflow,
      inputDiagnostics:task.inputDiagnostics},url);
  }catch{return false;}
}
export function createExecutionTrace({taskId,plan,now=()=>Date.now(),emit,diagnosticText}){
  let current=null,startedAt=0,partial=true,lastValue=null,finished=false;
  const send=(event,fields={})=>emit({taskId:String(taskId),event,...fields});
  const nodeId=v=>(typeof v==='string'||typeof v==='number')&&/^\d{1,7}$/.test(String(v))?String(v):null;
  function finishNode(){
    if(current!==null)send('node_end',{node:current,nodeClass:h3NodeClass(current,plan),
      observedSeconds:Math.max(0,Math.round((now()-startedAt)/10)/100),partial});
    current=null;lastValue=null;
  }
  function select(node,isPartial){
    if(current===node)return;
    finishNode();current=node;startedAt=now();partial=isPartial;lastValue=null;
    send('node_start',{node,nodeClass:h3NodeClass(node,plan),partial});
  }
  return {message(raw){
    if(finished||typeof raw!=='string'||raw.length>65536)return;
    let message;try{message=JSON.parse(raw);}catch{return;}
    if(!message||typeof message!=='object'||Array.isArray(message))return;
    const data=message.data&&typeof message.data==='object'&&!Array.isArray(message.data)?message.data:{};
    if(message.type==='executed'&&plan?.inferenceProfile==='native-photo-inventory-check'&&String(data.node)==='495'&&diagnosticText){
      const text=data.output?.text;
      if(Array.isArray(text)&&text.length===1&&typeof text[0]==='string'&&text[0].length>0&&text[0].length<=8000){
        try{diagnosticText({taskId:String(taskId),text:text[0]});}catch{}
      }
    }else if(message.type==='executing'){
      if(data.node===null){finishNode();return;}
      const node=nodeId(data.node);if(node)select(node,false);
    }else if(message.type==='progress'){
      const node=nodeId(data.node);
      if(!node||!Number.isFinite(data.value)||!Number.isFinite(data.max)||
        data.value<0||data.max<1||data.value>data.max||data.max>100000)return;
      select(node,true);
      if(lastValue===data.value)return;
      lastValue=data.value;
      send('progress',{node,nodeClass:h3NodeClass(node,plan),value:data.value,max:data.max,
        observedSeconds:Math.max(0,Math.round((now()-startedAt)/10)/100),partial});
    }else if(message.type==='bfs-tara-monitor'){
      const node=nodeId(data.node);
      if(!node||!['evaluating','evaluation_complete'].includes(data.phase)||
        !Number.isSafeInteger(data.evaluation)||data.evaluation<1||data.evaluation>100000)return;
      const fields={node,nodeClass:h3NodeClass(node,plan),phase:data.phase,evaluation:data.evaluation};
      if(['flash partitions (no compile)','flex (original)','comfy kitchen (experimental)'].includes(data.backend))
        fields.backend=data.backend;
      for(const name of ['motion_rows','packed_rows','duration_seconds','elapsed_seconds'])
        if(Number.isFinite(data[name])&&data[name]>=0&&data[name]<=10000000)fields[name]=data[name];
      send('temporal_evaluation',fields);
    }else if(message.type==='execution_success'||message.type==='execution_error'){
      finishNode();finished=true;send(message.type);
    }
  },close(){if(!finished&&current!==null)partial=true;finishNode();finished=true;},get finished(){return finished;}};
}
export function createH3ExecutionMonitor({WebSocketImpl=globalThis.WebSocket,log=()=>{},now=()=>Date.now(),diagnosticText }={}){
  const connections=new Map(),attempts=new Map();
  function close(id){
    const c=connections.get(id);if(!c)return;
    connections.delete(id);c.trace.close();clearTimeout(c.timeout);
    try{c.socket.close();}catch{}
  }
  return {observe(task,url){
    const id=String(task?.taskId||'');
    if(!/^\d{10,25}$/.test(id)||!/^MiniMax H3 · Motion Control/.test(String(task?.workflow))||
      !allowedProgressUrl(url)||typeof WebSocketImpl!=='function'||connections.has(id))return false;
    const previous=attempts.get(id)||{count:0,at:0};
    if(previous.count>=3||now()-previous.at<30000&&previous.count)return false;
    attempts.set(id,{count:previous.count+1,at:now()});
    let socket;try{socket=new WebSocketImpl(url);}catch{log({taskId:id,event:'stream_unavailable'});return false;}
    const trace=createExecutionTrace({taskId:id,plan:task.inputDiagnostics,now,emit:log,diagnosticText});
    const timeout=setTimeout(()=>close(id),2*60*60*1000);timeout.unref?.();
    const connection={socket,trace,timeout};connections.set(id,connection);
    socket.addEventListener('open',()=>log({taskId:id,event:'stream_open'}));
    socket.addEventListener('message',event=>{
      try{trace.message(event.data);}catch{close(id);return;}
      if(trace.finished)close(id);
    });
    socket.addEventListener('error',()=>{log({taskId:id,event:'stream_unavailable'});close(id);});
    socket.addEventListener('close',()=>{if(connections.get(id)===connection){
      connections.delete(id);clearTimeout(timeout);trace.close();
      log({taskId:id,event:'stream_closed'});
    }});
    return true;
  },retain(ids){
    const keep=new Set(ids.map(String));
    for(const id of connections.keys())if(!keep.has(id))close(id);
    for(const id of attempts.keys())if(!keep.has(id))attempts.delete(id);
  },closeAll(){for(const id of connections.keys())close(id);attempts.clear();}};
}
