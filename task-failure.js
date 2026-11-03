// Extract only bounded, user-relevant diagnostics from RunningHub /task/openapi/outputs.
// Never return current_inputs, traceback, API keys, execution URLs, or raw task data.
const scalar=(value,max=400)=>typeof value==='string'||typeof value==='number'?String(value).trim().slice(0,max):'';
function readReason(raw){
  if(!raw)return null;
  if(typeof raw==='object'&&!Array.isArray(raw))return raw;
  if(typeof raw==='string'){
    try{const parsed=JSON.parse(raw);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}
    catch{return {exception_message:raw};}
  }
  return null;
}
export function extractTaskFailure(result){
  const payload=result?.data;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const reason=readReason(payload.failedReason??payload.failed_reason);
  if(!reason)return null;
  const failure={
    nodeId:scalar(reason.node_id??reason.nodeId,40),
    nodeName:scalar(reason.node_name??reason.nodeName,100),
    exceptionType:scalar(reason.exception_type??reason.exceptionType,100),
    message:scalar(reason.exception_message??reason.exceptionMessage,400)
  };
  return Object.values(failure).some(Boolean)?failure:null;
}

export function classifyH3Failure(result){
  const failure=result?.failure||extractTaskFailure(result);
  const text=[failure?.exceptionType,failure?.message,result?.msg].filter(x=>typeof x==='string').join(' ');
  if(/cancel|cancell|abort(?:ed)? by user/i.test(text))return 'cancelled';
  if(/out.of.memory|cuda.*memory|memory.*exhaust|\boom\b/i.test(text))return 'out_of_memory';
  if(/timed?\s*out|timeout|time.?limit|maximum.*(?:runtime|execution time)|exceed.*(?:time|duration)/i.test(text))return 'runtime_limit';
  return 'unclassified';
}

// Once-only terminal metadata lookup; no new render, retry or cancellation.
export async function auditFailedH3Tasks({tasks,query,update,log=()=>{},now=()=>new Date().toISOString(),limit=1}){
  const candidates=tasks.filter(t=>t.status==='failed'&&
    /^MiniMax H3 · (?:Motion Control|Akatz V1\.5 Native)(?: ·|$)/.test(String(t.workflow))&&!t.failureAuditCheckedAt).slice(0,limit);
  for(const task of candidates){
    let result=null,lookupSucceeded=false;
    try{result=await query(task);lookupSucceeded=true;}catch{}
    const failure=extractTaskFailure(result),category=classifyH3Failure(result);
    await update(task.taskId,{status:'failed',failureAuditCheckedAt:now(),failureCategory:category});
    log({taskId:String(task.taskId),category,lookupSucceeded,
      providerCode:result?.code!==null&&result?.code!==undefined&&Number.isFinite(Number(result.code))?Number(result.code):null,
      nodeId:/^\d{1,7}$/.test(failure?.nodeId||'')?failure.nodeId:null,
      nodeName:/^[\w .|:-]{1,100}$/.test(failure?.nodeName||'')?failure.nodeName:null,
      exceptionType:/^[\w.]{1,100}$/.test(failure?.exceptionType||'')?failure.exceptionType:null});
  }
  return candidates.length;
}
