// Nora-inspired Gallery viewer for VANTA History. Render-only: paid creation paths stay untouched.
(()=>{
  const element=id=>document.getElementById(id);
  const safeText=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeAsset=s=>{
    const source=typeof s==='string'?s.trim():'';
    if(!source)return null;
    try{const u=new URL(source,location.origin);return ['https:','http:'].includes(u.protocol)&&
      (u.origin===location.origin||u.protocol==='https:')?u.href:null;}catch{return null;}
  };
  const dateString=s=>{
    const n=Date.parse(s||'');
    return Number.isFinite(n)?new Date(n).toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Waktu belum tersedia';
  };
  const statusName=s=>({
    success:'Berhasil',failed:'Gagal',running:'Memproses',processing:'Memproses',
    generating:'Memproses',queued:'Antrean',waiting:'Antrean',check_error:'Status belum tersedia',
    unavailable:'Status belum tersedia',finalizing:'Menyiapkan hasil',waiting_output:'Menunggu hasil'
  })[s]||'Memproses';
  const PAGE_SIZE=12;
  const pages={image:1,motion:1};
  const state={image:[],motion:[],modalProvider:null,modalId:null,focus:null};
  const pageCount=p=>Math.max(1,Math.ceil(state[p].length/PAGE_SIZE));
  const visibleItems=p=>state[p].slice((pages[p]-1)*PAGE_SIZE,pages[p]*PAGE_SIZE);
  function pageNumbers(current,total){
    // Five compact slots keep mobile pagination on a single row.
    if(total<=5)return Array.from({length:total},(_,i)=>i+1);
    if(current<=3)return [1,2,3,'…',total];
    if(current>=total-2)return [1,'…',total-2,total-1,total];
    return [1,'…',current,'…',total];
  }
  function paginationHTML(p,count){
    const total=pageCount(p),page=pages[p];
    if(total<=1)return '';
    const first=(page-1)*PAGE_SIZE+1,last=Math.min(page*PAGE_SIZE,count);
    const go=(target,label,kind)=>'<button class="nora-page-btn '+kind+
      '" type="button" data-gallery-page="'+p+'" data-gallery-target="'+target+
      '" aria-label="'+label+'" '+(target===page?'disabled':'')+'>'+
      '<span class="nora-page-word">'+label+'</span>'+
      '<span class="nora-page-chevron" aria-hidden="true">'+(kind==='previous'?'‹':'›')+'</span></button>';
    const numbers=pageNumbers(page,total).map(n=>n==='…'
      ?'<span class="nora-page-ellipsis" aria-hidden="true">…</span>'
      :'<button class="nora-page-btn number'+(n===page?' active':'')+
        '" type="button" data-gallery-page="'+p+'" data-gallery-target="'+n+
        '" aria-label="Halaman '+n+'" '+(n===page?'aria-current="page" disabled':'')+'>'+n+'</button>').join('');
    return '<nav class="nora-gallery-pagination" aria-label="Navigasi halaman '+(p==='image'?'gambar':'video')+'">'+
      '<p class="nora-pagination-summary">Menampilkan '+first+'–'+last+' dari '+count+' hasil</p>'+
      '<div class="nora-pagination-controls">'+
      go(Math.max(1,page-1),'Sebelumnya','previous')+numbers+
      go(Math.min(total,page+1),'Berikutnya','next')+
      '</div><p class="nora-pagination-position">Halaman '+page+' dari '+total+'</p></nav>';
  }
  const rootOf=p=>element(p==='image'?'kieHistoryGrid':'motionGalleryGrid');
  const idOf=(p,t)=>String(p==='image'?t.id:t.taskId);
  const labelOf=(p,t)=>p==='image'?(t.modelName||'Model gambar'):(t.workflow||'Motion Control');
  const dateOf=(p,t)=>p==='image'?t.createdAt:t.startedAt;
  const completed=t=>t.status==='success'||t.status==='failed';
  const mediaOf=(p,t)=>{
    if(p==='image')return safeAsset(t.resultUrls?.[0]);
    return safeAsset(window.vantaMotionGallery?.videoUrl?.(t));
  };
  const posterOf=(p,t)=>{
    if(p==='image')return safeAsset(t.resultUrls?.[0]||t.references?.[0]);
    return safeAsset(window.vantaMotionGallery?.referenceUrl?.(t));
  };
  const detailLine=(k,v)=>'<div><dt>'+safeText(k)+'</dt><dd>'+safeText(v??'—')+'</dd></div>';
  function timeText(t){
    if(typeof window.vantaMotionGallery?.elapsed==='function'){
      const ms=window.vantaMotionGallery.elapsed(t);
      return ms==null?'':window.vantaMotionGallery.formatDuration(ms);
    }
    return '';
  }
  function tileHTML(p,t){
    const id=idOf(p,t),isDone=t.status==='success',media=isDone?mediaOf(p,t):null;
    const poster=posterOf(p,t);
    // Cards NEVER load MP4 streams. Motion previews fetch media only after the
    // user opens the viewer; at most PAGE_SIZE photo posters can load at once.
    const image=p==='image'
      ? (poster?'<img loading="lazy" decoding="async" fetchpriority="low" alt="" src="'+safeText(poster)+'">':'<span class="nora-gallery-placeholder">◇</span>')
      : (poster?'<img loading="lazy" decoding="async" fetchpriority="low" alt="" src="'+safeText(poster)+'">':
          '<span class="nora-gallery-placeholder nora-gallery-video-placeholder">▹</span>');
    const type=p==='image'?(t.mode==='edit'?'Edit Image':'Create Image'):(t.mode==='plus'?'Plus':'Standard');
    return '<article class="nora-gallery-tile">'+
      '<button class="nora-gallery-open" type="button" data-gallery-open="'+safeText(id)+'" data-gallery-provider="'+p+'" aria-label="Buka '+safeText(labelOf(p,t))+'">'+
      '<div class="nora-gallery-thumb">'+image+
      '<span class="nora-gallery-chip '+safeText(t.status)+'">'+safeText(statusName(t.status))+'</span>'+
      (p==='motion'?'<span class="nora-gallery-play" aria-hidden="true">▶</span>':'')+'</div>'+
      '<div class="nora-gallery-caption"><strong title="'+safeText(labelOf(p,t))+'">'+safeText(labelOf(p,t))+'</strong>'+
      '<span>'+safeText(type)+' · '+safeText(dateString(dateOf(p,t)))+'</span></div></button></article>';
  }
  const signatures={image:'',motion:''};
  function refreshDurations(){
    const root=rootOf('motion');if(!root)return;
    const labels=root.querySelectorAll('[data-motion-duration]');
    if(!labels.length)return;
    const visible=new Map(visibleItems('motion').map(t=>[idOf('motion',t),t]));
    for(const target of labels){
      const item=visible.get(target.dataset.motionDuration);
      if(item)target.textContent=timeText(item);
    }
  }
  function render(p,items){
    if(!Array.isArray(items))return;
    const sorted=[...items].sort((a,b)=>(Date.parse(dateOf(p,b))||0)-(Date.parse(dateOf(p,a))||0));
    state[p]=sorted;
    pages[p]=Math.min(pages[p],pageCount(p));
    const root=rootOf(p);if(!root)return;
    const visible=visibleItems(p);
    // Exclude hidden pages from the DOM, including their image/video requests.
    // Polling can refresh statuses without reloading already visible thumbnails.
    const signature=JSON.stringify([pages[p],sorted.length,...visible.map(t=>
      [idOf(p,t),t.status,labelOf(p,t),t.resultUrls?.[0]||t.resultUrl||'',
       t.references?.[0]||'',t.error||'',t.finishedAt||''])]);
    if(signatures[p]!==signature){
      signatures[p]=signature;
      root.innerHTML=sorted.length?visible.map(t=>tileHTML(p,t)).join('')+
        paginationHTML(p,sorted.length):
        '<div class="nora-gallery-empty"><span aria-hidden="true">▧</span><strong>Belum ada hasil</strong>'+
        '<p>Hasil generasi akan muncul di galeri ini.</p></div>';
      root.querySelectorAll('img').forEach(img=>{img.addEventListener('error',()=>{img.hidden=true;});});
    }
    if(state.modalProvider===p&&state.modalId&&!visible.some(t=>idOf(p,t)===state.modalId))close();
  }
  function current(){return state[state.modalProvider]?.find(t=>idOf(state.modalProvider,t)===state.modalId);}
  function getIndex(){return state.modalProvider?
    visibleItems(state.modalProvider).findIndex(t=>idOf(state.modalProvider,t)===state.modalId):-1;}
  function actions(p,t){
    const all=[];
    if(t.status==='success'&&mediaOf(p,t))all.push('<a class="nora-action primary" href="'+safeText(mediaOf(p,t))+'" target="_blank" rel="noopener noreferrer" download>Unduh</a>');
    if(p==='image'&&t.prompt){
      all.push('<button type="button" class="nora-action" data-nora-action="edit">Edit</button>');
    }
    if(p==='motion'&&t.status==='success'&&mediaOf(p,t))
      all.push('<button type="button" class="nora-action" data-nora-action="references">Lihat referensi</button>');
    if(!completed(t))
      all.push('<button type="button" class="nora-action" data-nora-action="refresh">Refresh status</button>');
    if(p==='motion'&&t.status==='unavailable')
      all.push('<button type="button" class="nora-action" data-nora-action="recover">Pulihkan akun task</button>');
    if(t.status==='failed'){
      if(p==='motion')all.push('<button type="button" class="nora-action" data-nora-action="diagnose">Periksa penyebab</button>');
      all.push('<button type="button" class="nora-action" data-nora-action="retry">Buat lagi</button>');
    }
    if(completed(t))all.push('<button type="button" class="nora-action danger" data-nora-action="delete">Hapus</button>');
    return all.join('');
  }
  function detailMeta(p,t){
    const details=[
      detailLine(p==='image'?'Model':'Workflow',labelOf(p,t)),
      detailLine('Akun',t.accountName||t.account||'—'),
      detailLine('Dibuat',dateString(dateOf(p,t))),
      detailLine(p==='image'?'Jenis':'Mode',p==='image'?(t.mode==='edit'?'Edit Image':'Create Image'):(t.mode==='plus'?'Plus':'Standard'))
    ];
    if(p==='image'&&t.creditsConsumed!=null)details.push(detailLine('Terpakai',String(t.creditsConsumed)+' kredit'));
    if(p==='motion'){details.push(detailLine('Durasi',timeText(t)||'—'));details.push(detailLine('Video',t.video||'—'));}
    return '<dl>'+details.join('')+'</dl>';
  }
  function showModal(p,id){
    const item=state[p].find(t=>idOf(p,t)===String(id));if(!item)return;
    state.modalProvider=p;state.modalId=String(id);
    state.focus=document.activeElement;
    element('noraGalleryViewer').classList.remove('hidden');
    document.body.classList.add('modal-open');
    drawModal();
    element('noraViewerClose').focus({preventScroll:true});
  }
  function drawModal(){
    const p=state.modalProvider,t=current();if(!p||!t)return;
    const idx=getIndex(),count=visibleItems(p).length,media=mediaOf(p,t),poster=posterOf(p,t);
    element('noraViewerContext').textContent=p==='image'?'KIE.AI · IMAGE GALLERY':'RUNNINGHUB · MOTION GALLERY';
    element('noraViewerTitle').textContent=labelOf(p,t);
    element('noraViewerCounter').textContent=(idx+1)+' / '+count;
    element('noraViewerPrev').disabled=count<=1;
    element('noraViewerNext').disabled=count<=1;
    const host=element('noraViewerMedia');
    const file=media||poster;
    if(file&&p==='image')host.innerHTML='<img class="nora-viewer-image" alt="Hasil gambar" src="'+safeText(file)+'">';
    else if(file&&p==='motion'&&media)host.innerHTML='<video class="nora-viewer-video" src="'+safeText(file)+'" controls playsinline preload="metadata"></video>';
    else if(file)host.innerHTML='<img class="nora-viewer-image" alt="Gambar referensi" src="'+safeText(file)+'">';
    else host.innerHTML='<div class="nora-viewer-media-empty"><span>◇</span><p>'+safeText(t.status==='failed'?'Generasi gagal':'Hasil belum tersedia')+'</p></div>';
    element('noraViewerStatus').innerHTML='<span class="nora-gallery-chip static '+safeText(t.status)+'">'+safeText(statusName(t.status))+'</span>';
    element('noraViewerMeta').innerHTML=detailMeta(p,t);
    element('noraViewerActions').innerHTML=actions(p,t);
    const hasPrompt=p==='image'&&!!t.prompt;
    element('noraViewerPromptBlock').hidden=!hasPrompt;
    element('noraViewerPrompt').textContent=hasPrompt?t.prompt:'';
    const error=t.error||t.diagnosis||t.statusDetail||'';
    element('noraViewerError').hidden=!error;
    element('noraViewerError').textContent=error;
  }
  function move(n){
    const index=getIndex(),list=state.modalProvider?visibleItems(state.modalProvider):[];if(index<0||!list.length)return;
    const next=(index+n+list.length)%list.length;
    state.modalId=idOf(state.modalProvider,list[next]);
    drawModal();
  }
  function close(){
    const modal=element('noraGalleryViewer');if(!modal||modal.classList.contains('hidden'))return;
    modal.classList.add('hidden');
    const video=element('noraViewerMedia')?.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}
    state.modalProvider=null;state.modalId=null;
    document.body.classList.remove('modal-open');
    if(state.focus?.isConnected)state.focus.focus({preventScroll:true});
  }
  async function action(kind,button){
    const provider=state.modalProvider,item=current();if(!item||!provider)return;
    const adapter=provider==='image'?window.vantaImageGallery:window.vantaMotionGallery;
    if(kind==='edit'){close();adapter?.reuse?.(item);return;}
    if(kind==='references'){close();adapter?.showReferences?.(item);return;}
    if(kind==='retry'){close();adapter?.retry?.(item);return;}
    if(kind==='refresh'){button.disabled=true;try{await adapter?.refresh?.();}finally{button.disabled=false;}return;}
    if(kind==='recover'){
      button.disabled=true;
      try{await adapter?.recover?.(item);drawModal();}
      catch(e){alert(e.message||'Akun task belum dapat ditemukan.');}
      finally{button.disabled=false;}
      return;
    }
    if(kind==='diagnose'){button.disabled=true;try{await adapter?.diagnose?.(item);drawModal();}finally{button.disabled=false;}return;}
    if(kind==='delete'){
      if(!completed(item))return;
      if(!confirm('Hapus hasil ini dari History? Tindakan ini tidak dapat dibatalkan.'))return;
      button.disabled=true;
      try{await adapter?.remove?.(item);close();}catch(e){alert(e.message||'Tidak dapat menghapus History.');button.disabled=false;}
    }
  }
  const motion=element('motionGalleryGrid'),image=element('kieHistoryGrid');
  for(const root of [motion,image]){
    root?.addEventListener('click',e=>{
      const pageButton=e.target.closest('[data-gallery-page]');
      if(pageButton){
        const provider=pageButton.dataset.galleryPage;
        if(!['image','motion'].includes(provider))return;
        const target=Number(pageButton.dataset.galleryTarget);
        if(!Number.isInteger(target)||target<1||target>pageCount(provider)||target===pages[provider])return;
        pages[provider]=target;
        render(provider,state[provider]);
        root.scrollIntoView?.({behavior:'instant',block:'start'});
        return;
      }
      const btn=e.target.closest('[data-gallery-open]');
      if(!btn)return;showModal(btn.dataset.galleryProvider,btn.dataset.galleryOpen);
    });
  }
  element('noraViewerClose')?.addEventListener('click',close);
  element('noraGalleryViewer')?.querySelector('[data-nora-close]')?.addEventListener('click',close);
  element('noraViewerPrev')?.addEventListener('click',()=>move(-1));
  element('noraViewerNext')?.addEventListener('click',()=>move(1));
  element('noraViewerCopy')?.addEventListener('click',async()=>{
    const t=current();if(!t?.prompt)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(t.prompt);
      else{const input=document.createElement('textarea');input.value=t.prompt;document.body.appendChild(input);
        input.select();document.execCommand('copy');input.remove();}
      const b=element('noraViewerCopy');b.textContent='Tersalin';setTimeout(()=>{if(b.isConnected)b.textContent='Salin prompt';},1400);
    }catch{alert('Gagal menyalin prompt.');}
  });
  element('noraViewerActions')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-nora-action]');if(b)action(b.dataset.noraAction,b);
  });
  document.addEventListener('keydown',e=>{
    if(!state.modalProvider)return;
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='ArrowRight'){e.preventDefault();move(1);}
    if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}
  });
  let touchX=null,touchY=null;
  element('noraViewerStage')?.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    touchX=e.touches[0].clientX;touchY=e.touches[0].clientY;
  },{passive:true});
  element('noraViewerStage')?.addEventListener('touchend',e=>{
    if(touchX===null||e.changedTouches.length!==1)return;
    const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;
    touchX=null;
    if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);
  },{passive:true});
  window.vantaGallery={renderImage:items=>render('image',items),renderMotion:items=>render('motion',items),
    reset:provider=>{if(!['image','motion'].includes(provider))return;
      pages[provider]=1;signatures[provider]='';},
    refreshDurations,close,open:showModal};
  window.vantaImageGallery?.redraw?.();
  window.vantaMotionGallery?.redraw?.();
})();