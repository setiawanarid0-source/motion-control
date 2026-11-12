// Read-only provider receipts for slow RIFE jobs. Never submit or replay a job.
export const RIFE_AUDIT_VERSION=2;
export function nativeTaskExecutionSeconds(record){
  const value=record?.taskExecutedTime??record?.taskCostTime;
  return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&
    Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=7*86400?Number(value):null;
}
export function safeTaskMetrics(record){
  const metrics={};
  for(const [name,value] of Object.entries(record||{})){
    if(['instanceType','realInstanceType'].includes(name)&&['default','plus','lite','standard'].includes(value)){
      metrics[name]=value;continue;
    }
    if(!/^(?:taskCostTime|taskExecutedTime|lastUpdateTime|taskTime|duration|totalTime|(?:task)?(?:create[d]?|submit(?:ted)?|start(?:ed)?|end(?:ed)?|finish(?:ed)?|run(?:ning)?|execution|exec|cost|queue[d]?|wait(?:ing)?)(?:At|Time|Date|Duration|Seconds|Millis|Ms)|width|height|fps|frameCount|progress|queuePosition)$/i.test(name))continue;
    if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e15)metrics[name]=value;
    else if(typeof value==='string'&&/^(?:\d{1,15}(?:\.\d{1,6})?|\d{4}-\d{2}-\d{2}[T ][0-9:.+Z-]{5,25}|\d{1,3}:\d{2}:\d{2}(?:\.\d+)?)$/.test(value))metrics[name]=value;
  }
  return metrics;
}
export async function auditRifeTasks({tasks,query,update,log=()=>{},now=()=>Date.now(),limit=2}){
  const time=now();
  const candidates=tasks.filter(task=>/^RIFE ·/.test(String(task.workflow))&&
    (['success','failed'].includes(task.status)?task.rifeAuditVersion!==RIFE_AUDIT_VERSION:
      time-Date.parse(task.submittedAt)>=5*60000&&(!task.rifeAuditCheckedAt||time-Date.parse(task.rifeAuditCheckedAt)>=60000)))
    .slice(0,limit);
  await Promise.all(candidates.map(async task=>{
    const checkedAt=new Date(time).toISOString();
    try{
      const report=await query(task);
      // No output URLs, arbitrary error text, prompts or credentials in logs.
      const receipt={taskId:task.taskId,state:task.status,mode:task.mode,
        submittedAt:task.submittedAt,finishedAt:task.finishedAt||null,
        providerStatus:report.taskStatus,found:report.found,
        metrics:safeTaskMetrics(report.taskMetrics),providerRuntimeSeconds:nativeTaskExecutionSeconds(report.taskMetrics),
        recordFields:report.lookups?.flatMap(x=>x.recordFields||[]).filter((x,i,a)=>a.indexOf(x)===i),
        outputCount:Array.isArray(report.outputs)?report.outputs.length:null,
        failureCategory:report.failure?.category||null};
      const seconds=nativeTaskExecutionSeconds(report.taskMetrics);
      await update(task.taskId,{status:task.status,rifeAuditCheckedAt:checkedAt,rifeAuditVersion:RIFE_AUDIT_VERSION,
        ...(task.status==='success'&&seconds!==null?{providerRuntimeSeconds:seconds,providerTimingCheckedAt:checkedAt}:{})});
      log(receipt);
    }catch{
      await update(task.taskId,{status:task.status,rifeAuditCheckedAt:checkedAt,rifeAuditVersion:RIFE_AUDIT_VERSION});
      log({taskId:task.taskId,state:task.status,lookupSucceeded:false});
    }
  }));
  return candidates.length;
}
