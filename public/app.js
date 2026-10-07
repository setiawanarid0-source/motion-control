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

async function api(url, options={}){ const r=await fetch(url,{...options,headers:{'X-Vanta-Device':getDeviceId(),...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}}); let data={}; try{data=await r.json()}catch{} if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`); return data; }

async function loadSession(){
  state.session=await api('/api/session'); state.accounts=state.session.accounts||[]; renderAccountSelect(); updateGenerate(); await refreshAccounts();
}
function renderAccountSelect(){ const sel=$('#accountSelect'); const current=sel.value||'auto'; sel.innerHTML='<option value="auto">Automatic</option>'+state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join(''); sel.value=[...sel.options].some(o=>o.value===current)?current:'auto'; }

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
    if(Number(data.autoRemovedCount||0)>0){
      toast(`${data.autoRemovedCount} akun dengan kredit di bawah ${data.minimumCredits||100} RH otomatis dihapus dari pool.`);
    }
  }catch(e){
    toast(e.message,true);
  }finally{
    if(refreshBtn){ refreshBtn.disabled=false; refreshBtn.classList.remove('refreshing'); }
  }
}
function updatePoolSummary(){ const healthy=state.accounts.filter(a=>a.status&&!a.status.error); $('#poolCount').textContent=`${healthy.length} akun siap`; $('#poolCredits').textContent=String(healthy.length); const unit=$('#poolReadyUnit'); if(unit)unit.textContent='akun siap'; $('#poolDot').classList.toggle('ready',healthy.length>0); updateGenerate(); }
function renderAccounts(){
  const root=$('#accountList'); if(!state.accounts.length){root.innerHTML='<div class="empty-state">Belum ada API key di pool.<br>Tambahkan akun pertama dari panel di sebelah kiri.</div>';return;}
  root.innerHTML=state.accounts.map(a=>{const s=a.status||{};const ok=!s.error&&a.status;return `<div class="account-card"><div><div class="account-card-main"><div class="account-icon">◎</div><div><strong>${escapeHtml(a.name)}</strong><small>${ok?'Ready':'Status belum dibaca'}</small></div></div><div class="account-metrics"><span>RH ${ok?Number(s.remainCoins||0).toLocaleString('id-ID'):'—'}</span><span>Tasks ${ok?Number(s.currentTaskCounts||0):'—'}</span>${s.error?`<span>${escapeHtml(s.error)}</span>`:''}</div></div><button class="delete-account" data-delete="${a.id}" type="button" aria-label="Remove ${escapeHtml(a.name)}" title="Remove account"><span class="delete-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg></span><span class="delete-account-label">Remove</span></button></div>`}).join('');
  $$('[data-delete]').forEach(btn=>btn.onclick=async()=>{try{await api(`/api/accounts/${btn.dataset.delete}`,{method:'DELETE'});toast('Akun dihapus.');await loadSession();}catch(e){toast(e.message,true)}});
}

function setMedia(kind,file){
  if(kind==='image'){state.image=file;const p=$('#imagePreview'); if(!file){p.innerHTML='';p.classList.remove('active');updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<img src="${url}" alt="Reference preview"><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small>${fileSize(file.size)}</small></div><button class="remove-media" data-remove="image">×</button></div>`;p.classList.add('active');}
  else{state.video=file;const p=$('#videoPreview'); if(!file){p.innerHTML='';p.classList.remove('active');state.videoDuration=0;updateEstimates();updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<video src="${url}" muted playsinline preload="metadata"></video><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small id="videoFileMeta">${fileSize(file.size)}</small></div><button class="remove-media" data-remove="video">×</button></div>`;p.classList.add('active');const v=p.querySelector('video');v.onloadedmetadata=()=>{state.videoDuration=v.duration||0;$('#videoFileMeta').textContent=`${fileSize(file.size)} · ${fmtTime(v.duration)}`;updateEstimates();};}
  $$('[data-remove]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();setMedia(btn.dataset.remove,null)});updateGenerate();
}
function updateEstimates(){ const d=state.videoDuration;if(!d){$('#liteCredits').textContent=$('#liteTime').textContent=$('#standardCredits').textContent=$('#standardTime').textContent='—';return} const liteRuntime=d*38.6,stdRuntime=d*21.2;$('#liteTime').textContent=`± ${fmtTime(liteRuntime)}`;$('#standardTime').textContent=`± ${fmtTime(stdRuntime)}`;$('#liteCredits').textContent=`~ ${(liteRuntime*.02).toFixed(1)} RH`;$('#standardCredits').textContent=`~ ${(stdRuntime*.20).toFixed(1)} RH`; }
function updateGenerate(){ const ready=state.image&&state.video&&state.accounts.length&&!state.task; $('#generateBtn').disabled=!ready; }
function workflowName(){ return state.workflow==='r15'?'R15 Baseline':'Current Workflow'; }
function estimateSeconds(){ if(!state.videoDuration)return 0; return state.videoDuration*(state.mode==='standard'?21.2:38.6); }
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
  try{
    const data=await api('/api/generate',{method:'POST',body:fd});
    state.task=data;
    const submittedIso=data.submittedAt||new Date().toISOString();
    const submittedMs=Date.parse(submittedIso);
    state.startedAt=Number.isFinite(submittedMs)?submittedMs:Date.now();
    showTask(data);
    saveHistory({taskId:data.taskId,accountId:data.accountId,workflow:data.workflow.name,mode:data.mode,account:data.accountName,video:state.video.name,videoSeconds:state.videoDuration,status:data.taskStatus==='RUNNING'?'processing':'queued',startedAt:submittedIso,runtimeMs:null,resultUrl:null,error:null});
    startPolling();
  }catch(e){
    clearInterval(state.elapsedTimer);
    $('#taskStatus').textContent='Gagal memulai';
    $('#taskEstimate').textContent='Tidak selesai';
    toast(e.message,true);
    state.task=null;
    updateGenerate();
  } finally {
    btn.querySelector('span:first-child').textContent='Generate motion';
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
    if(data.state==='failed') finishFailed(data.message||'Task gagal.');
    if(data.state==='success'){
      const video=data.outputs.find(o=>String(o.fileType||'').toLowerCase().includes('video'))||data.outputs[0];
      if(!video?.fileUrl) return finishFailed('Task selesai tetapi URL output tidak ditemukan.');
      finishSuccess(video.fileUrl);
    }
  }catch(e){
    console.warn('poll',e.message);
  }
}
function finishFailed(msg){
  clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
  const elapsed=Date.now()-state.startedAt;
  $('#taskElapsed').textContent=fmtElapsed(elapsed);
  $('#taskEstimate').textContent='Task gagal';
  toast(msg,true);
  updateHistory(state.task.taskId,{status:'failed',finishedAt:new Date().toISOString(),runtimeMs:elapsed,error:msg});
  state.task=null;$('#taskStatus').textContent='Failed';updateGenerate();
}
function finishSuccess(url){
  clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);
  const elapsed=Date.now()-state.startedAt;
  $('#taskElapsed').textContent=fmtElapsed(elapsed);
  $('#taskEstimate').textContent='Selesai';
  $('#taskStatus').textContent='Selesai';
  $('#resultSection').classList.remove('hidden');
  $('#resultVideo').src=url;$('#downloadBtn').href=url;
  $('#resultWorkflow').textContent=state.task.workflow.name;
  $('#resultDuration').textContent=`Generate time ${fmtElapsed(elapsed)}`;
  updateHistory(state.task.taskId,{status:'success',finishedAt:new Date().toISOString(),runtimeMs:elapsed,resultUrl:url});
  state.task=null;updateGenerate();
  $('#resultSection').scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Video selesai dalam ${fmtElapsed(elapsed)}.`);
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
function isActiveHistoryStatus(status){return ['uploading','queued','running','processing'].includes(String(status||'').toLowerCase())}
function historyElapsed(item){
  if(item.runtimeMs!=null) return Number(item.runtimeMs)||0;
  if(isActiveHistoryStatus(item.status)&&item.startedAt){
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
  return status||'—';
}
function historyStatusClass(status){
  const s=String(status||'').toLowerCase();
  if(s==='success')return 'success';
  if(s==='failed')return 'failed';
  if(s==='queued')return 'queued';
  if(s==='running'||s==='processing')return 'processing';
  return 'neutral';
}
function resolveHistoryAccountId(item){
  if(item.accountId)return item.accountId;
  return state.accounts.find(a=>a.name===item.account)?.id||null;
}
function historyFilterMatches(item){
  const status=String(item?.status||'').toLowerCase();
  if(state.historyFilter==='success')return status==='success';
  if(state.historyFilter==='failed')return status==='failed';
  if(state.historyFilter==='process')return ['uploading','queued','running','processing'].includes(status);
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
    const result=x.resultUrl
      ? `<div class="history-actions"><button type="button" class="history-action-btn preview" data-preview-url="${safePreviewUrl}" data-download-url="${safeDownloadUrl}" data-preview-task="${escapeHtml(x.taskId||'')}">Preview</button><a class="history-action-btn download" href="${safeDownloadUrl}">Download</a></div>`
      : (isActiveHistoryStatus(x.status)?'<span class="history-pending"><span class="history-live-dot"></span>Menunggu hasil</span>':'—');
    return `<tr data-task-id="${escapeHtml(x.taskId||'')}">
      <td data-label="Time">${new Date(x.startedAt).toLocaleString('id-ID')}</td>
      <td data-label="Workflow">${escapeHtml(x.workflow)}</td>
      <td data-label="Mode">${escapeHtml(x.mode)}</td>
      <td data-label="Account">${escapeHtml(x.account)}</td>
      <td data-label="Video" class="history-video-name">${escapeHtml(x.video)}</td>
      <td data-label="Generate time" class="history-runtime">${elapsed?fmtElapsed(elapsed):'—'}</td>
      <td data-label="Status"><span class="history-status ${statusClass}"><span></span>${escapeHtml(statusLabel)}</span>${error}</td>
      <td data-label="Result">${result}</td>
    </tr>`;
  }).join('');
}
async function pollHistoryTasks(){
  if(state.historyPollBusy)return;
  state.historyPollBusy=true;
  try{
    const active=history().filter(item=>isActiveHistoryStatus(item.status)&&item.taskId);
    for(const item of active){
      if(state.task&&String(state.task.taskId)===String(item.taskId))continue;
      const accountId=resolveHistoryAccountId(item);
      if(!accountId)continue;
      try{
        const data=await api(`/api/tasks/${item.taskId}`,{method:'POST',body:JSON.stringify({accountId})});
        if(data.state==='queued'){
          updateHistory(item.taskId,{accountId,status:'queued',error:null});
        }else if(data.state==='running'){
          updateHistory(item.taskId,{accountId,status:'processing',error:null});
        }else if(data.state==='failed'){
          updateHistory(item.taskId,{accountId,status:'failed',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),error:data.message||'Task gagal.'});
        }else if(data.state==='success'){
          const video=data.outputs?.find(o=>String(o.fileType||'').toLowerCase().includes('video'))||data.outputs?.[0];
          updateHistory(item.taskId,{accountId,status:'success',finishedAt:new Date().toISOString(),runtimeMs:historyElapsed(item),resultUrl:video?.fileUrl||null,error:null});
        }
      }catch(e){
        console.warn('history poll',item.taskId,e.message);
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
    body.addEventListener('click',e=>{
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
}

function initDropzone(label,input,kind){label.addEventListener('dragover',e=>{e.preventDefault();label.classList.add('dragover')});label.addEventListener('dragleave',()=>label.classList.remove('dragover'));label.addEventListener('drop',e=>{e.preventDefault();label.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(f)setMedia(kind,f)});input.onchange=()=>{const f=input.files?.[0];if(f)setMedia(kind,f)};}

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
$$('.workflow-card').forEach(b=>b.onclick=()=>{$$('.workflow-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.workflow=b.dataset.workflow});
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
