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
  if(!data||typeof data!=='object'||data.taskId||data.data?.taskId)return null;
  const sources=[
    data.msg,data.promptTips,data.data?.promptTips,data.data?.message,data.message,data,data.data
  ];
  for(const raw of sources) {
    const p=parsePromptTip(raw);
    if(p?.result===false && p.error?.type==='vhs_filenames_removed'){
      const code=data.code;
      // A success acknowledgement or any task ID remains uncertain. The
      // removed-port diagnosis is a definite refusal only with explicit failure.
      const failedCode=['number','string'].includes(typeof code)&&String(code).trim()!==''&&
        Number.isFinite(Number(code))&&Number(code)!==0;
      const directFailure=!Object.hasOwn(data,'code')&&data.result===false&&data.error?.type==='vhs_filenames_removed';
      if((failedCode||directFailure)&&data.success!==true&&data.result!==true&&
        data.data?.success!==true&&data.data?.result!==true)
        return p;
    }
    if(p?.result===false && ['prompt_outputs_failed_validation','missing_node_type'].includes(p.error?.type))
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
  if(rejected.error.type==='vhs_filenames_removed')return Object.assign(new Error(
    'RunningHub menolak sambungan Filenames pada Video Combine (vhs_filenames_removed). '+
    'Jalur ekspor video perlu diperbarui agar sesuai dengan node RunningHub. Task tidak diterima.'
  ),{code:RH_WORKFLOW_VALIDATION_CODE,definitelyRejected:true});
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
    'RunningHub menolak graph workflow ('+rejected.error.type+'). '
    +(rejected.error.type==='missing_node_type'?'Node tidak tersedia: '+clean(rejected.error.message,160)+'. ':'')
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
