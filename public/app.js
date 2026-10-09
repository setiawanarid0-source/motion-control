const state = {
  view: 'create', workflow: 'r15', mode: 'lite', session: null, accounts: [],
  image: null, video: null, videoDuration: 0, task: null, pollTimer: null, elapsedTimer: null, startedAt: null,
  historyPollTimer: null, historyClockTimer: null, historyPollBusy: false, historyFilter: 'all',
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
function fmtElapsed(ms){ const sec=Math.floor(ms/1000),m=Math.floor(sec/60),s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function fileSize(n){ if(!n)return '0 B'; const u=['B','KB','MB','GB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(i?1:0)} ${u[i]}`; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function switchView(view){ state.view=view; $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`)); $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); $('#pageTitle').textContent=view==='create'?'Motion Control':view==='history'?'History':'Account Pool'; $('#sidebar').classList.remove('open'); if(view==='history')renderHistory(); if(view==='accounts')refreshAccounts(); }

async function api(url, options={}){ const r=await fetch(url,{...options,headers:{'X-Vanta-Device':getDeviceId(),...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}}); let data={}; try{data=await r.json()}catch{} if(!r.ok){const error=new Error(data.error||`HTTP ${r.status}`);error.status=r.status;throw error;}return data; }

async function loadSession(){
  state.session=await api('/api/session'); state.accounts=state.session.accounts||[]; renderAccountSelect(); updateGenerate(); await refreshAccounts();
}
function renderAccountSelect(){ const sel=$('#accountSelect'); const current=sel.value||'auto'; sel.innerHTML='<option value="auto">Automatic</option>'+state.accounts.map(a=>`<option value="${a.id}" ${a.canGenerate===false?'disabled':''}>${escapeHtml(a.name)}${a.canGenerate===false?' (pemantauan saja)':''}</option>`).join(''); sel.value=[...sel.options].some(o=>o.value===current&&!o.disabled)?current:'auto'; }

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
    const data=await api('/api/accounts/refresh',{method:'POST',body:'{}'});
    state.accounts=data.accounts||[];
    renderAccounts();
    updatePoolSummary();
    renderAccountSelect();
    // Low-credit accounts remain stored for existing task monitoring; no auto-deletion.
  }catch(e){
    toast(e.message,true);
  }finally{
    if(refreshBtn){ refreshBtn.disabled=false; refreshBtn.classList.remove('refreshing'); }
  }
}
function updatePoolSummary(){ const healthy=state.accounts.filter(a=>a.canGenerate===true); $('#poolCount').textContent=`${healthy.length} akun siap`; $('#poolCredits').textContent=String(healthy.length); const unit=$('#poolReadyUnit'); if(unit)unit.textContent='akun siap'; $('#poolDot').classList.toggle('ready',healthy.length>0); updateGenerate(); }
function renderAccounts(){
  const root=$('#accountList'); if(!state.accounts.length){root.innerHTML='<div class="empty-state">Belum ada API key di pool.<br>Tambahkan akun pertama dari panel di sebelah kiri.</div>';return;}
  root.innerHTML=state.accounts.map(a=>{const s=a.status||{};const ok=!s.error&&a.status,ready=a.canGenerate===true;return `<div class="account-card"><div><div class="account-card-main"><div class="account-icon">◎</div><div><strong>${escapeHtml(a.name)}</strong><small>${ready?'Ready':ok?'Pemantauan saja — kredit rendah':'Status belum dibaca'}</small></div></div><div class="account-metrics"><span>RH ${ok?Number(s.remainCoins||0).toLocaleString('id-ID'):'—'}</span><span>Tasks ${ok?Number(s.currentTaskCounts||0):'—'}</span>${s.error?`<span>${escapeHtml(s.error)}</span>`:''}</div></div><button class="delete-account" data-delete="${a.id}" type="button" aria-label="Remove ${escapeHtml(a.name)}" title="Remove account"><span class="delete-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg></span><span class="delete-account-label">Remove</span></button></div>`}).join('');
  $$('[data-delete]').forEach(btn=>btn.onclick=async()=>{try{await api(`/api/accounts/${btn.dataset.delete}`,{method:'DELETE'});toast('Akun dihapus.');await loadSession();}catch(e){toast(e.message,true)}});
}

function setMedia(kind,file){
  if(kind==='image'){state.image=file;const p=$('#imagePreview'); if(!file){p.innerHTML='';p.classList.remove('active');updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<img src="${url}" alt="Reference preview"><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small>${fileSize(file.size)}</small></div><button class="remove-media" data-remove="image">×</button></div>`;p.classList.add('active');}
  else{state.video=file;const p=$('#videoPreview'); if(!file){p.innerHTML='';p.classList.remove('active');state.videoDuration=0;updateEstimates();updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<video src="${url}" muted playsinline preload="metadata"></video><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small id="videoFileMeta">${fileSize(file.size)}</small></div><button class="remove-media" data-remove="video">×</button></div>`;p.classList.add('active');const v=p.querySelector('video');v.onloadedmetadata=()=>{state.videoDuration=v.duration||0;$('#videoFileMeta').textContent=`${fileSize(file.size)} · ${fmtTime(v.duration)}`;updateEstimates();};}
  $$('[data-remove]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();setMedia(btn.dataset.remove,null)});updateGenerate();
}
function lastSam3Diagnostic(){return history().filter(x=>x.outputKind==='diagnostic'&&x.status==='success'&&x.taskId&&resolveHistoryAccountId(x)).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0]||null;}
function refreshLabNotice(){const item=lastSam3Diagnostic(),el=$('#r4LabMaskSource');if(el)el.textContent=item?`Mask dari task SAM3 #${item.taskId} (${new Date(item.startedAt).toLocaleString('id-ID')}). Gunakan gambar dan video kompensasi yang sama.`:'Belum ada hasil SAM3 berhasil di History browser ini. Jalankan tes SAM3 terlebih dahulu.';}
function updateEstimates(){ if(['koh1AntiObject','r4Lab'].includes(state.workflow)){ ['liteCredits','liteTime','standardCredits','standardTime'].forEach(id=>$('#'+id).textContent='—');return;} const d=state.videoDuration;if(!d){$('#liteCredits').textContent=$('#liteTime').textContent=$('#standardCredits').textContent=$('#standardTime').textContent='—';return} const liteRuntime=d*38.6,stdRuntime=d*21.2;$('#liteTime').textContent=`± ${fmtTime(liteRuntime)}`;$('#standardTime').textContent=`± ${fmtTime(stdRuntime)}`;$('#liteCredits').textContent=`~ ${(liteRuntime*.02).toFixed(1)} RH`;$('#standardCredits').textContent=`~ ${(stdRuntime*.20).toFixed(1)} RH`; }
function updateGenerate(){ const ready=state.image&&state.video&&state.accounts.some(a=>a.canGenerate!==false)&&!state.task&&(state.workflow!=='r4Lab'||!!lastSam3Diagnostic()); $('#generateBtn').disabled=!ready; if(!state.task)$('#generateBtn').querySelector('span:first-child').textContent=state.workflow==='koh1AntiObject'?'Jalankan tes SAM3':state.workflow==='r4Lab'?'Tes R4 Full (berbayar)':'Generate motion'; refreshLabNotice(); }
function workflowName(){
  if(state.workflow==='r15')return 'R15 Baseline';
  if(state.workflow==='koh1AntiObject')return 'MotionFly R4 · SAM3 Mask Diagnostic';
  if(state.workflow==='r4Lab')return 'MotionFly R4 · Full Controlled Test';
  return 'Current Workflow';
}
function estimateSeconds(){ if(['koh1AntiObject','r4Lab'].includes(state.workflow))return 0; if(!state.videoDuration)return 0; return state.videoDuration*(state.mode==='standard'?21.2:38.6); }
function startVisibleTimer(){
  state.startedAt=Date.now();
  $('#taskElapsed').textContent='00:00';
  clearInterval(state.elapsedTimer);
  state.elapsedTimer=setInterval(()=>$('#taskElapsed').textContent=fmtElapsed(Date.now()-state.startedAt),1000);
}
function showStartingTask(){
  state.startedAt=null;
  clearInterval(state.elapsedTimer);
  $('#taskSection').classList.remove('hidden');
  $('#resultSection').classList.add('hidden');
  $('#taskStatus').textContent='Mengupload input';
  $('#taskWorkflow').textContent=workflowName();
  $('#taskAccount').textContent=$('#accountSelect').value==='auto'?'Automatic':'Akun dipilih';
  $('#taskMode').textContent=state.mode==='standard'?'Standard':'Lite';
  $('#taskId').textContent='Menunggu task ID';
  $('#taskElapsed').textContent='—';
  const est=estimateSeconds();
  $('#taskEstimate').textContent=est?`Estimasi ± ${fmtTime(est)}`:'Estimasi —';
  $('#taskSection').scrollIntoView({behavior:'smooth',block:'center'});
}

async function generate(){
  if(!state.image||!state.video)return;
  const btn=$('#generateBtn');
  btn.disabled=true;
  btn.querySelector('span:first-child').textContent='Uploading…';
  showStartingTask();
  const fd=new FormData();fd.append('referenceImage',state.image);fd.append('videoReference',state.video);fd.append('workflow',state.workflow);fd.append('mode',state.mode);fd.append('accountId',$('#accountSelect').value||'auto');
  if(state.workflow==='r4Lab'){const maskSource=lastSam3Diagnostic();if(!maskSource){toast('Tes SAM3 berhasil harus tersedia dahulu di History.',true);return;}fd.append('diagnosticTaskId',maskSource.taskId);fd.append('diagnosticAccountId',resolveHistoryAccountId(maskSource));}
  try{
    const data=await api('/api/generate',{method:'POST',body:fd});
    state.task=data;
    const submittedIso=data.submittedAt||new Date().toISOString();
    const submittedMs=Date.parse(submittedIso);
    state.startedAt=Number.isFinite(submittedMs)?submittedMs:Date.now();
    showTask(data);
    saveHistory({taskId:data.taskId,accountId:data.accountId,workflow:data.workflow.name,outputKind:data.workflow.outputKind||'video',mode:data.mode,account:data.accountName,video:state.video.name,videoSeconds:state.videoDuration,status:data.taskStatus==='RUNNING'?'processing':'queued',startedAt:submittedIso,runtimeMs:null,resultUrl:null,referenceMaskUrl:null,error:null});
    startPolling();
  }catch(e){
    clearInterval(state.elapsedTimer);
    $('#taskStatus').textContent='Gagal memulai';
    $('#taskEstimate').textContent='Tidak selesai';
    toast(e.message,true);
    state.task=null;
    updateGenerate();
  } finally {
    btn.querySelector('span:first-child').textContent=state.workflow==='koh1AntiObject'?'Jalankan tes SAM3':state.workflow==='r4Lab'?'Tes R4 Full (berbayar)':'Generate motion';
    if(!state.task)updateGenerate();
  }
}
function showTask(data){
  clearInterval(state.elapsedTimer);
  $('#taskSection').classList.add('hidden');
  $('#resultSection').classList.add('hidden');
  $('#taskStatus').textContent=data.taskStatus==='RUNNING'?'Memproses':'Dalam antrean';
  $('#taskWorkflow').textContent=data.workflow.name;
  $('#taskAccount').textContent=data.accountName;
  $('#taskMode').textContent=data.mode==='standard'?'Standard':'Lite';
  $('#taskId').textContent=`#${data.taskId}`;
  const est=estimateSeconds();
  $('#taskEstimate').textContent=est?`Estimasi ± ${fmtTime(est)}`:'Estimasi —';
  toast('Task sudah dikirim ke RunningHub. Status dapat dipantau di History.');
}
function startPolling(){clearInterval(state.pollTimer);pollTask();state.pollTimer=setInterval(pollTask,6000)}
async function pollTask(){
  if(!state.task)return;
  try{
    const data=await api(`/api/tasks/${state.task.taskId}`,{method:'POST',body:JSON.stringify({accountId:state.task.accountId})});
    if(data.state==='queued'){
      $('#taskStatus').textContent='Dalam antrean';
      updateHistory(state.task.taskId,{status:'queued',error:null});
    }
    if(data.state==='running'){
      $('#taskStatus').textContent='Memproses';
      updateHistory(state.task.taskId,{status:'processing',error:null});
    }
    if(data.state==='failed') finishFailed(data.message||'Task gagal.',data.failure||null);
    if(data.state==='success'){
      const results=selectTaskOutputs(data.outputs, state.task.workflow.outputKind);
      if(!results.videoUrl) return finishFailed('RunningHub tidak mengembalikan video mask/generasi.');
      finishSuccess(results);
    }
  }catch(e){
    console.warn('poll',e.message);
    if(e.status===404){
      const task=state.task;
      clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
      $('#taskStatus').textContent='Pemantauan terputus';
      $('#taskEstimate').textContent='Status RunningHub belum diketahui';
      updateHistory(task.taskId,{status:'unavailable',error:e.message,runtimeMs:null});
      state.task=null;updateGenerate();
      toast('Status task tidak bisa diperiksa. Buka History lalu tekan Periksa lagi. Jangan generate ulang.',true);
    }else{
      $('#taskStatus').textContent='Gagal mengecek status';
      $('#taskEstimate').textContent='Mencoba lagi';
      updateHistory(state.task.taskId,{status:'check_error',error:e.message,runtimeMs:null});
    }
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
  $('#taskElapsed').textContent=fmtElapsed(elapsed);
  $('#taskEstimate').textContent='Task gagal';
  toast(msg,true);
  updateHistory(state.task.taskId,{status:'failed',finishedAt:new Date().toISOString(),runtimeMs:elapsed,error:msg,...(failure?{diagnosis:formatTaskDiagnosis(failure,msg),diagnosisChecked:true}:{})});
  state.task=null;$('#taskStatus').textContent='Failed';updateGenerate();
}
function finishSuccess(result){
  clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
  const elapsed=Date.now()-state.startedAt;
  $('#taskElapsed').textContent=fmtElapsed(elapsed);
  $('#taskEstimate').textContent='Selesai';
  $('#taskStatus').textContent='Selesai';
  $('#resultSection').classList.remove('hidden');
  $('#resultVideo').src=result.videoUrl;$('#downloadBtn').href=result.videoUrl;
  const diagnostic=state.task.workflow.outputKind==='diagnostic';
  $('#resultHeading').textContent=diagnostic?'Tes SAM3 selesai — hasil mask':'Generation completed';
  $('#resultMediaLabel').textContent=diagnostic?'Mask gerakan SAM3 (BUKAN hasil motion transfer)':'Video hasil generasi';
  $('#resultCacheState').textContent=diagnostic?'Hasil diagnostik siap diperiksa':'Hasil siap diputar';
  $('#downloadBtn').textContent=diagnostic?'Download video mask':'Download video';
  $('#referenceMaskWrap').classList.toggle('hidden',!diagnostic||!result.referenceMaskUrl);
  if(result.referenceMaskUrl){$('#referenceMaskPreview').src=result.referenceMaskUrl;$('#referenceMaskDownload').href=result.referenceMaskUrl;}
  $('#resultWorkflow').textContent=state.task.workflow.name;
  $('#resultDuration').textContent=`Generate time ${fmtElapsed(elapsed)}`;
  updateHistory(state.task.taskId,{status:'success',finishedAt:new Date().toISOString(),runtimeMs:elapsed,resultUrl:result.videoUrl,referenceMaskUrl:result.referenceMaskUrl});
  state.task=null;updateGenerate();
  $('#resultSection').scrollIntoView({behavior:'smooth',block:'start'});
  toast(`${diagnostic?'Tes SAM3':'Video'} selesai dalam ${fmtElapsed(elapsed)}.`);
}

const HISTORY_RETENTION_MS=3*24*60*60*1000;
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
function isActiveHistoryStatus(status){return ['uploading','queued','running','processing','check_error'].includes(String(status||'').toLowerCase())}
function historyElapsed(item){
  if(item.runtimeMs!=null) return Number(item.runtimeMs)||0;
  if(['uploading','queued','running','processing'].includes(String(item.status||'').toLowerCase())&&item.startedAt){
    const start=Date.parse(item.startedAt);
    return Number.isFinite(start)?Math.max(0,Date.now()-start):0;
  }
  return 0;
}
function historyStatusLabel(status){
  const s=String(status||'').toLowerCase();
  if(s==='queued')return 'Dalam antrean';
  if(s==='running'||s==='processing')return 'Memproses';
  if(s==='success')return 'Berhasil';
  if(s==='failed')return 'Gagal';
  if(s==='unavailable')return 'Pemantauan terputus';
  if(s==='check_error')return 'Gagal cek status';
  return status||'—';
}
function historyStatusClass(status){
  const s=String(status||'').toLowerCase();
  if(s==='success')return 'success';
  if(s==='failed')return 'failed';
  if(s==='queued')return 'queued';
  if(s==='running'||s==='processing')return 'processing';
  if(s==='unavailable'||s==='check_error')return 'failed';
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
  if(state.historyFilter==='process')return ['uploading','queued','running','processing','unavailable','check_error'].includes(status);
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
  if(!items.length){
    const message=allItems.length?'Tidak ada generation pada filter ini.':'Belum ada riwayat generation.';
    root.innerHTML=`<tr class="history-empty-row"><td colspan="8">${message}</td></tr>`;
    return;
  }
  root.innerHTML=items.map(x=>{
    const elapsed=historyElapsed(x);
    const statusClass=historyStatusClass(x.status);
    const statusLabel=historyStatusLabel(x.status);
    const error=x.error?`<small class="history-error" title="${escapeHtml(x.error)}">${escapeHtml(x.error)}</small>`:'';
    const diagnosis=x.diagnosis?`<small class="history-diagnosis">${escapeHtml(x.diagnosis)}</small>`:'';
    const inspect=x.status==='failed'&&x.taskId?`<button type="button" class="history-diagnose-btn" data-diagnose-task="${escapeHtml(x.taskId)}">Periksa penyebab</button>`:x.status==='unavailable'&&x.taskId?`<button type="button" class="history-diagnose-btn" data-recover-task="${escapeHtml(x.taskId)}">Periksa lagi</button>`:'';

    const safeUrl=x.resultUrl?escapeHtml(x.resultUrl):'';
    const resolvedAccountId=resolveHistoryAccountId(x);
    const rawDownloadUrl=(resolvedAccountId&&x.taskId)
      ? `/api/tasks/${encodeURIComponent(x.taskId)}/download?accountId=${encodeURIComponent(resolvedAccountId)}&deviceId=${encodeURIComponent(getDeviceId())}`
      : (x.resultUrl||'');
    const rawPreviewUrl=(resolvedAccountId&&x.taskId)
      ? `/api/tasks/${encodeURIComponent(x.taskId)}/preview?accountId=${encodeURIComponent(resolvedAccountId)}&deviceId=${encodeURIComponent(getDeviceId())}`
      : (x.resultUrl||'');
    const safeDownloadUrl=escapeHtml(rawDownloadUrl);
    const safePreviewUrl=escapeHtml(rawPreviewUrl);
    const extraMask=x.referenceMaskUrl?`<a class="history-action-btn download" href="${escapeHtml(x.referenceMaskUrl)}" target="_blank" rel="noopener noreferrer">Mask referensi</a>`:'';
    const result=x.resultUrl
      ? `<div class="history-actions"><button type="button" class="history-action-btn preview" data-preview-url="${safePreviewUrl}" data-download-url="${safeDownloadUrl}" data-preview-task="${escapeHtml(x.taskId||'')}">Preview ${x.outputKind==='diagnostic'?'mask':'video'}</button><a class="history-action-btn download" href="${safeDownloadUrl}">Download</a>${extraMask}</div>`
      : (isActiveHistoryStatus(x.status)?'<span class="history-pending"><span class="history-live-dot"></span>Menunggu hasil</span>':'—');
    return `<tr data-task-id="${escapeHtml(x.taskId||'')}">
      <td data-label="Time">${new Date(x.startedAt).toLocaleString('id-ID')}</td>
      <td data-label="Workflow">${escapeHtml(x.workflow)}</td>
      <td data-label="Mode">${escapeHtml(x.mode)}</td>
      <td data-label="Account">${escapeHtml(x.account)}</td>
      <td data-label="Video" class="history-video-name">${escapeHtml(x.video)}</td>
      <td data-label="Generate time" class="history-runtime">${elapsed?fmtElapsed(elapsed):'—'}</td>
      <td data-label="Status"><span class="history-status ${statusClass}"><span></span>${escapeHtml(statusLabel)}</span>${error}${diagnosis}${inspect}</td>
      <td data-label="Result">${result}</td>
    </tr>`;
  }).join('');
  if(state.workflow==='r4Lab')refreshLabNotice();
}
async function pollHistoryTasks(){
  if(state.historyPollBusy)return;
  state.historyPollBusy=true;
  try{
    const active=history().filter(item=>isActiveHistoryStatus(item.status)&&item.taskId);
    for(const item of active){
      if(state.task&&String(state.task.taskId)===String(item.taskId))continue;
      const accountId=resolveHistoryAccountId(item);
      if(!accountId){updateHistory(item.taskId,{status:'unavailable',error:'Akun lama untuk task tidak ditemukan.',runtimeMs:null});continue;}
      try{
        const data=await api(`/api/tasks/${item.taskId}`,{method:'POST',body:JSON.stringify({accountId})});
        if(data.state==='queued'){
          updateHistory(item.taskId,{accountId,status:'queued',error:null});
        }else if(data.state==='running'){
          updateHistory(item.taskId,{accountId,status:'processing',error:null});
        }else if(data.state==='failed'){
          updateHistory(item.taskId,{accountId,status:'failed',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),error:data.message||'Task gagal.',...(data.failure?{diagnosis:formatTaskDiagnosis(data.failure,data.message),diagnosisChecked:true}:{})});
        }else if(data.state==='success'){
          const outputs=selectTaskOutputs(data.outputs,item.outputKind);
          if(!outputs.videoUrl)throw new Error('Output video tidak tersedia pada respons RunningHub.');
          updateHistory(item.taskId,{accountId,status:'success',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),resultUrl:outputs.videoUrl,referenceMaskUrl:outputs.referenceMaskUrl,error:null});
        }
      }catch(e){
        console.warn('history poll',item.taskId,e.message);
        if(e.status===404)updateHistory(item.taskId,{status:'unavailable',error:e.message,runtimeMs:null});
        else updateHistory(item.taskId,{status:'check_error',error:'Gagal memeriksa status: '+e.message,runtimeMs:null});
      }
    }
  }finally{
    state.historyPollBusy=false;
  }
}
function openHistoryPreview(url,taskId='',downloadUrl=''){
  const modal=$('#historyPreviewModal');
  const video=$('#historyPreviewVideo');
  const download=$('#historyPreviewDownload');
  const title=$('#historyPreviewTitle');
  if(!modal||!video||!download)return;
  video.pause();
  video.preload='auto';
  video.src=url;
  video.load();
  video.onerror=()=>toast('Preview video gagal dimuat. Coba tutup lalu buka Preview lagi.',true);
  video.oncanplay=()=>{ video.play().catch(()=>{}); };
  download.href=downloadUrl||url;
  download.removeAttribute('download');
  if(title) title.textContent=taskId?`Preview #${taskId}`:'Video preview';
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}
function closeHistoryPreview(){
  const modal=$('#historyPreviewModal');
  const video=$('#historyPreviewVideo');
  if(video){video.pause();video.removeAttribute('src');video.load();}
  if(modal)modal.classList.add('hidden');
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

function startHistoryMonitor(){
  clearInterval(state.historyPollTimer);
  clearInterval(state.historyClockTimer);
  state.historyPollTimer=setInterval(pollHistoryTasks,5000);
  state.historyClockTimer=setInterval(()=>{if(state.view==='history')renderHistory()},1000);
  pollHistoryTasks();
  inspectRecentFailedTasks();
}

function initDropzone(label,input,kind){label.addEventListener('dragover',e=>{e.preventDefault();label.classList.add('dragover')});label.addEventListener('dragleave',()=>label.classList.remove('dragover'));label.addEventListener('drop',e=>{e.preventDefault();label.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(f)setMedia(kind,f)});input.onchange=()=>{const f=input.files?.[0];if(f)setMedia(kind,f)};}

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
$$('.workflow-card').forEach(b=>b.onclick=()=>{$$('.workflow-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.workflow=b.dataset.workflow;updateEstimates();updateGenerate();$('#diagnosticNotice').classList.toggle('hidden',state.workflow!=='koh1AntiObject');$('#fullLabNotice').classList.toggle('hidden',state.workflow!=='r4Lab');});
$$('.mode-card').forEach(b=>b.onclick=()=>{$$('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.mode=b.dataset.mode});
initDropzone($('#imageDrop'),$('#referenceImage'),'image');initDropzone($('#videoDrop'),$('#videoReference'),'video');
$('#generateBtn').onclick=generate;$('#refreshAccounts').onclick=refreshAccounts;
const historyFilters=$('#historyFilters');
if(historyFilters) historyFilters.onclick=e=>{
  const btn=e.target.closest('[data-history-filter]');
  if(!btn)return;
  state.historyFilter=btn.dataset.historyFilter||'all';
  renderHistory();
};
$('#addAccountBtn').onclick=async()=>{const input=$('#apiKeyInput'),key=input.value.trim();if(!key)return toast('Masukkan API key.',true);const btn=$('#addAccountBtn');btn.disabled=true;btn.textContent='Validating…';try{await api('/api/accounts',{method:'POST',body:JSON.stringify({apiKey:key})});input.value='';toast('API key valid dan ditambahkan.');await loadSession();}catch(e){toast(e.message,true)}finally{btn.disabled=false;btn.textContent='Add to pool'}};

bindHistoryActions();loadSession().then(()=>startHistoryMonitor()).catch(e=>toast(e.message,true));updateEstimates();updateGenerate();renderHistory();
