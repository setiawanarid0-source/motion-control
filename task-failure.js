// Extract only bounded, user-relevant diagnostics from RunningHub /task/openapi/outputs.
// Never return current_inputs, traceback, API keys, execution URLs, or raw task data.
import {safeTaskMetrics,nativeTaskExecutionSeconds} from './rife-task-audit.js';
export const H3_FAILURE_AUDIT_VERSION=2;
const scalar=(value,max=400)=>typeof value==='string'||typeof value==='number'?String(value).trim().slice(0,max):'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
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
  const payload=object(result?.data);
  const reasons=[payload?.failedReason,payload?.failed_reason,result?.failedReason,result?.failed_reason];
  // Web /task/list wraps taskStatus/errorType/errorMessage inside data. Modern
  // API replies use status/errorCode at the root. An empty failedReason must
  // not hide those terminal-record fields.
  for(const record of [payload,object(result)]){
    if(!record||!['FAILED','ERROR','CANCELED','CANCELLED'].includes(record.taskStatus??record.status))continue;
    reasons.push(record.errorMessage,record);
  }
  const failure={nodeId:'',nodeName:'',exceptionType:'',message:''};
  for(const raw of reasons){
    const reason=readReason(raw);if(!reason)continue;
    const fields={
      nodeId:scalar(reason.node_id??reason.nodeId,40),
      nodeName:scalar(reason.node_name??reason.nodeName,100),
      exceptionType:scalar(reason.exception_type??reason.exceptionType??reason.errorType??reason.errorCode,100),
      message:scalar(reason.exception_message??reason.exceptionMessage??reason.errorMessage,400)
    };
    for(const name of Object.keys(failure))if(!failure[name]&&fields[name])failure[name]=fields[name];
  }
  return Object.values(failure).some(Boolean)?failure:null;
}

export function classifyH3Failure(result){
  const failure=result?.failure||extractTaskFailure(result);
  const text=[failure?.exceptionType,failure?.message,result?.msg,result?.errorCode,result?.data?.errorCode]
    .filter(x=>typeof x==='string').join(' ');
  if(/cancel|cancell|abort(?:ed)? by user/i.test(text))return 'cancelled';
  if(/out.of.memory|cuda.*memory|memory.*exhaust|\boom\b/i.test(text))return 'out_of_memory';
  if(/timed?\s*out|timeout|time.?limit|maximum.*(?:runtime|execution time)|exceed.*(?:time|duration)/i.test(text))return 'runtime_limit';
  return 'unclassified';
}

const safeCode=value=>/^[\w.-]{1,100}$/.test(String(value??''))?String(value):null;
function evidenceScore(result){
  const f=result?.failure||extractTaskFailure(result);if(!f)return -1;
  return (classifyH3Failure(result)==='unclassified'?0:100)+
    (f.exceptionType&&!/^(?:CRASH|ERROR|FAILED)$/i.test(f.exceptionType)?4:0)+
    (f.nodeId?2:0)+(f.nodeName?1:0)+(f.message?1:0);
}
function technicalSignals(failure,record){
  const text=[failure?.exceptionType,failure?.message,record?.errorCode,record?.errorType,record?.errorMessage]
    .filter(x=>typeof x==='string').join(' ');
  return Object.entries({
    out_of_memory:/out.of.memory|cuda.*memory|memory.*exhaust|\boom\b/i,
    runtime_limit:/timed?\s*out|timeout|time.?limit|exceed.*(?:time|duration)/i,
    tensor_shape:/shape|dimension|size.*tensor|tensor.*size|broadcast|mat[12].*multipl/i,
    missing_file:/FileNotFoundError|No such file|file.*not found/i,
    connection_failure:/ConnectionError|ConnectionReset|connection.*(?:refused|closed|reset)/i,
    process_killed:/SIGKILL|process.*killed|exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*137/i
  }).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
}

// Once-only terminal metadata lookup; no new render, retry or cancellation.
export async function auditFailedH3Tasks({tasks,query,queryV2,update,log=()=>{},now=()=>new Date().toISOString(),limit=1}){
  const candidates=tasks.filter(t=>t.status==='failed'&&
    /^MiniMax H3 · (?:Motion Control|Akatz V1\.5 Native)(?: ·|$)/.test(String(t.workflow))&&
    (!t.failureAuditCheckedAt||queryV2&&t.failureCategory==='unclassified'&&
      (!t.failureV2CheckedAt||t.failureAuditVersion!==H3_FAILURE_AUDIT_VERSION))).slice(0,limit);
  for(const task of candidates){
    let result=null,modern=null,lookupSucceeded=false,detailLookupSucceeded=false;
    try{result=await query(task);lookupSucceeded=true;}catch{}
    let failureV2CheckedAt=null;
    // A generic CRASH is a label, not a diagnosis. Check the second source
    // once even if the first response contains a nonempty but unclassified
    // reason. The versioned checkpoint also repairs old false "checked" flags.
    if(classifyH3Failure(result)==='unclassified'&&queryV2){
      try{
        modern=await queryV2(task);detailLookupSucceeded=true;lookupSucceeded=true;
        const detail=extractTaskFailure(modern);
        if(detail&&evidenceScore(modern)>evidenceScore(result))
          result={...modern,code:result?.code??modern?.code,failure:detail};
      }catch{} // A diagnostics outage never changes the terminal state.
      failureV2CheckedAt=now();
    }
    const failure=result?.failure||extractTaskFailure(result),category=classifyH3Failure(result);
    await update(task.taskId,{status:'failed',failureAuditCheckedAt:now(),failureCategory:category,
      failureAuditVersion:H3_FAILURE_AUDIT_VERSION,
      ...(failureV2CheckedAt?{failureV2CheckedAt}:{})});
    const record=object(modern?.data)||object(modern);
    log({taskId:String(task.taskId),category,lookupSucceeded,detailLookupSucceeded,
      auditVersion:H3_FAILURE_AUDIT_VERSION,
      providerCode:result?.code!==null&&result?.code!==undefined&&Number.isFinite(Number(result.code))?Number(result.code):null,
      nodeId:/^\d{1,7}$/.test(failure?.nodeId||'')?failure.nodeId:null,
      nodeName:/^[\w .|:-]{1,100}$/.test(failure?.nodeName||'')?failure.nodeName:null,
      exceptionType:safeCode(failure?.exceptionType),
      nativeStatus:safeCode(record?.taskStatus??record?.status),
      nativeErrorCode:safeCode(record?.errorCode),nativeErrorType:safeCode(record?.errorType),
      metrics:safeTaskMetrics(record),providerRuntimeSeconds:nativeTaskExecutionSeconds(record),
      technicalSignals:technicalSignals(failure,record),
      recordFields:Object.keys(record||{}).filter(name=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)&&
        !/key|token|secret|password|prompt|url|input|output/i.test(name)).slice(0,60)});
  }
  return candidates.length;
}
