// This exporter runs only when the owner invokes the copied bookmarklet on
// RunningHub. No network requests and no unrelated cookies/storage exports.
function exportRunningHubSession(){
  try{
    if(!['www.runninghub.ai','runninghub.ai'].includes(location.hostname)){
      alert('Buka RunningHub dan login dahulu, lalu jalankan kode ini.');return;
    }
    const read=(store,name)=>{try{return store.getItem(name)||'';}catch{return '';}};
    const cookie=name=>{
      for(const pair of document.cookie.split(';')){
        const at=pair.indexOf('=');
        if(at>=0&&pair.slice(0,at).trim().toLowerCase()===name.toLowerCase()){
          try{return decodeURIComponent(pair.slice(at+1).trim());}catch{}
        }
      }
      return '';
    };
    const field=name=>cookie(name)||read(localStorage,name)||read(sessionStorage,name);
    const data={site:'runninghub.ai',access:field('Rh-Accesstoken'),refresh:field('Rh-Refreshtoken'),
      identify:field('Rh-Identify'),comfyAuth:field('Rh-Comfy-Auth')};
    if(!data.access){alert('Sesi belum ditemukan. Login RunningHub, buka editor, lalu coba lagi.');return;}
    document.getElementById('vanta-rh-session-export')?.remove();
    const overlay=document.createElement('div');overlay.id='vanta-rh-session-export';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0009;display:flex;align-items:center;justify-content:center;font-family:system-ui';
    const card=document.createElement('div');card.style.cssText='background:#fff;color:#111;width:90%;max-width:520px;border-radius:14px;padding:20px;box-sizing:border-box';
    const heading=document.createElement('h3');heading.textContent='Hubungkan RunningHub ke Vanta';
    const description=document.createElement('p');description.textContent='Salin sesi ini, lalu tempel di Vanta → RunningHub Pool → Sesi RunningHub.';
    const value=document.createElement('textarea');value.readOnly=true;value.value=JSON.stringify(data);
    value.style.cssText='width:100%;height:90px;box-sizing:border-box;resize:none;font:12px monospace;border:1px solid #ccc;border-radius:8px;padding:10px';
    const row=document.createElement('div');row.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const close=document.createElement('button');close.textContent='Tutup';
    const copy=document.createElement('button');copy.textContent='Salin sesi';
    close.style.cssText=copy.style.cssText='padding:10px 16px;border:1px solid #ccc;border-radius:8px;cursor:pointer';
    copy.style.background='#4f46e5';copy.style.color='#fff';
    const dismiss=()=>{value.value='';overlay.remove();};
    close.onclick=dismiss;overlay.onclick=e=>{if(e.target===overlay)dismiss();};
    copy.onclick=async()=>{
      let ok=false;
      try{await navigator.clipboard.writeText(value.value);ok=true;}
      catch{value.focus();value.select();try{ok=document.execCommand('copy');}catch{}}
      copy.textContent=ok?'Tersalin!':'Pilih teks lalu Salin';
    };
    row.append(close,copy);card.append(heading,description,value,row);overlay.append(card);document.body.append(overlay);
  }catch{alert('Sesi belum bisa disalin. Muat ulang halaman RunningHub dan coba lagi.');}
}
window.vantaRunningHubSessionCode='javascript:('+exportRunningHubSession.toString().replace(/\r?\n/g,' ')+')();';
