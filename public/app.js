const state = {
  view: 'create', workflow: 'r15', mode: 'lite', session: null, accounts: [],
  image: null, video: null, videoDuration: 0, task: null, pollTimer: null, elapsedTimer: null, startedAt: null,
  historyPollTimer: null, historyClockTimer: null, historyPollBusy: false,
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

function switchView(view){ state.view=view; $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`)); function bindUI(){
  $$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

  const menuBtn=$('#menuBtn');
  const sidebar=$('#sidebar');
  if(menuBtn&&sidebar) menuBtn.onclick=()=>sidebar.classList.toggle('open');

  $$('.workflow-card').forEach(b=>b.onclick=()=>{
    $$('.workflow-card').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    state.workflow=b.dataset.workflow;
  });

  $$('.mode-card').forEach(b=>b.onclick=()=>{
    $$('.mode-card').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    state.mode=b.dataset.mode;
    updateEstimates();
  });

  const imageDrop=$('#imageDrop'), referenceImage=$('#referenceImage');
  const videoDrop=$('#videoDrop'), videoReference=$('#videoReference');
  if(imageDrop&&referenceImage) initDropzone(imageDrop,referenceImage,'image');
  if(videoDrop&&videoReference) initDropzone(videoDrop,videoReference,'video');

  $('#generateBtn')?.addEventListener('click',generate);
  $('#refreshAccounts')?.addEventListener('click',refreshAccounts);

  const addAccountBtn=$('#addAccountBtn');
  if(addAccountBtn) addAccountBtn.onclick=async()=>{
    const input=$('#apiKeyInput');
    const key=input?.value?.trim()||'';
    if(!key)return toast('Masukkan API key.',true);
    addAccountBtn.disabled=true;
    addAccountBtn.textContent='Validating…';
    try{
      await api('/api/accounts',{method:'POST',body:JSON.stringify({apiKey:key})});
      input.value='';
      toast('API key valid dan ditambahkan.');
      await loadSession();
    }catch(e){
      toast(e.message,true);
    }finally{
      addAccountBtn.disabled=false;
      addAccountBtn.textContent='Add to pool';
    }
  };
}

try{
  bindUI();
  bindHistoryActions();
  updateEstimates();
  updateGenerate();
  renderHistory();
  loadSession().then(()=>startHistoryMonitor()).catch(e=>toast(e.message,true));
}catch(e){
  console.error('VANTA startup failed',e);
  toast('UI gagal dimuat. Reload halaman.',true);
}
