// The kie.ai image surface is independent of the RunningHub UI/state.
(()=>{
  const kie={mode:'create',models:[],accounts:[],tasks:[],filter:'all',selectedTask:null,polling:false,busy:false,accountPolling:false,lastAccountsSync:0};
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
  function updateProviderIndicator(){
    const kiePage=['image-create','image-history','kie-accounts'].includes(state.view);
    const count=kiePage?kie.accounts.filter(a=>a.state==='ready'&&Number(a.credits)>0).length:
      state.accounts.filter(a=>a.canGenerate===true).length;
    const title=document.querySelector('.balance-pill span'),unit=el('poolReadyUnit');
    if(title)title.textContent=kiePage?'kie.ai ready':'Pool ready';
    if(unit)unit.textContent=kiePage?'akun kie.ai':'akun siap';
    el('poolCredits').textContent=String(count);
    if(kiePage){
      el('poolCount').textContent=count+' akun kie.ai siap';
      document.querySelector('.sidebar-foot small').textContent='kie.ai pool';
      el('poolDot').classList.toggle('ready',count>0);
    }else{
      el('poolCount').textContent=count+' akun siap';
      document.querySelector('.sidebar-foot small').textContent='RunningHub pool';
      el('poolDot').classList.toggle('ready',count>0);
    }
  }
  window.vantaKieNavigation=view=>{
    updateProviderIndicator();
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
    // Keep selected Edit references when switching tabs. Create never submits them.
    // The input is a picker only: retained files live in selectedRefs.
    el('kieRefs').value='';
    el('kiePrompt').placeholder=mode==='edit'?'Jelaskan perubahan yang diinginkan pada gambar referensi…':
      'Deskripsikan gambar yang ingin dibuat…';
    el('kieGenerateBtn').querySelector('span').textContent=mode==='edit'?'Edit Image':'Generate Image';
    updateModel();
  }
  function updateModel(){
    const m=model();if(!m)return;
    el('kieAspectField').classList.toggle('hidden',!m.aspect);
    if(m.aspectRatios?.length){
      // Grok 2.0 only accepts these 5 ratios; other models retain the
      // original complete selector. Preserve the prior choice when valid.
      const picker=el('kieAspect'),oldRatio=picker.value;
      picker.innerHTML=m.aspectRatios.map(r=>'<option value="'+esc(r)+'">'+esc(r)+'</option>').join('');
      picker.value=m.aspectRatios.includes(oldRatio)?oldRatio:'1:1';
    }else{
      const picker=el('kieAspect'),oldRatio=picker.value;
      const allRatios=['1:1','9:16','16:9','3:2','2:3','4:3','3:4','21:9','auto'];
      picker.innerHTML=allRatios.map(r=>'<option value="'+esc(r)+'">'+esc(r)+'</option>').join('');
      picker.value=allRatios.includes(oldRatio)?oldRatio:'1:1';
    }
    el('kieResolutionField').classList.toggle('hidden',!m.resolution);
    el('kieResolutionLabel').textContent=m.resolution==='quality'?'KUALITAS':'RESOLUSI';
    const prev=el('kieResolution').value;
    el('kieResolution').innerHTML=(m.resolutions||[]).map(x=>
      '<option value="'+esc(x)+'">'+esc(x==='basic'?'Basic':x==='high'?'High':x)+'</option>').join('');
    if(m.resolutions?.includes(prev))el('kieResolution').value=prev;
    el('kieModelHint').textContent=m.id==='wan'?'WAN 2.7 Pro mengatur aspect ratio otomatis. Biaya bergantung model dan resolusi.':
      'Parameter hanya ditampilkan bila didukung model. Kredit dipotong langsung oleh kie.ai.';
  }
  // Native FileList is replaced every time mobile/desktop file pickers reopen.
  // Keep each selected File independently so incremental picks never overwrite.
  let selectedRefs=[];
  const maxRefs=2;
  const allowedRefTypes=new Set(['image/png','image/jpeg','image/webp']);
  function showRefImages(){
    const root=el('kieRefsPreview');
    el('kieRefsCount').textContent=selectedRefs.length+' / '+maxRefs+' gambar';
    el('kieRefsDrop').classList.toggle('hidden',selectedRefs.length===maxRefs);
    root.innerHTML=selectedRefs.map((ref,index)=>
      '<figure class="kie-ref-thumbnail"><img src="'+ref.url+'" alt="Referensi '+(index+1)+': '+esc(ref.file.name)+'">'+
      '<figcaption><span class="kie-ref-number">Gambar '+(index+1)+'</span><span class="kie-ref-name" title="'+esc(ref.file.name)+'">'+esc(ref.file.name)+'</span></figcaption>'+
      '<button class="kie-ref-remove" type="button" data-kie-ref-remove="'+index+'" aria-label="Hapus gambar '+(index+1)+'" title="Hapus gambar">'+
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'+
      '</button></figure>').join('');
  }
  function addSelectedRefs(){
    const picker=el('kieRefs');
    const files=[...picker.files];
    // Reset the chooser, not the selected images. This also allows picking the
    // same file again after it has been removed, including on mobile browsers.
    picker.value='';
    if(kie.busy)return;
    if(!files.length)return;
    if(files.length>2||selectedRefs.length+files.length>maxRefs){
      toast('Maksimal dua gambar. Hapus salah satu referensi sebelum menambah lagi.',true);
      return;
    }
    if(files.some(f=>!allowedRefTypes.has(f.type)||f.size>10*1024*1024||!f.size)){
      toast('Gunakan JPG, PNG, atau WEBP, maksimal 10 MB per gambar.',true);
      return;
    }
    const duplicates=files.some((f,i)=>selectedRefs.some(x=>x.file.name===f.name&&x.file.size===f.size&&x.file.lastModified===f.lastModified)||
      files.slice(0,i).some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified));
    if(duplicates){
      toast('Gambar tersebut sudah dipilih. Hapus dahulu jika ingin menggantinya.',true);
      return;
    }
    for(const file of files)selectedRefs.push({file,url:URL.createObjectURL(file)});
    showRefImages();
  }
  function removeSelectedRef(index){
    if(kie.busy||!Number.isInteger(index)||index<0||index>=selectedRefs.length)return;
    const [removed]=selectedRefs.splice(index,1);
    URL.revokeObjectURL(removed.url);
    showRefImages();
  }
  function accountDisplayName(a){
    // Distinguish legacy accounts with the same display name without
    // renaming API keys, account IDs or historical task ownership.
    const duplicates=kie.accounts.filter(x=>x.name===a.name).length;
    return duplicates>1?a.name+' · '+String(a.id).slice(0,6):a.name;
  }
  function drawAccounts(){
    const select=el('kieAccountSelect'),current=select.value;
    select.innerHTML='<option value="auto">Automatic · akun dengan kredit tersedia</option>'+
      kie.accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(accountDisplayName(a))+' · '+(a.credits==null?'saldo —':fmt(a.credits)+' kredit')+'</option>').join('');
    if([...select.options].some(o=>o.value===current))select.value=current;
    updateProviderIndicator();
    const list=el('kieAccountList');
    list.innerHTML=kie.accounts.length?kie.accounts.map(a=>
      '<article class="account-card"><div class="account-card-main"><div class="account-icon">K</div><div><strong>'+esc(accountDisplayName(a))+
      '</strong><small>'+(a.state==='unavailable'?'Status belum tersedia':Number(a.credits)>0?'Siap digunakan':'Kredit habis')+
      '</small></div></div><div class="account-metrics"><span>'+esc(a.credits==null?'—':fmt(a.credits))+' kredit</span><span>kie.ai</span></div>'+
      '<button class="delete-account" type="button" data-kie-remove="'+esc(a.id)+'">Remove</button></article>').join(''):
      '<div class="empty-state">Belum ada akun kie.ai.<br>Tambahkan satu API key melalui panel kiri.</div>';
  }
  async function loadAccounts(){
    if(kie.accountPolling)return;
    kie.accountPolling=true;
    try{
      const d=await api('/api/kie/accounts');
      kie.accounts=d.accounts||[];
      kie.lastAccountsSync=Date.now();
      drawAccounts();
    }catch(e){
      console.warn('kie.ai account sync',e.message);
      // Never present stale balances as current after a failed refresh request.
      kie.accounts=kie.accounts.map(a=>({...a,credits:null,state:'unavailable'}));
      drawAccounts();
    }
    finally{kie.accountPolling=false;}
  }
  async function refreshAccounts(){
    const b=el('kieRefreshAccounts');b.disabled=true;
    try{const d=await api('/api/kie/accounts/refresh',{method:'POST',body:'{}'});kie.accounts=d.accounts||[];kie.lastAccountsSync=Date.now();drawAccounts();toast('Saldo terbaru diperiksa langsung ke kie.ai.');}
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
    document.querySelectorAll('[data-kie-filter]').forEach(b=>
      b.classList.toggle('active',b.dataset.kieFilter===kie.filter));
    const tasks=kie.tasks.filter(t=>kie.filter==='all'||
      kie.filter==='process'&&active(t.status)||
      kie.filter==='success'&&t.status==='success'||
      kie.filter==='failed'&&t.status==='failed');
    if(window.vantaGallery)window.vantaGallery.renderImage(tasks);
    else el('kieHistoryGrid').innerHTML='<div class="nora-gallery-empty"><strong>Memuat galeri…</strong></div>';
  }
  window.vantaImageGallery={
    redraw:renderHistory,
    refresh:loadTasks,
    async reuse(task){
      await loadModels();
      switchView('image-create');
      setImageMode(task.mode==='edit'?'edit':'create');
      if(kie.models.some(m=>m.id===task.model))el('kieModel').value=task.model;
      updateModel();
      el('kiePrompt').value=task.prompt||'';
      // History cannot silently send a previous reference again: require
      // deliberate review and fresh uploads before creating a new paid task.
      for(const ref of selectedRefs)URL.revokeObjectURL(ref.url);
      selectedRefs=[];el('kieRefs').value='';showRefImages();
      if(task.mode==='edit')toast('Prompt disalin. Pilih kembali maksimal dua gambar referensi sebelum generate.');
      else toast('Prompt dan model dipulihkan. Periksa sebelum generate.');
      el('kiePrompt').focus();
    },
    retry(task){return window.vantaImageGallery.reuse(task);},
    async remove(task){
      if(!['success','failed'].includes(task.status))throw Error('Task masih berjalan.');
      await api('/api/kie/tasks/'+encodeURIComponent(task.id),{method:'DELETE'});
      if(kie.selectedTask===task.id)kie.selectedTask=null;
      kie.tasks=kie.tasks.filter(x=>x.id!==task.id);
      renderHistory();renderLatest();
      toast('Hasil dihapus dari Image History.');
    }
  };
  async function loadTasks(){
    if(kie.polling)return;kie.polling=true;
    try{
      const oldStatuses=new Map(kie.tasks.map(t=>[t.id,t.status]));
      const d=await api('/api/kie/tasks');
      kie.tasks=d.tasks||[];
      renderHistory();renderLatest();
      // Actual credits are fetched by the backend; these calls only refresh
      // the displayed balances, never infer/subtract model costs.
      const becameTerminal=kie.tasks.some(t=>['success','failed'].includes(t.status)
        &&oldStatuses.has(t.id)&&!['success','failed'].includes(oldStatuses.get(t.id)));
      if(becameTerminal||Date.now()-kie.lastAccountsSync>25000)void loadAccounts();
    }catch(e){console.warn('kie.ai history',e.message);}
    finally{kie.polling=false;}
  }
  async function submitImage(){
    if(kie.busy)return;
    if(!el('kiePrompt').value.trim())return toast('Tulis prompt terlebih dahulu.',true);
    const files=kie.mode==='edit'?selectedRefs.map(ref=>ref.file):[];
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
      void loadAccounts();
    }catch(e){toast(e.message,true);el('kieResultState').textContent='Pengiriman belum terkonfirmasi. Periksa Image History sebelum mencoba lagi.';}
    finally{kie.busy=false;b.disabled=false;b.querySelector('span').textContent=kie.mode==='edit'?'Edit Image':'Generate Image';}
  }
  document.querySelectorAll('[data-image-mode]').forEach(b=>b.onclick=()=>setImageMode(b.dataset.imageMode));
  document.querySelectorAll('[data-kie-filter]').forEach(b=>b.onclick=()=>{kie.filter=b.dataset.kieFilter;window.vantaGallery?.reset('image');renderHistory();});
  el('kieModel').onchange=updateModel;
  el('kieRefs').onchange=addSelectedRefs;
  el('kieRefsPreview').addEventListener('click',e=>{
    const remove=e.target.closest('[data-kie-ref-remove]');
    if(remove)removeSelectedRef(Number(remove.dataset.kieRefRemove));
  });
  window.addEventListener('pagehide',()=>{
    for(const ref of selectedRefs)URL.revokeObjectURL(ref.url);
    selectedRefs=[];
  });
  el('kieGenerateBtn').onclick=submitImage;
  el('kieAddAccount').onclick=addAccount;
  el('kieRefreshAccounts').onclick=refreshAccounts;
  el('kieRefreshHistory').onclick=loadTasks;
  el('kieAccountList').addEventListener('click',e=>{const b=e.target.closest('[data-kie-remove]');if(b)removeAccount(b.dataset.kieRemove);});
  setInterval(()=>{if(['image-create','image-history'].includes(state.view))loadTasks();},8500);
  loadModels();loadAccounts();loadTasks();
})();
