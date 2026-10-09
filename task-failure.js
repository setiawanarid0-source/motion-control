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
