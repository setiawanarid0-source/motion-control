const state = {
  view: 'create', workflow: 'r15', mode: 'standard', session: null, accounts: [],
  image: null, video: null, videoDuration: 0, task: null, pollTimer: null, elapsedTimer: null, startedAt: null,
  historyPollTimer: null, historyClockTimer: null, historyPollBusy: false, historyFilter: 'all',
  registeredTaskIds: new Set(), submission:null, submissionTimer:null, submissionPolling:false,
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function getDeviceId(){
  const key='vantaDeviceIdV1';
  let id=localStorage.getItem(key);
  if(!id){
    if(globalThis.crypto?.randomUUID) id=crypto.randomUUID().replaceAll('-','');
    else id=`${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key,id);
  }
  return id;
}

function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.classList.toggle('error',error); el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),4200); }
function fmtTime(seconds){ seconds=Math.max(0,Math.round(seconds||0)); const m=Math.floor(seconds/60),s=seconds%60; return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`; }
function fmtElapsed(ms){
  const sec=Math.floor(Math.max(0,Number(ms)||0)/1000);
  const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
}
function renderLiveTaskDuration(){
  if(!state.task||!['running','processing','waiting_output','finalizing'].includes(state.task.currentState))return;
  const started=Date.parse(state.task.submittedAt||'');
  if(!Number.isFinite(started))return;
  const el=$('#taskEstimate');
  if(el)el.textContent='Sejak dikirim · '+fmtElapsed(Date.now()-started);
}
function machineLabel(mode){return mode==='plus'?'Plus':mode==='lite'?'Lite':'Standard';}
function fileSize(n){ if(!n)return '0 B'; const u=['B','KB','MB','GB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(i?1:0)} ${u[i]}`; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function switchView(view){
  if(!document.getElementById('view-'+view))return;
  state.view=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={create:'Motion Control','image-create':'Image Generation',history:'Motion History',
    'image-history':'Image History',accounts:'RunningHub Pool','kie-accounts':'kie.ai Pool'};
  $('#pageTitle').textContent=titles[view]||'VANTA Studio';
  const group=['create','image-create'].includes(view)?'create':
    ['history','image-history'].includes(view)?'history':'accounts';
  document.querySelectorAll('.nav-group').forEach(x=>{
    const opened=x.dataset.group===group;
    x.classList.toggle('expanded',opened);
    x.querySelector('[data-nav-group]')?.setAttribute('aria-expanded',String(opened));
  });
  $('#sidebar').classList.remove('open');
  $('#sidebarOverlay')?.classList.remove('visible');
  document.body.classList.remove('sidebar-open');
  if(view==='history')renderHistory();
  if(view==='accounts')refreshAccounts();
  window.vantaKieNavigation?.(view);
}

async function api(url, options={}){ const r=await fetch(url,{...options,headers:{'X-Vanta-Device':getDeviceId(),...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}}); let data={}; try{data=await r.json()}catch{} if(!r.ok){const error=new Error(data.error||`HTTP ${r.status}`);error.status=r.status;throw error;}return data; }

async function claimBrowserHistory(){
  const selected=history()
    .filter(x=>x.taskId&&x.accountId)
    .sort((a,b)=>(isActiveHistoryStatus(b.status)?1:0)-(isActiveHistoryStatus(a.status)?1:0))
    .slice(0,30);
  if(!selected.length)return true;
  try{
    const claimed=await api('/api/tasks/claim',{method:'POST',body:JSON.stringify({tasks:selected.map(x=>({
      taskId:x.taskId,accountId:x.accountId,startedAt:x.startedAt,workflow:x.workflow,
      mode:x.mode,video:x.video,outputKind:x.outputKind
    }))})});
    // When a legacy task is still active, never retire its account until the
    // server has safely captured its credential for independent monitoring.
    const accepted=new Set((claimed.restoredIds||[]).map(String));
    const mustPreserve=selected.filter(x=>isActiveHistoryStatus(x.status)||x.status==='success');
    if(mustPreserve.some(x=>!accepted.has(String(x.taskId))))return false;
    return true;
  }catch(error){
    console.warn('History claim will retry',error.message);
    return false;
  }
}
async function syncServerHistory(){
  try{
    const data=await api('/api/tasks/history');
    const remote=Array.isArray(data.tasks)?data.tasks:[];
    state.registeredTaskIds=new Set(remote.map(x=>String(x.taskId)));
    const locals=history();
    const merged=new Map(locals.map(x=>[String(x.taskId),x]));
    for(const task of remote){
      const id=String(task.taskId),local=merged.get(id)||{};
      const preserveSuccess=local.status==='success'&&task.status==='check_error';
      merged.set(id,{...local,taskId:id,accountId:task.accountId,account:task.accountName,
        workflow:task.workflow||local.workflow,mode:task.mode||local.mode,
        outputKind:task.outputKind||local.outputKind,video:task.video||local.video,
        startedAt:task.submittedAt||local.startedAt,
        status:preserveSuccess?'success':task.status,
        ...(preserveSuccess?{}:{finishedAt:task.finishedAt||local.finishedAt,
          resultUrl:task.resultUrl||local.resultUrl,
          referenceMaskUrl:task.referenceMaskUrl||local.referenceMaskUrl,
          cameraQA:task.cameraQA||local.cameraQA,
          error:task.error||null,statusDetail:task.statusDetail||null,
          providerCode:task.providerCode??null,deliveryNote:task.deliveryNote||null})});
    }
    setHistory([...merged.values()].sort((a,b)=>Date.parse(b.startedAt||0)-Date.parse(a.startedAt||0)));
    if(state.view==='history')renderHistory();
  }catch(error){console.warn('Server History synchronization pending',error.message);}
}
async function loadSession(){
  state.session=await api('/api/session');
  state.accounts=state.session.accounts||[];
  renderAccountSelect();renderAccounts();updatePoolSummary();
  // The UI loads promptly, but account retirement runs only once browser-only
  // History has been safely claimed in the server vault.
  await syncServerHistory();
  claimBrowserHistory().then(async claimed=>{
    state.historyClaimed=Boolean(claimed);
    await refreshAccounts();
    if(!claimed)console.warn('Automatic account retirement deferred until History is preserved');
    await syncServerHistory();
  }).catch(error=>console.warn('Background History recovery',error.message));
}
function sortedRunningHubAccounts(){
  const coins=a=>a.status&&!a.status.error&&a.status.remainCoins!=null&&Number.isFinite(Number(a.status.remainCoins))
    ?Number(a.status.remainCoins):null;
  return [...state.accounts].sort((a,b)=>{
    const x=coins(a),y=coins(b);
    if(x===null&&y!==null)return 1;
    if(y===null&&x!==null)return -1;
    if(x!==null&&y!==null&&x!==y)return y-x;
    const recent=Date.parse(b.addedAt||'')-Date.parse(a.addedAt||'');
    return Number.isFinite(recent)&&recent!==0?recent:String(a.id).localeCompare(String(b.id));
  });
}
function renderAccountSelect(){ const sel=$('#accountSelect'); const current=sel.value||'auto'; sel.innerHTML='<option value="auto">Automatic · minimal 100 RH</option>'+sortedRunningHubAccounts().map(a=>{
  const credits=a.status&&!a.status.error?Number(a.status.remainCoins):NaN;
  const reason=a.canGenerate===false?(Number.isFinite(credits)&&credits<100?' (di bawah 100 RH)':' (status belum tersedia)'):'';
  return `<option value="${a.id}" ${a.canGenerate===false?'disabled':''}>${escapeHtml(a.name)}${reason}</option>`;
}).join(''); sel.value=[...sel.options].some(o=>o.value===current&&!o.disabled)?current:'auto'; }

async function refreshAccounts(){
  const refreshBtn=$('#refreshAccounts');
  if(refreshBtn){ refreshBtn.disabled=true; refreshBtn.classList.add('refreshing'); }
  if(!state.accounts.length){
    state.accounts=[];
    renderAccounts();
    updatePoolSummary();
    if(refreshBtn){ refreshBtn.disabled=false; refreshBtn.classList.remove('refreshing'); }
    return;
  }
  try{
    const data=await api('/api/accounts/refresh',{method:'POST',
      body:JSON.stringify({allowRetirement:state.historyClaimed===true})});
    state.accounts=data.accounts||[];
    renderAccounts();
    updatePoolSummary();
    renderAccountSelect();
    if(data.autoRemovedCount>0)toast(`${data.autoRemovedCount} akun dikeluarkan dari pilihan generasi. Task lama tetap dipantau.`);
  }catch(e){
    toast(e.message,true);
  }finally{
    if(refreshBtn){ refreshBtn.disabled=false; refreshBtn.classList.remove('refreshing'); }
  }
}
function updatePoolSummary(){ const healthy=state.accounts.filter(a=>a.canGenerate===true); $('#poolCount').textContent=`${healthy.length} akun siap`; $('#poolCredits').textContent=String(healthy.length); const unit=$('#poolReadyUnit'); if(unit)unit.textContent='akun siap'; $('#poolDot').classList.toggle('ready',healthy.length>0); updateGenerate(); }
function renderAccounts(){
  const root=$('#accountList'); if(!state.accounts.length){root.innerHTML='<div class="empty-state">Belum ada API key di pool.<br>Tambahkan akun pertama dari panel di sebelah kiri.</div>';return;}
  root.innerHTML=sortedRunningHubAccounts().map(a=>{const s=a.status||{};const ok=!s.error&&a.status,ready=a.canGenerate===true;return `<div class="account-card"><div><div class="account-card-main"><div class="account-icon">◎</div><div><strong>${escapeHtml(a.name)}</strong><small>${ready?'Siap digunakan':ok&&Number(s.currentTaskCounts||0)>0?'Menunggu task berjalan selesai':ok?'Saldo tidak memenuhi syarat':'Status tidak tersedia'}</small></div></div><div class="account-metrics"><span>RH ${ok?Number(s.remainCoins||0).toLocaleString('id-ID'):'—'}</span><span>Tasks ${ok?Number(s.currentTaskCounts||0):'—'}</span>${s.error?`<span>${escapeHtml(s.error)}</span>`:''}</div></div><button class="delete-account" data-delete="${a.id}" type="button" aria-label="Remove ${escapeHtml(a.name)}" title="Remove account"><span class="delete-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg></span><span class="delete-account-label">Remove</span></button></div>`}).join('');
  $('[data-delete]').forEach(btn=>btn.onclick=async()=>{try{
    // Claim browser-only completed History BEFORE changing the provider key vault.
    await claimBrowserHistory();
    const existing=history().filter(x=>x.accountId===btn.dataset.delete&&x.status==='success');
    if(existing.length){
      const remote=await api('/api/tasks/history');
      const captured=new Set((remote.tasks||[]).map(x=>String(x.taskId)));
      if(existing.some(x=>!captured.has(String(x.taskId))))
        throw Error('Akun belum dihapus: ada hasil lama yang belum aman didaftarkan di History VANTA.');
    }
    await api(`/api/accounts/${btn.dataset.delete}`,{method:'DELETE'});
    toast('Akun dikeluarkan dari pool; hasil History tetap disimpan di VANTA.');
    await loadSession();
  }catch(e){toast(e.message,true)}});
}

function setMedia(kind,file){
  if(kind==='image'){state.image=file;const p=$('#imagePreview'); if(!file){p.innerHTML='';p.classList.remove('active');updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<img src="${url}" alt="Reference preview"><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small>${fileSize(file.size)}</small></div><button class="remove-media" data-remove="image">×</button></div>`;p.classList.add('active');}
  else{state.video=file;const p=$('#videoPreview'); if(!file){p.innerHTML='';p.classList.remove('active');state.videoDuration=0;updateEstimates();updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<video src="${url}" muted playsinline preload="metadata"></video><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small id="videoFileMeta">${fileSize(file.size)}</small></div><button class="remove-media" data-remove="video">×</button></div>`;p.classList.add('active');const v=p.querySelector('video');v.onloadedmetadata=()=>{state.videoDuration=v.duration||0;$('#videoFileMeta').textContent=`${fileSize(file.size)} · ${fmtTime(v.duration)}`;updateEstimates();};}
  $$('[data-remove]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();setMedia(btn.dataset.remove,null)});updateGenerate();
}
function lastSam3Diagnostic(){return history().filter(x=>x.outputKind==='diagnostic'&&x.status==='success'&&x.taskId&&resolveHistoryAccountId(x)).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0]||null;}
function refreshLabNotice(){const item=lastSam3Diagnostic(),el=$('#r4LabMaskSource');if(el)el.textContent=item?`Mask dari task SAM3 #${item.taskId} (${new Date(item.startedAt).toLocaleString('id-ID')}). Gunakan gambar dan video kompensasi yang sama.`:'Belum ada hasil SAM3 berhasil di History browser ini. Jalankan tes SAM3 terlebih dahulu.';}
function updateEstimates(){
  // Plus runtime/credit estimates are not validated for these custom workflows.
  // Preserve the existing Standard estimate for Current only; do not invent a Plus value.
  for(const id of ['standardCredits','standardTime','plusCredits','plusTime'])$('#'+id).textContent='—';
  if(state.workflow!=='current'||!state.videoDuration)return;
  const standardRuntime=state.videoDuration*21.2;
  $('#standardTime').textContent=`± ${fmtTime(standardRuntime)}`;
  $('#standardCredits').textContent=`~ ${(standardRuntime*.20).toFixed(1)} RH`;
}
function updateGenerate(){
  // RunningHub accepts independent paid tasks; only the current reference
  // upload/submission is exclusive. Accepted tasks continue in History.
  const ready=Boolean((state.workflow==='rife60'||state.image)&&state.video&&state.accounts.some(a=>a.canGenerate===true)&&
    !state.submission&&(state.workflow!=='r4Lab'||!!lastSam3Diagnostic()));
  $('#generateBtn').disabled=!ready;
  if(!state.submission)$('#generateBtn').querySelector('span:first-child').textContent=
    state.workflow==='koh1AntiObject'?'Jalankan tes SAM3':
    state.workflow==='r4Lab'?'Tes R4 Full (berbayar)':
    state.workflow==='rife60'?'Interpolasi 60 FPS':'Generate motion';
  refreshLabNotice();
}
function workflowName(){
  if(state.workflow==='rife60')return 'RIFE Adaptive · hingga 60 FPS';
  if(state.workflow==='r15')return 'MotionFly R4 · Camera Engine (R15)';
  if(state.workflow==='koh1AntiObject')return 'MotionFly R4 · SAM3 Mask Diagnostic';
  if(state.workflow==='r4Lab')return 'MotionFly R4 · Full Controlled Test';
  return 'Current Workflow';
}
function estimateSeconds(){ if(state.workflow!=='current'||state.mode!=='standard'||!state.videoDuration)return 0; return state.videoDuration*21.2; }
function startVisibleTimer(){
  // Internal task timestamps are retained for History; no unsolicited duration UI.
  state.startedAt=Date.now();
}
// Keep provider preflight errors visible rather than relying on a disappearing toast.
function clearFailureDetail(){
  const el=$('#taskFailureDetail');
  if(el){el.textContent='';el.classList.add('hidden');}
}
function displaySubmissionFailure(data,{restored=false}={}){
  const msg=String(data?.error||'Alasan kegagalan tidak dikembalikan provider.').trim().slice(0,950);
  const providerStage=data?.failureStage==='submitting';
  const ambiguous=data?.stage==='uncertain';
  const rejectedGraph=/prompt_outputs_failed_validation|RUNNINGHUB_WORKFLOW_VALIDATION/i.test(msg);
  const capacityFull=/TASK_QUEUE_MAXED/i.test(String(data.error||''));
  $('#taskSection').classList.remove('hidden');
  $('#taskStatus').textContent=ambiguous?'Status penerimaan belum pasti':
    capacityFull?'Antrean akun penuh':
    rejectedGraph?'Workflow ditolak RunningHub':
    providerStage?'Pengiriman gagal':'Persiapan belum berhasil';
  $('#taskEstimate').textContent=ambiguous?
    'Jangan kirim ulang sebelum memeriksa History':
    providerStage||rejectedGraph?'Belum ada task ID dari RunningHub':
    'Gagal sebelum pengiriman task';
  $('#taskId').textContent='Belum ada task ID';
  if(restored)$('#taskWorkflow').textContent='RIFE · ≤60 → 60 FPS';
  const el=$('#taskFailureDetail');
  if(el){
    el.textContent='Penyebab: '+msg+(restored?'\nKegagalan terakhir disimpan dari percobaan sebelumnya.':'');
    el.classList.remove('hidden');
  }
}
async function restoreRecentRifeFailure(){
  if(state.workflow!=='rife60'||state.task||state.submission)return;
  try{
    const data=await api('/api/generate/jobs');
    const latestRife=(data.jobs||[]).find(item=>item.workflow==='rife60');
    const recentFailure=latestRife&&['error','uncertain'].includes(latestRife.stage)&&
      Number.isFinite(Date.parse(latestRife.updatedAt))&&
      Date.now()-Date.parse(latestRife.updatedAt)<12*60*60*1000;
    // Pre-deploy FPS errors are obsolete after the repaired FPS preflight.
    const oldFpsRejection=/FPS video harus mulai dari 1 dan lebih rendah dari 60 FPS|Video terdeteksi [\\d.]+ FPS\\. RIFE ini hanya menerima FPS sumber di bawah 60/i.test(String(latestRife?.error||''));
    const obsoleteCadenceRejection=/Pola frame tertahan terlalu tidak teratur/i.test(String(latestRife?.error||''));
    if(state.workflow==='rife60'&&!state.task&&!state.submission&&recentFailure&&!oldFpsRejection&&!obsoleteCadenceRejection)
      displaySubmissionFailure(latestRife,{restored:true});
  }catch(error){console.warn('RIFE failure recovery unavailable',error.message);}
}
function showStartingTask(){
  clearFailureDetail();
  state.startedAt=null;
  clearInterval(state.elapsedTimer);
  $('#taskSection').classList.remove('hidden');
  $('#resultSection').classList.add('hidden');
  $('#taskStatus').textContent='Mengunggah referensi…';
  $('#taskWorkflow').textContent=workflowName();
  $('#taskAccount').textContent=$('#accountSelect').value==='auto'?'Automatic':'Akun dipilih';
  $('#taskMode').textContent=machineLabel(state.mode);
  $('#taskId').textContent='Menunggu task ID';
  const est=estimateSeconds();
  $('#taskEstimate').textContent=est?`Estimasi ± ${fmtTime(est)}`:'Estimasi —';
  $('#taskSection').scrollIntoView({behavior:'smooth',block:'center'});
}

const ACTIVE_UPLOAD_KEY='vantaActiveUploadV1';
function uploadReferences(fd,requestId,progress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/generate',true);
    xhr.setRequestHeader('X-Vanta-Device',getDeviceId());
    xhr.setRequestHeader('X-Vanta-Request-Id',requestId);
    xhr.responseType='json';
    xhr.timeout=7*60*1000; // Transport timeout only; media processing runs separately on the server.
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable)progress(Math.min(100,Math.round(e.loaded/e.total*100)));
    };
    xhr.onload=()=>{
      const data=xhr.response||{};
      if(xhr.status>=200&&xhr.status<300)return resolve(data);
      const err=new Error(data.error||'Upload belum berhasil. Periksa koneksi lalu coba kembali.');
      err.status=xhr.status;reject(err);
    };
    xhr.onerror=()=>reject(new Error('Koneksi terputus ketika mengunggah referensi.'));
    xhr.ontimeout=()=>reject(new Error('Upload belum mendapat respons dari server. Memeriksa apakah file sudah diterima.'));
    xhr.onabort=()=>reject(new Error('Upload terputus sebelum selesai.'));
    xhr.send(fd);
  });
}
function clearSubmission(){
  clearInterval(state.submissionTimer);
  state.submissionTimer=null;
  state.submission=null;
  state.submissionPolling=false;
  localStorage.removeItem(ACTIVE_UPLOAD_KEY);
  clearInterval(state.elapsedTimer);
  updateGenerate();
}
function stageDescription(stage){
  // Internal preprocessing steps must not clutter the user's flow.
  return stage==='submitting'?'Mengirim task…':'Memulai generate…';
}
function showSubmissionStage(data){
  $('#taskSection').classList.remove('hidden');
  $('#taskStatus').textContent=stageDescription(data.stage);
  $('#taskId').textContent='Menunggu task ID';
  $('#taskEstimate').textContent=data.stage==='submitting'?'Menunggu konfirmasi':'Sedang diproses';
  $('#generateBtn').querySelector('span:first-child').textContent='Memproses…';
}
function completedSubmission(data){
  const task=data.task;
  if(!task?.taskId)return;
  // A completed submission is processed once even after a refresh.
  const already=history().some(x=>String(x.taskId)===String(task.taskId));
  state.task=task;
  state.task.currentState=task.taskStatus==='RUNNING'?'running':'queued';
  const iso=task.submittedAt||new Date().toISOString();
  const ms=Date.parse(iso);state.startedAt=Number.isFinite(ms)?ms:Date.now();
  clearSubmission();
  showTask(task);
  if(!already)saveHistory({taskId:task.taskId,accountId:task.accountId,
    workflow:task.workflow.name,outputKind:task.workflow.outputKind||'video',
    mode:task.mode,account:task.accountName,video:state.video?.name||'Video referensi',
    videoSeconds:state.videoDuration,status:task.taskStatus==='RUNNING'?'processing':'queued',
    startedAt:iso,runtimeMs:null,resultUrl:null,referenceMaskUrl:null,error:null});
  if(state.image&&state.video)saveReferenceMedia(String(task.taskId),state.image,state.video).catch(()=>{});
  if(task.trackingRegistered!==false)state.registeredTaskIds.add(String(task.taskId));
  startPolling();
}
async function checkSubmission(){
  const current=state.submission;
  if(!current||state.submissionPolling)return;
  state.submissionPolling=true;
  try{
    const data=await api('/api/generate/jobs/'+encodeURIComponent(current.jobId));
    if(state.submission?.jobId!==current.jobId)return;
    if(data.stage==='accepted'){
      completedSubmission(data);
    }else if(data.stage==='error'){
      displaySubmissionFailure(data);
      toast('Proses gagal. Detail penyebab ditampilkan di Live Task.',true);
      clearSubmission();
    }else if(data.stage==='uncertain'){
      displaySubmissionFailure(data);
      toast('Status RunningHub belum pasti. Jangan kirim ulang sebelum memeriksa History.',true);
      clearSubmission();
    }else{
      showSubmissionStage(data);
    }
  }catch(error){
    if(state.submission?.jobId!==current.jobId)return;
    if(error.status===404){
      current.notFound=(current.notFound||0)+1;
      if(current.notFound>=3){
        $('#taskStatus').textContent='Upload belum tercatat';
        $('#taskEstimate').textContent='Referensi belum diterima server';
        toast('Upload sebelumnya terputus. File belum diterima. Silakan coba kembali.',true);
        clearSubmission();
        return;
      }
    }
    $('#taskStatus').textContent='Menghubungkan kembali…';
    $('#taskEstimate').textContent='Memeriksa status upload tanpa mengirim ulang';
  }finally{state.submissionPolling=false;}
}
function trackSubmission(jobId){
  clearInterval(state.submissionTimer);
  state.submission={jobId};
  localStorage.setItem(ACTIVE_UPLOAD_KEY,jobId);
  showStartingTask();
  startVisibleTimer();
  $('#generateBtn').disabled=true;
  checkSubmission();
  state.submissionTimer=setInterval(checkSubmission,3500);
}
async function resumeSubmission(){
  if(state.task||state.submission)return;
  let id=localStorage.getItem(ACTIVE_UPLOAD_KEY);
  if(!id){
    try{
      const data=await api('/api/generate/jobs');
      const active=(data.jobs||[]).find(x=>!['accepted','error','uncertain'].includes(x.stage));
      id=active?.jobId||null;
    }catch(error){console.warn('Submission restore deferred',error.message);}
  }
  if(id)trackSubmission(id);
}
async function generate(){
  if((state.workflow!=='rife60'&&!state.image)||!state.video||state.submission)return;
  if(!state.accounts.some(a=>a.canGenerate===true)){
    toast('Tidak ada akun RunningHub siap dengan saldo minimal 100 RH. Perbarui Account Pool.',true);
    return;
  }
  const fd=new FormData();
  if(state.workflow!=='rife60')fd.append('referenceImage',state.image);
  fd.append('videoReference',state.video);
  fd.append('workflow',state.workflow);
  fd.append('mode',state.mode);
  fd.append('accountId',$('#accountSelect').value||'auto');
  if(state.workflow==='r4Lab'){
    const maskSource=lastSam3Diagnostic();
    if(!maskSource)return toast('Jalankan tes SAM3 terlebih dahulu.',true);
    fd.append('diagnosticTaskId',maskSource.taskId);
    fd.append('diagnosticAccountId',resolveHistoryAccountId(maskSource));
  }
  // Stop the old single-task Live panel poll before showing a new upload.
  // No provider cancel/delete is sent: the accepted task remains in the
  // encrypted server registry and is monitored in Motion History.
  if(state.task){
    clearInterval(state.pollTimer);
    state.pollTimer=null;
    state.task=null;
  }
  const id=crypto.randomUUID();
  state.submission={jobId:id};
  localStorage.setItem(ACTIVE_UPLOAD_KEY,id);
  $('#generateBtn').disabled=true;
  showStartingTask();
  startVisibleTimer();
  try{
    const data=await uploadReferences(fd,id,percent=>{
      if(!state.submission||state.submission.jobId!==id)return;
      $('#taskStatus').textContent='Mengunggah referensi…';
      $('#taskEstimate').textContent=percent+'% terkirim';
      $('#generateBtn').querySelector('span:first-child').textContent='Mengunggah '+percent+'%';
    });
    if(state.submission?.jobId!==id)return;
    trackSubmission(data.jobId);
  }catch(error){
    if(state.submission?.jobId!==id)return;
    // If acknowledgement was lost, query by the same immutable request ID.
    try{
      const found=await api('/api/generate/jobs/'+encodeURIComponent(id));
      if(found?.jobId){trackSubmission(id);return;}
    }catch{}
    if(error.status>=400&&error.status<500){
      $('#taskStatus').textContent='Upload belum berhasil';
      $('#taskEstimate').textContent='File belum diterima server';
      toast(error.message,true);
      clearSubmission();
    }else{
      // Unknown transport failure: first verify the immutable request ID.
      // Never create another paid request just because an HTTP acknowledgement was lost.
      trackSubmission(id);
      $('#taskStatus').textContent='Menghubungkan kembali…';
      $('#taskEstimate').textContent='Tidak mengirim ulang file atau task';
    }
  }
}

function showTask(data){
  clearInterval(state.elapsedTimer);
  $('#taskSection').classList.remove('hidden');
  $('#resultSection').classList.add('hidden');
  $('#taskStatus').textContent=data.taskStatus==='RUNNING'?'Memproses':'Dalam antrean';
  $('#taskWorkflow').textContent=data.workflow.name;
  $('#taskAccount').textContent=data.accountName;
  $('#taskMode').textContent=machineLabel(data.mode);
  $('#taskId').textContent=`#${data.taskId}`;
  const est=estimateSeconds();
  $('#taskEstimate').textContent=est?`Estimasi ± ${fmtTime(est)}`:'Estimasi —';
  renderLiveTaskDuration();
  toast('Task dikirim ke RunningHub. Kamu bisa generate lagi; prosesnya tetap dipantau di Motion History.');
}
function startPolling(){clearInterval(state.pollTimer);pollTask();state.pollTimer=setInterval(pollTask,6000)}
async function pollTask(){
  const tracked=state.task;
  if(!tracked)return;
  try{
    const data=await api(`/api/tasks/${tracked.taskId}`,{method:'POST',body:JSON.stringify({accountId:tracked.accountId})});
    // An older request may finish after the next generation begins. Never
    // let its delayed result overwrite the new upload/Live Task UI.
    if(state.task!==tracked)return;
    if(data.state==='queued'||data.state==='running'||data.state==='finalizing'||data.state==='waiting_output'){
      const labels={queued:'Antrean RunningHub',running:'Diproses RunningHub',
        finalizing:'Menyiapkan video 40 FPS',waiting_output:'Menunggu hasil RunningHub'};
      $('#taskStatus').textContent=labels[data.state];
      state.task.currentState=data.state;
      $('#taskEstimate').textContent=data.message||'Status diperbarui dari RunningHub';
      renderLiveTaskDuration();
      updateHistory(state.task.taskId,{status:data.state,error:null,statusDetail:data.message||null,
        providerCode:data.rawCode??null});
    }
    if(data.state==='check_error'){
      state.task.currentState='check_error';
      $('#taskStatus').textContent='Menghubungkan kembali…';
      $('#taskEstimate').textContent='Status terbaru belum tersedia';
      updateHistory(state.task.taskId,{status:'check_error',
        error:'Pemantauan dilanjutkan otomatis saat RunningHub merespons.',runtimeMs:null});
    }
    if(data.state==='failed') finishFailed(data.message||'Task gagal.',data.failure||null);
    if(data.state==='success'){
      const results=selectTaskOutputs(data.outputs, state.task.workflow.outputKind);
      if(!results.videoUrl) return finishFailed('RunningHub tidak mengembalikan video mask/generasi.');
      results.cameraQA=data.cameraQA||null;
      results.deliveryNote=data.deliveryNote||null;
      finishSuccess(results);
    }
  }catch(e){
    if(state.task!==tracked)return;
    console.warn('poll',e.message);
    $('#taskStatus').textContent='Menghubungkan kembali…';
    $('#taskEstimate').textContent='Memeriksa status secara otomatis';
    updateHistory(state.task.taskId,{status:'check_error',
      error:'Status terbaru belum tersedia. Pemeriksaan akan diulang.',runtimeMs:null});
  }
}
function selectTaskOutputs(outputs,kind){
  const items=Array.isArray(outputs)?outputs:[];
  const video=(kind==='diagnostic'?items.find(o=>String(o.nodeId)==='393'):null)
    ||items.find(o=>String(o.fileType||'').toLowerCase().includes('video')||/\.mp4(?:\?|$)/i.test(String(o.fileUrl||'')));
  const referenceMask=kind==='diagnostic'
    ?(items.find(o=>String(o.nodeId)==='394')||items.find(o=>String(o.fileType||'').toLowerCase().includes('image')))
    :null;
  return {videoUrl:video?.fileUrl||null,referenceMaskUrl:referenceMask?.fileUrl||null};
}
function finishFailed(msg,failure=null){
  clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
  const elapsed=Date.now()-state.startedAt;
  $('#taskEstimate').textContent='Task gagal';
  toast(msg,true);
  updateHistory(state.task.taskId,{status:'failed',finishedAt:new Date().toISOString(),runtimeMs:elapsed,error:msg,...(failure?{diagnosis:formatTaskDiagnosis(failure,msg),diagnosisChecked:true}:{})});
  state.task=null;$('#taskStatus').textContent='Failed';updateGenerate();
}
function finishSuccess(result){
  clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
  const elapsed=Date.now()-state.startedAt;
  $('#taskEstimate').textContent='Selesai';
  $('#taskStatus').textContent='Selesai';
  $('#resultSection').classList.remove('hidden');
  $('#resultVideo').src=result.videoUrl;
  // Final 40 FPS files are served through separate inline-preview and attachment endpoints.
  const finalDownload=(typeof result.videoUrl==='string'&&
    /^\/api\/tasks\/\d+\/preview\?accountId=/.test(result.videoUrl))
      ?result.videoUrl.replace('/preview?','/download?'):result.videoUrl;
  $('#downloadBtn').href=finalDownload;
  const diagnostic=state.task.workflow.outputKind==='diagnostic';
  $('#resultHeading').textContent=diagnostic?'Tes SAM3 selesai — hasil mask':'Generation completed';
  $('#resultMediaLabel').textContent=diagnostic?'Mask gerakan SAM3 (BUKAN hasil motion transfer)':'Video hasil generasi';
  // The Camera QA classification is an internal, advisory diagnostic.
  // A successful RunningHub video does not imply camera validation has passed.
  $('#resultCacheState').textContent=diagnostic?'Hasil diagnostik siap diperiksa':'Hasil siap diputar';
  $('#downloadBtn').textContent=diagnostic?'Download video mask':'Download video';
  $('#referenceMaskWrap').classList.toggle('hidden',!diagnostic||!result.referenceMaskUrl);
  if(result.referenceMaskUrl){$('#referenceMaskPreview').src=result.referenceMaskUrl;$('#referenceMaskDownload').href=result.referenceMaskUrl;}
  $('#resultWorkflow').textContent=state.task.workflow.name;
  updateHistory(state.task.taskId,{status:'success',finishedAt:new Date().toISOString(),runtimeMs:elapsed,resultUrl:result.videoUrl,referenceMaskUrl:result.referenceMaskUrl,cameraQA:result.cameraQA||null,deliveryNote:result.deliveryNote||null});
  state.task=null;updateGenerate();
  $('#resultSection').scrollIntoView({behavior:'smooth',block:'start'});
  toast(result.deliveryNote|| (diagnostic?'Tes SAM3 selesai.':'Video berhasil dibuat.'));
}

const HISTORY_RETENTION_MS=3*24*60*60*1000;
const MEDIA_DB_NAME='vanta-history-references-v1';
function openReferenceDB(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(new Error('Penyimpanan browser tidak didukung.'));
    const req=indexedDB.open(MEDIA_DB_NAME,1);
    req.onupgradeneeded=()=>{
      const store=req.result.createObjectStore('media',{keyPath:'taskId'});
      store.createIndex('createdAt','createdAt');
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Tidak dapat membuka penyimpanan referensi.'));
  });
}
async function saveReferenceMedia(taskId,image,video){
  if(!taskId||!image||!video)return;
  const db=await openReferenceDB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('media','readwrite');
      tx.objectStore('media').put({taskId:String(taskId),image,video,createdAt:Date.now()});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Gagal menyimpan referensi.'));
      tx.onabort=()=>reject(tx.error||new Error('Penyimpanan penuh.'));
    });
  }finally{db.close();}
}
async function loadReferenceMedia(taskId){
  const db=await openReferenceDB();
  try{return await new Promise((resolve,reject)=>{
    const req=db.transaction('media','readonly').objectStore('media').get(String(taskId));
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}
async function cleanupReferenceMedia(){
  const db=await openReferenceDB();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('media','readwrite');
    const index=tx.objectStore('media').index('createdAt');
    const cursor=index.openCursor(IDBKeyRange.upperBound(Date.now()-HISTORY_RETENTION_MS));
    cursor.onsuccess=()=>{if(cursor.result){cursor.result.delete();cursor.result.continue();}};
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
let previewVersion=0;
let previewUrls=[];
function releasePreviewMedia(){
  for(const media of ['historyPreviewVideo','historyPreviewSourceVideo']){
    const el=$('#'+media);
    if(el){el.pause();el.removeAttribute('src');el.load();}
  }
  $('#historyPreviewImage')?.removeAttribute('src');
  previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];
}

function history(){
  try{
    const raw=JSON.parse(localStorage.getItem('vantaHistoryV2')||'[]');
    const items=Array.isArray(raw)?raw:[];
    const now=Date.now();
    const kept=items.filter(item=>{
      const status=String(item?.status||'').toLowerCase();
      if(status!=='success'&&status!=='failed')return true;
      const terminalAt=Date.parse(item.finishedAt||item.startedAt||'');
      return !Number.isFinite(terminalAt)||(now-terminalAt)<=HISTORY_RETENTION_MS;
    });
    if(kept.length!==items.length)localStorage.setItem('vantaHistoryV2',JSON.stringify(kept.slice(0,100)));
    return kept;
  }catch{return[]}
}
function setHistory(items){localStorage.setItem('vantaHistoryV2',JSON.stringify(items.slice(0,100)))}
function saveHistory(item){setHistory([item,...history().filter(x=>x.taskId!==item.taskId)])}
function updateHistory(taskId,patch){
  setHistory(history().map(x=>x.taskId===taskId?{...x,...patch}:x));
  if(state.view==='history')renderHistory();
}
function isActiveHistoryStatus(status){return ['uploading','queued','running','processing','waiting_output','finalizing','check_error','unavailable'].includes(String(status||'').toLowerCase())}
function historyElapsed(item){
  if(item.runtimeMs!=null&&Number.isFinite(Number(item.runtimeMs)))
    return Math.max(0,Number(item.runtimeMs));
  const start=Date.parse(item.startedAt||'');
  if(!Number.isFinite(start))return null;
  const status=String(item.status||'').toLowerCase();
  if(['success','failed'].includes(status)){
    const finished=Date.parse(item.finishedAt||'');
    return Number.isFinite(finished)?Math.max(0,finished-start):null;
  }
  if(['running','processing','waiting_output','finalizing','check_error','unavailable'].includes(status))
    return Math.max(0,Date.now()-start);
  return null;
}
function historyStatusLabel(status){
  const s=String(status||'').toLowerCase();
  if(s==='queued')return 'Antrean RunningHub';
  if(s==='running'||s==='processing')return 'Diproses RunningHub';
  if(s==='waiting_output')return 'Menunggu hasil RunningHub';
  if(s==='finalizing')return 'Menyiapkan video 40 FPS';
  if(s==='success')return 'Berhasil';
  if(s==='failed')return 'Gagal';
  if(s==='unavailable'||s==='check_error')return 'Status belum tersedia';
  return status||'—';
}
function historyStatusClass(status){
  const s=String(status||'').toLowerCase();
  if(s==='success')return 'success';
  if(s==='failed')return 'failed';
  if(s==='queued')return 'queued';
  if(['running','processing','finalizing','waiting_output'].includes(s))return 'processing';
  if(s==='unavailable'||s==='check_error')return 'processing';
  return 'neutral';
}
function resolveHistoryAccountId(item){
  if(item.accountId)return item.accountId;
  return state.accounts.find(a=>a.name===item.account)?.id||null;
}
function formatTaskDiagnosis(failure,fallback='APIKEY_TASK_STATUS_ERROR'){
  if(!failure)return 'RunningHub tidak menyertakan detail failedReason pada respons task ini.';
  const position=[failure.nodeName,failure.nodeId?`ID ${failure.nodeId}`:''].filter(Boolean).join(' · ');
  const kind=failure.exceptionType||'Error';
  return [position,kind,failure.message].filter(Boolean).join(' | ')||fallback;
}
async function diagnoseFailedTask(item){
  const accountId=resolveHistoryAccountId(item);
  if(!accountId)throw new Error('Akun task tidak lagi ada di Account Pool.');
  const result=await api(`/api/tasks/${encodeURIComponent(item.taskId)}`,{method:'POST',body:JSON.stringify({accountId})});
  if(result.state!=='failed')throw new Error(`Status task sekarang: ${result.state||'tidak diketahui'}`);
  const diagnosis=formatTaskDiagnosis(result.failure,result.message);
  updateHistory(item.taskId,{accountId,diagnosis,diagnosisChecked:true});
  return diagnosis;
}
async function inspectRecentFailedTasks(){
  const candidates=history().filter(item=>item.status==='failed'&&item.taskId&&!item.diagnosisChecked).slice(0,3);
  for(const item of candidates){
    try{await diagnoseFailedTask(item);}
    catch(error){console.warn('task diagnosis',String(item.taskId),error.message);}
  }
}
function historyFilterMatches(item){
  const status=String(item?.status||'').toLowerCase();
  if(state.historyFilter==='success')return status==='success';
  if(state.historyFilter==='failed')return status==='failed';
  if(state.historyFilter==='process')return ['uploading','queued','running','processing','waiting_output','finalizing','unavailable','check_error'].includes(status);
  return true;
}
function syncHistoryFilterUI(){
  $$('.history-filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.historyFilter===state.historyFilter));
}
function renderHistory(){
  syncHistoryFilterUI();
  const allItems=history();
  const items=allItems.filter(historyFilterMatches);
  const root=$('#historyBody');
  // The table is a legacy fallback. Do not construct rows for every task
  // on each one-second refresh when the Nora gallery is available.
  if(window.vantaGallery){
    window.vantaGallery.renderMotion(items);
    if(state.workflow==='r4Lab')refreshLabNotice();
    return;
  }
  if(!items.length){
    window.vantaGallery?.renderMotion([]);
    const message=allItems.length?'Tidak ada generation pada filter ini.':'Belum ada riwayat generation.';
    root.innerHTML=`<tr class="history-empty-row"><td colspan="7">${message}</td></tr>`;
    return;
  }
  root.innerHTML=items.map(x=>{
    const statusClass=historyStatusClass(x.status);
    const statusLabel=historyStatusLabel(x.status);
    const elapsed=historyElapsed(x);
    const duration=elapsed===null?'':`<small class="history-duration" title="Dihitung sejak task diterima RunningHub">${['success','failed'].includes(String(x.status||'').toLowerCase())?'Total waktu':'Sejak dikirim'} · ${fmtElapsed(elapsed)}</small>`;
    const error=x.error?`<small class="history-error" title="${escapeHtml(x.error)}">${escapeHtml(x.error)}</small>`:'';
    const diagnosis=x.diagnosis?`<small class="history-diagnosis">${escapeHtml(x.diagnosis)}</small>`:'';
    // Keep cameraQA on the task for audit, but never show raw internal classifications in History.
    const cameraInfo='';
    const statusDetail=x.statusDetail&&isActiveHistoryStatus(x.status)?
      `<small class="history-diagnosis">${escapeHtml(x.statusDetail)}</small>`:'';
    const deliveryNote=x.deliveryNote?
      `<small class="history-diagnosis">${escapeHtml(x.deliveryNote)}</small>`:'';
    const inspect=x.status==='failed'&&x.taskId?`<button type="button" class="history-diagnose-btn" data-diagnose-task="${escapeHtml(x.taskId)}">Periksa penyebab</button>`:x.status==='unavailable'&&x.taskId?`<button type="button" class="history-diagnose-btn" data-recover-task="${escapeHtml(x.taskId)}">Periksa lagi</button>`:'';

    const safeUrl=x.resultUrl?escapeHtml(x.resultUrl):'';
    const resolvedAccountId=resolveHistoryAccountId(x);
    const accountStillAvailable=state.accounts.some(a=>a.id===resolvedAccountId)||state.registeredTaskIds.has(String(x.taskId));
    const rawDownloadUrl=(accountStillAvailable&&x.taskId)
      ? `/api/tasks/${encodeURIComponent(x.taskId)}/download?accountId=${encodeURIComponent(resolvedAccountId)}&deviceId=${encodeURIComponent(getDeviceId())}`
      : (x.resultUrl||'');
    const rawPreviewUrl=(accountStillAvailable&&x.taskId)
      ? `/api/tasks/${encodeURIComponent(x.taskId)}/preview?accountId=${encodeURIComponent(resolvedAccountId)}&deviceId=${encodeURIComponent(getDeviceId())}`
      : (x.resultUrl||'');
    const safeDownloadUrl=escapeHtml(rawDownloadUrl);
    const safePreviewUrl=escapeHtml(rawPreviewUrl);
    const extraMask=x.referenceMaskUrl?`<a class="history-action-btn download" href="${escapeHtml(x.referenceMaskUrl)}" target="_blank" rel="noopener noreferrer">Mask referensi</a>`:'';
    const result=x.resultUrl
      ? `<div class="history-actions"><button type="button" class="history-action-btn preview" data-preview-url="${safePreviewUrl}" data-download-url="${safeDownloadUrl}" data-preview-task="${escapeHtml(x.taskId||'')}">Lihat detail</button><a class="history-action-btn download" href="${safeDownloadUrl}">Download</a>${extraMask}</div>`
      : (isActiveHistoryStatus(x.status)?'<span class="history-pending"><span class="history-live-dot"></span>Menunggu hasil</span>':'—');
    return `<tr data-task-id="${escapeHtml(x.taskId||'')}">
      <td data-label="Time">${new Date(x.startedAt).toLocaleString('id-ID')}</td>
      <td data-label="Workflow">${escapeHtml(x.workflow)}</td>
      <td data-label="Mode">${escapeHtml(machineLabel(x.mode))}</td>
      <td data-label="Account">${escapeHtml(x.account)}</td>
      <td data-label="Video" class="history-video-name">${escapeHtml(x.video)}</td>
      <td data-label="Status"><span class="history-status ${statusClass}"><span></span>${escapeHtml(statusLabel)}</span>${duration}${error}${diagnosis}${statusDetail}${deliveryNote}${cameraInfo}${inspect}</td>
      <td data-label="Result">${result}</td>
    </tr>`;
  }).join('');
  window.vantaGallery?.renderMotion(items);
  if(state.workflow==='r4Lab')refreshLabNotice();
}
async function pollHistoryTasks(){
  if(state.historyPollBusy)return;
  state.historyPollBusy=true;
  try{
    // Server registry independently monitors registered jobs. Avoid hammering removed/legacy accounts.
    const legacy=history().filter(item=>isActiveHistoryStatus(item.status)&&String(item.status).toLowerCase()!=='unavailable'&&item.taskId&&!state.registeredTaskIds.has(String(item.taskId)));
    const active=legacy.slice(0,2);
    for(const item of active){
      if(state.task&&String(state.task.taskId)===String(item.taskId))continue;
      const accountId=resolveHistoryAccountId(item);
      if(!accountId){updateHistory(item.taskId,{status:'unavailable',error:'Akun pemilik task belum ditemukan. Gunakan Pulihkan akun task di detail History.',runtimeMs:null});continue;}
      try{
        const data=await api(`/api/tasks/${item.taskId}`,{method:'POST',body:JSON.stringify({accountId})});
        if(['queued','running','finalizing','waiting_output'].includes(data.state)){
          updateHistory(item.taskId,{accountId,status:data.state,error:null,
            statusDetail:data.message||null,providerCode:data.rawCode??null});
        }else if(data.state==='check_error'){
          updateHistory(item.taskId,{accountId,status:'check_error',
            error:'Memeriksa kembali status RunningHub secara otomatis.',runtimeMs:null});
        }else if(data.state==='failed'){
          updateHistory(item.taskId,{accountId,status:'failed',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),error:data.message||'Task gagal.',...(data.failure?{diagnosis:formatTaskDiagnosis(data.failure,data.message),diagnosisChecked:true}:{})});
        }else if(data.state==='success'){
          const outputs=selectTaskOutputs(data.outputs,item.outputKind);
          if(!outputs.videoUrl)throw new Error('Output video tidak tersedia pada respons RunningHub.');
          updateHistory(item.taskId,{accountId,status:'success',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),resultUrl:outputs.videoUrl,referenceMaskUrl:outputs.referenceMaskUrl,cameraQA:data.cameraQA||null,
            deliveryNote:data.deliveryNote||null,statusDetail:null,error:null});
        }
      }catch(e){
        console.warn('history poll',item.taskId,e.message);
        if(e.status===409){
          updateHistory(item.taskId,{status:'unavailable',
            error:'Akun pemilik task belum ditemukan. Gunakan Pulihkan akun task di detail History.',runtimeMs:null});
        }else{
          updateHistory(item.taskId,{status:'check_error',
            error:'Koneksi sementara terputus. Pemantauan akan diulang.',runtimeMs:null});
        }
      }
    }
  }finally{
    state.historyPollBusy=false;
  }
}
function referenceLink(taskId,kind,accountId){
  return '/api/task-references/'+encodeURIComponent(taskId)+'/'+kind+
    '?accountId='+encodeURIComponent(accountId)+'&deviceId='+encodeURIComponent(getDeviceId());
}
async function renderReferenceDetails(taskId,version){
  const item=history().find(x=>String(x.taskId)===String(taskId));
  const accountId=item?resolveHistoryAccountId(item):null;
  const stored=await loadReferenceMedia(taskId).catch(()=>null);
  let onServer={image:false,video:false};
  if(accountId){
    try{onServer=await api('/api/task-references/'+encodeURIComponent(taskId)+
       '?accountId='+encodeURIComponent(accountId));}catch{}
  }
  if(version!==previewVersion)return;
  const entries=[
    {kind:'image',id:'historyPreviewImage',empty:'historyPreviewImageEmpty',blob:stored?.image},
    {kind:'video',id:'historyPreviewSourceVideo',empty:'historyPreviewSourceEmpty',blob:stored?.video}
  ];
  let available=0;
  for(const entry of entries){
    const element=$('#'+entry.id),empty=$('#'+entry.empty);
    element.hidden=true;empty.hidden=false;
    element.removeAttribute('src');
    if(entry.kind==='video'){element.pause();element.load();}
    const foundServer=!!onServer[entry.kind]&&!!accountId;
    if(foundServer){
      available++;
      element.src=referenceLink(taskId,entry.kind,accountId);
      element.hidden=false;empty.hidden=true;
      if(entry.kind==='video')element.load();
      element.onerror=()=>{if(version===previewVersion){element.hidden=true;empty.hidden=false;
        empty.textContent='Referensi tidak dapat diputar dari penyimpanan.';}};
    }else if(entry.blob){
      available++;
      const objectUrl=URL.createObjectURL(entry.blob);
      previewUrls.push(objectUrl);element.src=objectUrl;element.hidden=false;empty.hidden=true;
      if(entry.kind==='video')element.load();
    }else{
      empty.textContent='Referensi tidak tersedia pada riwayat lama ini.';
    }
  }
  $('#historyPreviewReferences').hidden=available===0;
  $('#historyPreviewLegacyNotice').hidden=available!==0;
  $('#historyPreviewLayout').classList.toggle('refs-unavailable',available===0);
}
async function openHistoryPreview(url,taskId='',downloadUrl=''){
  const modal=$('#historyPreviewModal'),result=$('#historyPreviewVideo');
  if(!modal||!result)return;
  const version=++previewVersion;
  releasePreviewMedia();
  $('#historyPreviewTitle').textContent=taskId?'Task #'+taskId:'Detail generasi';
  $('#historyPreviewDownload').href=downloadUrl||url;
  $('#historyPreviewDownload').removeAttribute('download');
  for(const empty of ['historyPreviewImageEmpty','historyPreviewSourceEmpty']){
    $('#'+empty).textContent='Memeriksa referensi…';
    $('#'+empty).hidden=false;
  }
  $('#historyPreviewImage').hidden=true;
  $('#historyPreviewSourceVideo').hidden=true;
  $('#historyPreviewReferences').hidden=false;
  $('#historyPreviewLegacyNotice').hidden=true;
  $('#historyPreviewLayout').classList.remove('refs-unavailable');
  modal.classList.remove('hidden');document.body.classList.add('modal-open');
  result.preload='metadata';result.src=url;result.load();
  result.onerror=()=>{if(version===previewVersion)toast('Video hasil tidak dapat dimuat.',true);};
  result.oncanplay=()=>{if(version===previewVersion)result.play().catch(()=>{});};
  if(taskId)await renderReferenceDetails(taskId,version);
}
function closeHistoryPreview(){
  ++previewVersion;
  releasePreviewMedia();
  $('#historyPreviewModal')?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}
function bindHistoryActions(){
  const body=$('#historyBody');
  if(body){
    body.addEventListener('click',async e=>{
      const recovery=e.target.closest('[data-recover-task]');
      if(recovery){
        e.preventDefault();recovery.disabled=true;recovery.textContent='Memeriksa…';
        try{
          const taskId=recovery.dataset.recoverTask;
          const found=await api(`/api/tasks/${encodeURIComponent(taskId)}/recover`,{method:'POST',body:'{}'});
          updateHistory(taskId,{accountId:found.accountId,account:found.accountName,status:'check_error',error:null});
          await pollHistoryTasks();
          toast('Akun task ditemukan. Status sedang diperiksa.');
        }catch(error){
          updateHistory(recovery.dataset.recoverTask,{status:'unavailable',error:error.message,runtimeMs:null});
          toast(error.message,true);
        }finally{if(recovery.isConnected){recovery.disabled=false;recovery.textContent='Periksa lagi';}}
        return;
      }
      const diagnostic=e.target.closest('[data-diagnose-task]');
      if(diagnostic){
        e.preventDefault();
        const item=history().find(x=>String(x.taskId)===String(diagnostic.dataset.diagnoseTask));
        if(!item)return;
        diagnostic.disabled=true;diagnostic.textContent='Memeriksa…';
        try{await diagnoseFailedTask(item);}
        catch(error){toast('Tidak dapat mengambil detail task: '+error.message,true);}
        finally{if(diagnostic.isConnected){diagnostic.disabled=false;diagnostic.textContent='Periksa penyebab';}}
        return;
      }
      const btn=e.target.closest('[data-preview-url]');
      if(!btn)return;
      e.preventDefault();
      openHistoryPreview(btn.dataset.previewUrl,btn.dataset.previewTask||'',btn.dataset.downloadUrl||'');
    });
  }
  $('#historyPreviewClose')?.addEventListener('click',closeHistoryPreview);
  $('#historyPreviewCloseBottom')?.addEventListener('click',closeHistoryPreview);
  $$('[data-close-preview]').forEach(el=>el.addEventListener('click',closeHistoryPreview));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHistoryPreview();});
}

window.vantaMotionGallery={
  redraw(){renderHistory();},
  videoUrl(item){
    const id=String(item.taskId||'');
    if(!/^\d{10,25}$/.test(id)||!item.resultUrl)return null;
    const accountId=resolveHistoryAccountId(item);
    if(!accountId)return item.resultUrl;
    return '/api/tasks/'+encodeURIComponent(id)+'/preview?accountId='+
      encodeURIComponent(accountId)+'&deviceId='+encodeURIComponent(getDeviceId());
  },
  referenceUrl(item){
    const accountId=resolveHistoryAccountId(item);
    if(!accountId||!item.taskId)return null;
    return referenceLink(item.taskId,'image',accountId);
  },
  elapsed:historyElapsed,
  formatDuration:fmtElapsed,
  showReferences(item){
    const accountId=resolveHistoryAccountId(item);
    const preview=window.vantaMotionGallery.videoUrl(item);
    const download=accountId?'/api/tasks/'+encodeURIComponent(item.taskId)+'/download?accountId='+
      encodeURIComponent(accountId)+'&deviceId='+encodeURIComponent(getDeviceId()):item.resultUrl;
    if(preview)openHistoryPreview(preview,item.taskId,download);
  },
  async refresh(){
    await syncServerHistory();
    await pollHistoryTasks();
    renderHistory();
  },
  async recover(item){
    const id=String(item.taskId||'');
    if(!/^\d{10,25}$/.test(id))throw Error('Task ID tidak valid.');
    // Recovery only checks existing RunningHub outputs; never creates a paid task.
    const found=await api('/api/tasks/'+encodeURIComponent(id)+'/recover',{method:'POST',body:'{}'});
    state.registeredTaskIds.add(id);
    updateHistory(id,{accountId:found.accountId,account:found.accountName,
      status:'check_error',error:null,statusDetail:'Akun berhasil dipulihkan; status akan diperiksa.',runtimeMs:null});
    await syncServerHistory();
    renderHistory();
    toast('Akun task berhasil dipulihkan. Pemantauan History dilanjutkan.');
  },
  async diagnose(item){
    await diagnoseFailedTask(item);
    renderHistory();
  },
  retry(){
    switchView('create');
    toast('Pilih kembali gambar dan video referensi, lalu kirim task baru bila sudah siap.');
  },
  async remove(item){
    const id=String(item.taskId||''),accountId=resolveHistoryAccountId(item);
    if(!['success','failed'].includes(String(item.status||'')))throw Error('Task masih aktif.');
    try{
      await api('/api/tasks/'+encodeURIComponent(id)+'/history',{
        method:'DELETE',body:JSON.stringify({accountId})});
    }catch(error){
      if(error.status!==404)throw error;
      // Legacy task not in server vault: remove browser-only history.
    }
    setHistory(history().filter(x=>String(x.taskId)!==id));
    state.registeredTaskIds.delete(id);
    renderHistory();
    toast('Hasil dihapus dari Motion History.');
  }
};
function startHistoryMonitor(){
  clearInterval(state.historyPollTimer);
  clearInterval(state.historyClockTimer);
  state.historyPollTimer=setInterval(pollHistoryTasks,8000);
  state.historyClockTimer=setInterval(()=>{
    if(state.view==='history'){
      renderHistory();
      window.vantaGallery?.refreshDurations();
    }
    renderLiveTaskDuration();
  },1000);
  setInterval(syncServerHistory,30000);
  pollHistoryTasks();
  inspectRecentFailedTasks();
}

function initDropzone(label,input,kind){label.addEventListener('dragover',e=>{e.preventDefault();label.classList.add('dragover')});label.addEventListener('dragleave',()=>label.classList.remove('dragover'));label.addEventListener('drop',e=>{e.preventDefault();label.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(f)setMedia(kind,f)});input.onchange=()=>{const f=input.files?.[0];if(f)setMedia(kind,f)};}

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
$$('.workflow-card').forEach(b=>b.onclick=()=>{
  $$('.workflow-card').forEach(x=>x.classList.remove('selected'));
  b.classList.add('selected'); state.workflow=b.dataset.workflow;
  const videoOnly=state.workflow==='rife60';
  $('#imageDrop').classList.toggle('hidden',videoOnly);
  // One-video mode fills the media panel rather than leaving a blank image column.
  $('#videoDrop').style.gridColumn=videoOnly?'1 / -1':'';
  $('#mediaRequirements').textContent=videoOnly?'Cukup satu video dengan FPS ≤60 · gambar tidak diperlukan':'Kedua file wajib diisi';
  $('#videoDrop').querySelector('strong').textContent=videoOnly?'Source Video (≤60 FPS)':'Video Reference';
  $('#rifeNotice').classList.toggle('hidden',!videoOnly);
  $('#diagnosticNotice').classList.toggle('hidden',state.workflow!=='koh1AntiObject');
  $('#fullLabNotice').classList.toggle('hidden',state.workflow!=='r4Lab');
  updateEstimates();updateGenerate();
  if(state.workflow==='rife60')restoreRecentRifeFailure();
});
$$('.mode-card').forEach(b=>b.onclick=()=>{
  $$('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.mode=b.dataset.mode;
});
initDropzone($('#imageDrop'),$('#referenceImage'),'image');initDropzone($('#videoDrop'),$('#videoReference'),'video');
$('#generateBtn').onclick=generate;$('#refreshAccounts').onclick=refreshAccounts;
$('#motionGalleryRefresh')?.addEventListener('click',()=>window.vantaMotionGallery.refresh()
  .catch(error=>toast('Status Motion History belum tersedia: '+error.message,true)));
const historyFilters=$('#historyFilters');
if(historyFilters) historyFilters.onclick=e=>{
  const btn=e.target.closest('[data-history-filter]');
  if(!btn)return;
  state.historyFilter=btn.dataset.historyFilter||'all';
  window.vantaGallery?.reset('motion');
  renderHistory();
};
$('#addAccountBtn').onclick=async()=>{const input=$('#apiKeyInput'),key=input.value.trim();if(!key)return toast('Masukkan API key.',true);const btn=$('#addAccountBtn');btn.disabled=true;btn.textContent='Validating…';try{await api('/api/accounts',{method:'POST',body:JSON.stringify({apiKey:key})});input.value='';toast('API key valid dan ditambahkan.');await loadSession();}catch(e){toast(e.message,true)}finally{btn.disabled=false;btn.textContent='Add to pool'}};

bindHistoryActions();
resumeSubmission().catch(error=>console.warn('Upload resume pending',error.message));
loadSession().then(()=>{startHistoryMonitor();cleanupReferenceMedia().catch(()=>{});})
  .catch(e=>toast(e.message,true));updateEstimates();updateGenerate();renderHistory();
