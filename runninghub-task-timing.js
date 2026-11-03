// Read-only timing diagnostics. Never submit, cancel or retry a paid task.
// taskCostTime is the provider's workflow execution duration, repeated per file;
// it must not be summed across outputs or called GPU-kernel time/queue time.
export function providerExecutionSeconds(response){
  if(Number(response?.code)!==0||!Array.isArray(response?.data))return null;
  const values=response.data.map(x=>x?.taskCostTime).filter(v=>
    (typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&
    Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=7*86400).map(Number);
  return values.length?Math.max(...values):null;
}
export function taskTimingReport(task,executionSeconds){
  const start=Date.parse(task.submittedAt||''),end=Date.parse(task.finishedAt||'');
  const observed=Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/1000:null;
  const round=n=>n===null?null:Math.round(n*1000)/1000;
  return {taskId:String(task.taskId),workflow:task.workflow,
    observedTotalSeconds:round(observed),providerExecutionSeconds:executionSeconds,
    // Includes queue/allocation, API/poll/delivery delays; cannot isolate them.
    unassignedSeconds:observed!==null&&executionSeconds!==null&&observed>=executionSeconds?
      round(observed-executionSeconds):null};
}
export async function auditCompletedH3Timings({tasks,query,update,log=()=>{},now=()=>new Date().toISOString(),limit=2}){
  const candidates=tasks.filter(t=>t.status==='success'&&
    /^MiniMax H3 · (?:Motion Control|Akatz V1\.5 Native)(?: ·|$)/.test(String(t.workflow))&&!t.providerTimingCheckedAt).slice(0,limit);
  await Promise.all(candidates.map(async task=>{
    let seconds=null,lookupSucceeded=false,providerCode=null;
    try{
      const response=await query(task);
      seconds=providerExecutionSeconds(response);lookupSucceeded=true;
      if(response?.code!==null&&response?.code!==undefined&&Number.isFinite(Number(response.code)))providerCode=Number(response.code);
    }catch{}
    // This is a metadata-only update: never reset finishedAt, result URLs,
    // credentials, terminal state, archive or the user's existing duration.
    const patch={status:task.status,providerRuntimeSeconds:seconds,providerTimingCheckedAt:now()};
    await update(task.taskId,patch);
    log({...taskTimingReport(task,seconds),lookupSucceeded,providerCode});
  }));
  return candidates.length;
}
