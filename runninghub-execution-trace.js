// Optional, read-only provider progress. Polling remains authoritative.
// Binary preview frames, URLs, prompts, error text and credentials are ignored.
const BASE_NODES={1:'UNETLoader',2:'CLIPLoader',3:'VAELoader',4:'VAELoader',5:'LoraLoaderModelOnly',
  6:'LoraLoaderModelOnly',7:'LoraLoaderModelOnly',8:'MiniMaxH3SigmaShift',30:'LoadImage',
  31:'ImagePadForOutpaint',40:'KSamplerSelect',41:'BasicScheduler',49:'ImageBatchMulti',
  50:'VHS_LoadAudioUpload',490:'VHS_VideoCombine'};
const WINDOW_NODES=['VHS_LoadVideo','ImageFromBatch','RepeatImageBatch','ImageBatch',
  'MiniMaxH3ReferenceToVideo','MiniMaxH3AddGuide','ImageFromBatch','MiniMaxH3AddGuide',
  'RandomNoise','CFGGuider','SamplerCustomAdvanced','VAEDecode','ImageFromBatch','ImageCrop'];
export function h3NodeClass(node,plan){
  if(!/^motion-transfer-native-1080-v[123]$/.test(String(plan?.revision)))return null;
  if(BASE_NODES[node])return BASE_NODES[node];
  const n=Number(node),offset=(n-1000)%30,index=Math.floor((n-1000)/30);
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
export function createExecutionTrace({taskId,plan,now=()=>Date.now(),emit}){
  let current=null,startedAt=0,partial=true,lastValue=null,finished=false;
  const send=(event,fields={})=>emit({taskId:String(taskId),event,...fields});
  const nodeId=v=>/^\d{1,7}$/.test(String(v??''))?String(v):null;
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
    const data=message?.data||{};
    if(message.type==='executing'){
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
    }else if(message.type==='execution_success'||message.type==='execution_error'){
      finishNode();finished=true;send(message.type);
    }
  },close(){finishNode();finished=true;},get finished(){return finished;}};
}
export function createH3ExecutionMonitor({WebSocketImpl=globalThis.WebSocket,log=()=>{},now=()=>Date.now() }={}){
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
    const trace=createExecutionTrace({taskId:id,plan:task.inputDiagnostics,now,emit:log});
    const timeout=setTimeout(()=>close(id),2*60*60*1000);timeout.unref?.();
    const connection={socket,trace,timeout};connections.set(id,connection);
    socket.addEventListener('open',()=>log({taskId:id,event:'stream_open'}));
    socket.addEventListener('message',event=>{
      trace.message(event.data);
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
