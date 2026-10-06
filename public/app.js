const state = {
  view: 'create', workflow: 'r15', mode: 'lite', session: null, accounts: [],
  image: null, video: null, videoDuration: 0, task: null, pollTimer: null, elapsedTimer: null, startedAt: null,
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.classList.toggle('error',error); el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),4200); }
function fmtTime(seconds){ seconds=Math.max(0,Math.round(seconds||0)); const m=Math.floor(seconds/60),s=seconds%60; return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`; }
function fmtElapsed(ms){ const sec=Math.floor(ms/1000),m=Math.floor(sec/60),s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function fileSize(n){ if(!n)return '0 B'; const u=['B','KB','MB','GB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(i?1:0)} ${u[i]}`; }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function switchView(view){ state.view=view; $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`)); $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); $('#pageTitle').textContent=view==='create'?'Motion Control':view==='history'?'History':'Account Pool'; $('#sidebar').classList.remove('open'); if(view==='history')renderHistory(); if(view==='accounts')refreshAccounts(); }

async function api(url, options={}){ const r=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})}}); let data={}; try{data=await r.json()}catch{} if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`); return data; }

async function loadSession(){
  state.session=await api('/api/session'); state.accounts=state.session.accounts||[]; renderAccountSelect(); updateSetupState(); await refreshAccounts();
}
function updateSetupState(){ const configured=Boolean(state.session?.workflowIdConfigured); $('#setupWarning').classList.toggle('hidden',configured); $('#workflowIdState').textContent=configured?`Configured: ${state.session.workflowId}`:'Belum dikonfigurasi. Dipakai untuk R15 dan Current Workflow.'; updateGenerate(); }
function renderAccountSelect(){ const sel=$('#accountSelect'); const current=sel.value||'auto'; sel.innerHTML='<option value="auto">Automatic</option>'+state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join(''); sel.value=[...sel.options].some(o=>o.value===current)?current:'auto'; }

async function refreshAccounts(){
  if(!state.accounts.length){ state.accounts=[]; renderAccounts(); updatePoolSummary(); return; }
  try{ const data=await api('/api/accounts/refresh',{method:'POST',body:'{}'}); state.accounts=data.accounts||[]; renderAccounts(); updatePoolSummary(); renderAccountSelect(); }
  catch(e){ toast(e.message,true); }
}
function updatePoolSummary(){ const healthy=state.accounts.filter(a=>a.status&&!a.status.error); const total=healthy.reduce((s,a)=>s+Number(a.status.remainCoins||0),0); $('#poolCount').textContent=`${healthy.length} akun siap`; $('#poolCredits').textContent=Number.isFinite(total)?Math.round(total).toLocaleString('id-ID'):'0'; $('#poolDot').classList.toggle('ready',healthy.length>0); updateGenerate(); }
function renderAccounts(){
  const root=$('#accountList'); if(!state.accounts.length){root.innerHTML='<div class="empty-state">Belum ada API key di pool.<br>Tambahkan akun pertama dari panel di sebelah kiri.</div>';return;}
  root.innerHTML=state.accounts.map(a=>{const s=a.status||{};const ok=!s.error&&a.status;return `<div class="account-card"><div><div class="account-card-main"><div class="account-icon">◎</div><div><strong>${escapeHtml(a.name)}</strong><small>${ok?'Ready':'Status belum dibaca'}</small></div></div><div class="account-metrics"><span>RH ${ok?Number(s.remainCoins||0).toLocaleString('id-ID'):'—'}</span><span>Tasks ${ok?Number(s.currentTaskCounts||0):'—'}</span>${s.error?`<span>${escapeHtml(s.error)}</span>`:''}</div></div><button class="delete-account" data-delete="${a.id}">Remove</button></div>`}).join('');
  $$('[data-delete]').forEach(btn=>btn.onclick=async()=>{try{await api(`/api/accounts/${btn.dataset.delete}`,{method:'DELETE'});toast('Akun dihapus.');await loadSession();}catch(e){toast(e.message,true)}});
}

function setMedia(kind,file){
  if(kind==='image'){state.image=file;const p=$('#imagePreview'); if(!file){p.innerHTML='';p.classList.remove('active');updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<img src="${url}" alt="Reference preview"><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small>${fileSize(file.size)}</small></div><button class="remove-media" data-remove="image">×</button></div>`;p.classList.add('active');}
  else{state.video=file;const p=$('#videoPreview'); if(!file){p.innerHTML='';p.classList.remove('active');state.videoDuration=0;updateEstimates();updateGenerate();return} const url=URL.createObjectURL(file);p.innerHTML=`<video src="${url}" muted playsinline preload="metadata"></video><div class="media-overlay"><div><strong>${escapeHtml(file.name)}</strong><small id="videoFileMeta">${fileSize(file.size)}</small></div><button class="remove-media" data-remove="video">×</button></div>`;p.classList.add('active');const v=p.querySelector('video');v.onloadedmetadata=()=>{state.videoDuration=v.duration||0;$('#videoFileMeta').textContent=`${fileSize(file.size)} · ${fmtTime(v.duration)}`;updateEstimates();};}
  $$('[data-remove]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();setMedia(btn.dataset.remove,null)});updateGenerate();
}
function updateEstimates(){ const d=state.videoDuration;if(!d){$('#liteCredits').textContent=$('#liteTime').textContent=$('#standardCredits').textContent=$('#standardTime').textContent='—';return} const liteRuntime=d*38.6,stdRuntime=d*21.2;$('#liteTime').textContent=`± ${fmtTime(liteRuntime)}`;$('#standardTime').textContent=`± ${fmtTime(stdRuntime)}`;$('#liteCredits').textContent=`~ ${(liteRuntime*.02).toFixed(1)} RH`;$('#standardCredits').textContent=`~ ${(stdRuntime*.20).toFixed(1)} RH`; }
function updateGenerate(){ const ready=state.image&&state.video&&state.accounts.length&&state.session?.workflowIdConfigured&&!state.task; $('#generateBtn').disabled=!ready; }

async function generate(){
  if(!state.image||!state.video)return; const btn=$('#generateBtn');btn.disabled=true;btn.querySelector('span:first-child').textContent='Uploading…';
  const fd=new FormData();fd.append('referenceImage',state.image);fd.append('videoReference',state.video);fd.append('workflow',state.workflow);fd.append('mode',state.mode);fd.append('accountId',$('#accountSelect').value||'auto');
  try{
    const data=await api('/api/generate',{method:'POST',body:fd}); state.task=data;state.startedAt=Date.now();showTask(data);saveHistory({taskId:data.taskId,workflow:data.workflow.name,mode:data.mode,account:data.accountName,video:state.video.name,status:'running',startedAt:new Date().toISOString(),resultUrl:null});startPolling();
  }catch(e){toast(e.message,true);state.task=null;updateGenerate()}
  finally{btn.querySelector('span:first-child').textContent='Generate motion';if(!state.task)updateGenerate();}
}
function showTask(data){$('#taskSection').classList.remove('hidden');$('#resultSection').classList.add('hidden');$('#taskStatus').textContent=data.taskStatus==='RUNNING'?'Memproses':'Dalam antrean';$('#taskWorkflow').textContent=data.workflow.name;$('#taskAccount').textContent=data.accountName;$('#taskMode').textContent=data.mode==='standard'?'Standard':'Lite';$('#taskId').textContent=`#${data.taskId}`;clearInterval(state.elapsedTimer);state.elapsedTimer=setInterval(()=>$('#taskElapsed').textContent=fmtElapsed(Date.now()-state.startedAt),1000);$('#taskSection').scrollIntoView({behavior:'smooth',block:'center'});}
function startPolling(){clearInterval(state.pollTimer);pollTask();state.pollTimer=setInterval(pollTask,6000)}
async function pollTask(){ if(!state.task)return; try{const data=await api(`/api/tasks/${state.task.taskId}`,{method:'POST',body:JSON.stringify({accountId:state.task.accountId})}); if(data.state==='queued')$('#taskStatus').textContent='Dalam antrean'; if(data.state==='running')$('#taskStatus').textContent='Memproses'; if(data.state==='failed'){finishFailed(data.message||'Task gagal.');} if(data.state==='success'){const video=data.outputs.find(o=>String(o.fileType||'').toLowerCase().includes('video'))||data.outputs[0];if(!video?.fileUrl)return finishFailed('Task selesai tetapi URL output tidak ditemukan.');finishSuccess(video.fileUrl);} }catch(e){console.warn('poll',e.message)} }
function finishFailed(msg){clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);toast(msg,true);updateHistory(state.task.taskId,{status:'failed',finishedAt:new Date().toISOString()});state.task=null;$('#taskStatus').textContent='Failed';updateGenerate();}
function finishSuccess(url){clearInterval(state.pollTimer);clearInterval(state.elapsedTimer);const elapsed=Date.now()-state.startedAt;$('#taskStatus').textContent='Selesai';$('#resultSection').classList.remove('hidden');$('#resultVideo').src=url;$('#downloadBtn').href=url;$('#resultWorkflow').textContent=state.task.workflow.name;$('#resultDuration').textContent=fmtElapsed(elapsed);updateHistory(state.task.taskId,{status:'success',finishedAt:new Date().toISOString(),resultUrl:url});state.task=null;updateGenerate();$('#resultSection').scrollIntoView({behavior:'smooth',block:'start'});toast('Video selesai dibuat.');}

function history(){try{return JSON.parse(localStorage.getItem('vantaHistoryV2')||'[]')}catch{return[]}}
function setHistory(items){localStorage.setItem('vantaHistoryV2',JSON.stringify(items.slice(0,100)))}
function saveHistory(item){setHistory([item,...history().filter(x=>x.taskId!==item.taskId)])}
function updateHistory(taskId,patch){setHistory(history().map(x=>x.taskId===taskId?{...x,...patch}:x));if(state.view==='history')renderHistory()}
function renderHistory(){const items=history();const root=$('#historyBody');if(!items.length){root.innerHTML='<tr><td colspan="7" style="text-align:center;color:#798493;padding:34px">Belum ada riwayat.</td></tr>';return}root.innerHTML=items.map(x=>`<tr><td>${new Date(x.startedAt).toLocaleString('id-ID')}</td><td>${escapeHtml(x.workflow)}</td><td>${escapeHtml(x.mode)}</td><td>${escapeHtml(x.account)}</td><td>${escapeHtml(x.video)}</td><td>${escapeHtml(x.status)}</td><td>${x.resultUrl?`<a href="${x.resultUrl}" target="_blank" rel="noopener">Open</a>`:'—'}</td></tr>`).join('')}

function initDropzone(label,input,kind){label.addEventListener('dragover',e=>{e.preventDefault();label.classList.add('dragover')});label.addEventListener('dragleave',()=>label.classList.remove('dragover'));label.addEventListener('drop',e=>{e.preventDefault();label.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(f)setMedia(kind,f)});input.onchange=()=>{const f=input.files?.[0];if(f)setMedia(kind,f)};}

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');$('#openSetupBtn').onclick=()=>switchView('accounts');
$$('.workflow-card').forEach(b=>b.onclick=()=>{$$('.workflow-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.workflow=b.dataset.workflow});
$$('.mode-card').forEach(b=>b.onclick=()=>{$$('.mode-card').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.mode=b.dataset.mode});
initDropzone($('#imageDrop'),$('#referenceImage'),'image');initDropzone($('#videoDrop'),$('#videoReference'),'video');
$('#generateBtn').onclick=generate;$('#refreshAccounts').onclick=refreshAccounts;$('#clearHistory').onclick=()=>{localStorage.removeItem('vantaHistoryV2');renderHistory();toast('History dibersihkan.')};
$('#saveWorkflowId').onclick=async()=>{const value=$('#workflowIdInput').value.trim();try{const data=await api('/api/config',{method:'PUT',body:JSON.stringify({workflowId:value})});$('#workflowIdInput').value='';toast('Workflow ID tersimpan.');await loadSession();$('#workflowIdState').textContent=`Configured: ${data.masked}`;}catch(e){toast(e.message,true)}};
$('#addAccountBtn').onclick=async()=>{const input=$('#apiKeyInput'),key=input.value.trim();if(!key)return toast('Masukkan API key.',true);const btn=$('#addAccountBtn');btn.disabled=true;btn.textContent='Validating…';try{await api('/api/accounts',{method:'POST',body:JSON.stringify({apiKey:key})});input.value='';toast('API key valid dan ditambahkan.');await loadSession();}catch(e){toast(e.message,true)}finally{btn.disabled=false;btn.textContent='Add to pool'}};

loadSession().catch(e=>toast(e.message,true));updateEstimates();updateGenerate();renderHistory();
