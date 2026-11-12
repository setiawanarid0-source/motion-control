const stages={1:['loading','Membaca video'],2:['interpolating','Interpolasi ke 60 FPS'],
  3:['encoding','Menyusun video'],900001:['original','Menyiapkan video asli'],
  900002:['archive','Menyiapkan ZIP'],900003:['archive','Mengemas ZIP']};
export function rifeProgressMessage(task){
  if(!/^RIFE ·/.test(String(task?.workflow)))return null;
  const progress=task.providerProgress;if(!progress?.label)return null;
  return progress.label+(Number.isFinite(progress.value)&&Number.isFinite(progress.max)?
    ' · '+progress.value+'/'+progress.max:'');
}
export function createRifeProgressRecorder({registry,now=()=>Date.now(),log=()=>{}}){
  const writes=new Map();
  return report=>{
    try{
      const task=registry.get(report.taskId);
      if(!task||!/^RIFE ·/.test(String(task.workflow))||['success','failed'].includes(task.status))return;
      if(!['node_start','node_end','progress','execution_success','execution_error'].includes(report.event))return;
      const previous=writes.get(report.taskId);
      if(report.event==='progress'&&previous?.node===report.node&&now()-previous.at<5000)return;
      const stage=stages[report.node];
      if(report.event==='node_end'||report.event==='execution_error'){
        log(report);return; // Polling alone decides success/failure.
      }
      if(!stage&&report.event!=='execution_success')return;
      const providerProgress={node:report.node||null,
        stage:stage?.[0]||'waiting_output',label:stage?.[1]||'Menunggu hasil RunningHub',
        lastUpdatedAt:new Date(now()).toISOString(),
        ...(report.event==='progress'?{value:report.value,max:report.max}:{})};
      registry.update(report.taskId,{status:task.status,providerProgress,
        statusDetail:rifeProgressMessage({...task,providerProgress})});
      writes.set(report.taskId,{node:report.node,at:now()});
      if(report.event==='execution_success')writes.delete(report.taskId);
      log(report);
    }catch{/* Optional progress must never interrupt an accepted provider job. */}
  };
}
