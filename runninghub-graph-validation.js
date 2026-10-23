// Identify explicit pre-execution ComfyUI graph validation rejection.
// Transport timeouts or unknown responses are NEVER treated as a confirmed reject.
export const RH_WORKFLOW_VALIDATION_CODE = 'RUNNINGHUB_WORKFLOW_VALIDATION';

function parsePromptTip(candidate) {
  if(!candidate)return null;
  if(typeof candidate==='object' && !Array.isArray(candidate))return candidate;
  if(typeof candidate!=='string'||candidate.length>300000)return null;
  try {
    const parsed=JSON.parse(candidate);
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : null;
  }catch{return null;}
}

export function findValidationRejection(data) {
  if(!data||typeof data!=='object'||data.data?.taskId)return null;
  const sources=[
    data.msg,data.promptTips,data.data?.promptTips,data.data?.message,data.message
  ];
  for(const raw of sources) {
    const p=parsePromptTip(raw);
    if(p?.result===false && p.error?.type==='prompt_outputs_failed_validation')
      return p;
  }
  return null;
}

function clean(value,limit=100) {
  return String(value??'').replace(/[\u0000-\u001f]/g,' ')
    .replace(/[^\w .:;()\-]/g,' ').trim().slice(0,limit);
}
export function graphValidationError(response) {
  const rejected=findValidationRejection(response);
  if(!rejected)return null;
  const details=Object.entries(rejected.node_errors||{})
    .slice(0,3)
    .map(([nodeId,node])=>{
      const problems=Array.isArray(node?.errors)?node.errors.slice(0,2):[];
      const message=problems.map(e=>clean(e?.message||e?.type,80))
        .filter(Boolean).join('; ');
      const nodeType=clean(node?.class_type||'',40);
      return [clean(nodeId,15),nodeType,message].filter(Boolean).join(' · ');
    }).filter(Boolean).join(' | ');
  const error=new Error(
    'RunningHub menolak graph workflow (prompt_outputs_failed_validation). '
    +(details?'Node bermasalah: '+details+'. ':'')
    +'Periksa ketersediaan node, model, dan workflow H3 di RunningHub. Task tidak diterima.'
  );
  error.code=RH_WORKFLOW_VALIDATION_CODE;
  error.definitelyRejected=true;
  return error;
}

export function isDefinitelyRejectedGraph(error) {
  return error?.code===RH_WORKFLOW_VALIDATION_CODE&&error.definitelyRejected===true;
}
