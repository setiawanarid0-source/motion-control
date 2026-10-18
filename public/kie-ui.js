// The kie.ai image surface is independent of the RunningHub UI/state.
(()=>{
  const kie={mode:'create',models:[],accounts:[],tasks:[],filter:'all',selectedTask:null,polling:false,busy:false};
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=n=>Number(n??0).toLocaleString('id-ID',{maximumFractionDigits:2});
  const model=()=>kie.models.find(x=>x.id===el('kieModel')?.value)||null;
  const active=s=>!['success','failed'].includes(s);
  const badge=s=>({success:'Berhasil',failed:'Gagal',queued:'Dalam antrean',generating:'Memproses',check_error:'Status belum tersedia'}[s]||s);
  const closeSidebar=()=>{
    el('sidebar')?.classList.remove('open');
    el('sidebarOverlay')?.classList.remove('visible');
    document.body.classList.remove('sidebar-open');
    el('menuBtn')?.setAttribute('aria-expanded','false');
  };
  const openSidebar=()=>{
    el('sidebar')?.classList.add('open');
    el('sidebarOverlay')?.classList.add('visible');
    document.body.classList.add('sidebar-open');
    el('menuBtn')?.setAttribute('aria-expanded','true');
  };
  el('menuBtn').onclick=()=>el('sidebar').classList.contains('open')?closeSidebar():openSidebar();
  el('sidebarOverlay').onclick=closeSidebar;
  el('sidebarClose').onclick=closeSidebar;
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSidebar();});
  document.querySelectorAll('[data-nav-group]').forEach(button=>{
    button.onclick=()=>{
      const group=button.closest('.nav-group'),expanded=group.classList.toggle('expanded');
      button.setAttribute('aria-expanded',String(expanded));
    };
  });
  let startX=0,startY=0;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;startX=e.touches[0].clientX;startY=e.touches[0].clientY;
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!startX&&startX!==0)return;
    const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;
    if(Math.abs(dx)<90||Math.abs(dx)<Math.abs(dy)*1.25)return;
    if(dx<0&&el('sidebar').classList.contains('open'))closeSidebar();
    else if(dx>0&&startX<24&&!el('sidebar').classList.contains('open'))openSidebar();
  },{passive:true});
  window.vantaKieNavigation=view=>{
    if(view==='image-create'){loadModels();loadAccounts();loadTasks();}
    if(view==='image-history')loadTasks();
    if(view==='kie-accounts')loadAccounts();
  };
  async function loadModels(){
    if(kie.models.length)return;
    try{const data=await api('/api/kie/models');kie.models=data.models||[];
      el('kieModel').innerHTML=kie.models.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join('');
      updateModel();
    }catch(e){toast('Tidak dapat memuat model kie.ai: '+e.message,true);}
  }
  function setImageMode(mode){
    kie.mode=mode;
    document.querySelectorAll('[data-image-mode]').forEach(b=>{
      const on=b.dataset.imageMode===mode;b.classList.toggle('selected',on);
      b.setAttribute('aria-selected',String(on));
    });
    el('kieRefsWrap').classList.toggle('hidden',mode!=='edit');
    el('kiePrompt').placeholder=mode==='edit'?'Jelaskan perubahan yang diinginkan pada gambar referensi…':
      'Deskripsikan gambar yang ingin dibuat…';
    el('kieGenerateBtn').querySelector('span').textContent=mode==='edit'?'Edit Image':'Generate Image';
    updateModel();
  }
  function updateModel(){
    const m=model();if(!m)return;
    el('kieAspectField').classList.toggle('hidden',!m.aspect);
    el('kieResolutionField').classList.toggle('hidden',!m.resolution);
    el('kieResolutionLabel').textContent=m.resolution==='quality'?'KUALITAS':'RESOLUSI';
    const prev=el('kieResolution').value;
    el('kieResolution').innerHTML=(m.resolutions||[]).map(x=>
      '<option value="'+esc(x)+'">'+esc(x==='basic'?'Basic':x==='high'?'High':x)+'</option>').join('');
    if(m.resolutions?.includes(prev))el('kieResolution').value=prev;
    el('kieModelHint').textContent=m.id==='wan'?'WAN 2.7 Pro mengatur aspect ratio otomatis. Biaya bergantung model dan resolusi.':
      'Parameter hanya ditampilkan bila didukung model. Kredit dipotong langsung oleh kie.ai.';
  }
  let previewURLs=[];
  function showRefImages(){
    previewURLs.forEach(URL.revokeObjectURL);previewURLs=[];
    const files=[...el('kieRefs').files];
    const root=el('kieRefsPreview');
    if(files.length>2||files.some(f=>f.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type))){
      el('kieRefs').value='';root.innerHTML='';toast('Maksimal dua gambar, masing-masing 10 MB (JPG/PNG/WEBP).',true);return;
    }
    root.innerHTML=files.map((f,index)=>{
      const url=URL.createObjectURL(f);previewURLs.push(url);
      return '<div class="kie-ref-thumbnail"><img src="'+url+'" alt="Gambar referensi '+(index+1)+'"><small>Image '+(index+1)+'</small></div>';
    }).join('');
  }
  function drawAccounts(){
    const select=el('kieAccountSelect'),current=select.value;
    select.innerHTML='<option value="auto">Automatic · akun dengan kredit tersedia</option>'+
      kie.accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' · '+(a.credits==null?'saldo —':fmt(a.credits)+' kredit')+'</option>').join('');
    if([...select.options].some(o=>o.value===current))select.value=current;
    const list=el('kieAccountList');
    list.innerHTML=kie.accounts.length?kie.accounts.map(a=>
      '<article class="account-card"><div class="account-card-main"><div class="account-icon">K</div><div><strong>'+esc(a.name)+
      '</strong><small>'+(a.state==='unavailable'?'Status belum tersedia':Number(a.credits)>0?'Siap digunakan':'Kredit habis')+
      '</small></div></div><div class="account-metrics"><span>'+esc(a.credits==null?'—':fmt(a.credits))+' kredit</span><span>kie.ai</span></div>'+
      '<button class="delete-account" type="button" data-kie-remove="'+esc(a.id)+'">Remove</button></article>').join(''):
      '<div class="empty-state">Belum ada akun kie.ai.<br>Tambahkan satu API key melalui panel kiri.</div>';
  }
  async function loadAccounts(){
    try{const d=await api('/api/kie/accounts');kie.accounts=d.accounts||[];drawAccounts();}
    catch(e){toast('Account Pool kie.ai: '+e.message,true);}
  }
  async function refreshAccounts(){
    const b=el('kieRefreshAccounts');b.disabled=true;
    try{const d=await api('/api/kie/accounts/refresh',{method:'POST',body:'{}'});kie.accounts=d.accounts||[];drawAccounts();toast('Kredit kie.ai diperbarui.');}
    catch(e){toast(e.message,true);}finally{b.disabled=false;}
  }
  async function addAccount(){
    const key=el('kieKeyInput').value.trim();if(!key)return toast('Masukkan API key kie.ai.',true);
    const b=el('kieAddAccount');b.disabled=true;b.textContent='Memeriksa…';
    try{await api('/api/kie/accounts',{method:'POST',body:JSON.stringify({apiKey:key})});el('kieKeyInput').value='';
      await loadAccounts();toast('Akun kie.ai berhasil ditambahkan.');}
    catch(e){toast(e.message,true);}finally{b.disabled=false;b.textContent='Add to pool';}
  }
  async function removeAccount(id){
    const a=kie.accounts.find(x=>x.id===id);
    if(!a||!confirm('Hapus '+a.name+' dari Account Pool kie.ai? Task lama tetap dipantau.'))return;
    try{await api('/api/kie/accounts/'+encodeURIComponent(id),{method:'DELETE'});await loadAccounts();toast('Akun kie.ai dikeluarkan dari pool.');}
    catch(e){toast(e.message,true);}
  }
  function renderLatest(){
    let t=kie.selectedTask?kie.tasks.find(x=>x.id===kie.selectedTask):null;
    if(!t)t=kie.tasks[0];
    if(!t){el('kieResultState').textContent='Belum ada generasi';return;}
    el('kieResultState').textContent=badge(t.status)+' · '+t.modelName;
    const stage=el('kieImageStage'),actions=el('kieResultActions');
    const url=t.resultUrls?.[0]||null;
    if(t.status==='success'&&url){
      stage.innerHTML='<img src="'+esc(url)+'" alt="Hasil '+esc(t.modelName)+'" loading="lazy">';
      el('kieDownload').href=url;actions.classList.remove('hidden');
    }else{
      actions.classList.add('hidden');
      stage.innerHTML='<div class="kie-stage-message"><span class="kie-stage-orb"></span><strong>'+
        esc(badge(t.status))+'</strong><p>'+esc(t.error||('Task '+t.id+' · '+t.modelName))+'</p></div>';
    }
  }
  function renderHistory(){
    document.querySelectorAll('[data-kie-filter]').forEach(b=>b.classList.toggle('active',b.dataset.kieFilter===kie.filter));
    const tasks=kie.tasks.filter(t=>kie.filter==='all'||kie.filter==='process'&&active(t.status)||
      kie.filter==='success'&&t.status==='success'||kie.filter==='failed'&&t.status==='failed');
    el('kieHistoryGrid').innerHTML=tasks.length?tasks.map(t=>{
      const img=t.resultUrls?.[0];
      return '<article class="panel kie-history-card"><div class="kie-history-cover">'+(img?
        '<img loading="lazy" src="'+esc(img)+'" alt="Hasil gambar">':(t.references?.[0]?
        '<img loading="lazy" src="'+esc(t.references[0])+'" alt="Gambar referensi">':
        '<div class="kie-history-empty">◇</div>'))+'</div>'+
        '<div class="kie-history-info"><span class="kie-task-badge '+esc(t.status)+'">'+esc(badge(t.status))+'</span>'+
        '<h3>'+esc(t.modelName)+'</h3><p>'+esc(t.mode==='edit'?'Edit Image':'Create Image')+' · '+esc(t.accountName)+'</p>'+
        '<p class="kie-task-prompt">'+esc(t.prompt)+'</p>'+
        '<small>'+esc(new Date(t.createdAt).toLocaleString('id-ID'))+'</small>'+
        (t.error?'<p class="kie-error">'+esc(t.error)+'</p>':'')+
        (img?'<a class="download-btn kie-history-download" href="'+esc(img)+'" target="_blank" rel="noopener noreferrer">Preview / Download</a>':'')+
        (t.status==='success'&&t.creditsConsumed!=null?'<small>Terpakai: '+fmt(t.creditsConsumed)+' kredit</small>':'')+
        '</div></article>';
    }).join(''):'<div class="empty-state">Tidak ada generasi gambar untuk filter ini.</div>';
  }
  async function loadTasks(){
    if(kie.polling)return;kie.polling=true;
    try{const d=await api('/api/kie/tasks');kie.tasks=d.tasks||[];renderHistory();renderLatest();}
    catch(e){console.warn('kie.ai history',e.message);}
    finally{kie.polling=false;}
  }
  async function submitImage(){
    if(kie.busy)return;
    if(!el('kiePrompt').value.trim())return toast('Tulis prompt terlebih dahulu.',true);
    const files=[...el('kieRefs').files];
    if(kie.mode==='edit'&&(!files.length||files.length>2))return toast('Edit memerlukan satu atau dua gambar referensi.',true);
    if(kie.mode==='create'&&files.length)return toast('Beralih ke Edit Image untuk menggunakan gambar referensi.',true);
    const fd=new FormData();
    fd.append('mode',kie.mode);fd.append('model',el('kieModel').value);fd.append('prompt',el('kiePrompt').value);
    fd.append('aspect',el('kieAspect').value);fd.append('resolution',el('kieResolution').value);
    fd.append('accountId',el('kieAccountSelect').value||'auto');
    for(const f of files)fd.append('references',f,f.name);
    const b=el('kieGenerateBtn');kie.busy=true;b.disabled=true;
    b.querySelector('span').textContent='Mengirim ke kie.ai…';
    el('kieResultState').textContent='Mengunggah dan mengirim task…';
    try{
      const data=await api('/api/kie/generate',{method:'POST',body:fd});
      kie.selectedTask=data.task.id;toast('Task diterima kie.ai. Status dapat dipantau di Image History.');
      await loadTasks();
    }catch(e){toast(e.message,true);el('kieResultState').textContent='Pengiriman belum terkonfirmasi. Periksa Image History sebelum mencoba lagi.';}
    finally{kie.busy=false;b.disabled=false;b.querySelector('span').textContent=kie.mode==='edit'?'Edit Image':'Generate Image';}
  }
  document.querySelectorAll('[data-image-mode]').forEach(b=>b.onclick=()=>setImageMode(b.dataset.imageMode));
  document.querySelectorAll('[data-kie-filter]').forEach(b=>b.onclick=()=>{kie.filter=b.dataset.kieFilter;renderHistory();});
  el('kieModel').onchange=updateModel;
  el('kieRefs').onchange=showRefImages;
  el('kieGenerateBtn').onclick=submitImage;
  el('kieAddAccount').onclick=addAccount;
  el('kieRefreshAccounts').onclick=refreshAccounts;
  el('kieRefreshHistory').onclick=loadTasks;
  el('kieAccountList').addEventListener('click',e=>{const b=e.target.closest('[data-kie-remove]');if(b)removeAccount(b.dataset.kieRemove);});
  setInterval(()=>{if(['image-create','image-history'].includes(state.view))loadTasks();},8500);
  loadModels();loadAccounts();loadTasks();
})();
