// Self-contained bookmarklet: ES5 syntax, no requests, only the four RH fields.
function exportRunningHubSession(){
  var payload='',data=null,active=true;
  try{
    if(!/^(www\.)?runninghub\.ai$/i.test(location.hostname)){
      alert('Buka RunningHub dan login dahulu, lalu jalankan kode ini.');return;
    }
    function read(kind,name){
      try{var store=window[kind];return store?store.getItem(name)||'':'';}catch(e){return '';}
    }
    function cookie(name){
      var pairs;
      try{pairs=document.cookie.split(';');}catch(e){return '';}
      for(var i=0;i<pairs.length;i++){
        var pair=pairs[i],at=pair.indexOf('=');
        if(at>=0&&pair.slice(0,at).trim().toLowerCase()===name.toLowerCase()){
          try{return decodeURIComponent(pair.slice(at+1).trim());}catch(e){}
        }
      }
      return '';
    }
    function field(name){return cookie(name)||read('localStorage',name)||read('sessionStorage',name);}
    data={site:'runninghub.ai',access:field('Rh-Accesstoken'),
      refresh:read('localStorage','Rh-Refreshtoken')||read('sessionStorage','Rh-Refreshtoken')||cookie('Rh-Refreshtoken'),
      identify:field('Rh-Identify'),comfyAuth:field('Rh-Comfy-Auth')};
    if(!data.access){alert('Sesi belum ditemukan. Login RunningHub di browser ini, lalu coba lagi.');return;}
    payload=JSON.stringify(data);
    var old=document.getElementById('vanta-rh-session-export');
    if(old&&old.parentNode){
      var closer=old.querySelector('[data-vanta-close]');if(closer)closer.click();
      var previous=old.querySelector('textarea');if(previous)previous.value='';
      if(old.parentNode)old.parentNode.removeChild(old);
    }
    function node(tag,text){var el=document.createElement(tag);if(text)el.textContent=text;return el;}
    var overlay=node('div');overlay.id='vanta-rh-session-export';
    overlay.style.cssText='position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:system-ui,sans-serif';
    var card=node('div');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Hubungkan RunningHub ke Vanta');
    card.style.cssText='background:#fff;color:#111;width:100%;max-width:520px;max-height:90vh;overflow:auto;border-radius:14px;padding:20px;box-sizing:border-box;text-align:left';
    var heading=node('h3','Hubungkan RunningHub ke Vanta');heading.style.cssText='margin:0 0 12px;font-size:20px;color:#111';
    var description=node('p','Salin data sesi ini, lalu tempel di Vanta → RunningHub Pool → Access token.');
    description.style.cssText='font-size:14px;line-height:1.5;color:#333';
    var value=node('textarea');value.readOnly=true;value.value=payload;value.setAttribute('aria-label','Data sesi RunningHub');value.setAttribute('spellcheck','false');value.setAttribute('autocapitalize','off');
    value.style.cssText='width:100%;height:120px;box-sizing:border-box;resize:vertical;font:16px monospace;border:1px solid #aaa;border-radius:8px;padding:10px;background:#fff;color:#111';
    var status=node('p','Jika tombol salin tidak diizinkan, pilih semua lalu tekan dan tahan teks untuk menyalinnya.');
    status.setAttribute('role','status');status.style.cssText='font-size:13px;line-height:1.5;color:#333';
    var row=node('div');row.style.cssText='display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:12px';
    var close=node('button','Tutup'),select=node('button','Pilih semua'),copy=node('button','Salin token');
    close.setAttribute('data-vanta-close','true');
    var buttons=[close,select,copy];
    for(var b=0;b<buttons.length;b++){
      buttons[b].type='button';buttons[b].style.cssText='min-height:44px;padding:10px 12px;border:1px solid #aaa;border-radius:8px;font:14px system-ui,sans-serif;background:#fff;color:#111;cursor:pointer';
    }
    copy.style.background='#4f46e5';copy.style.color='#fff';
    function selectText(){
      try{value.focus();value.select();value.setSelectionRange(0,value.value.length);}catch(e){}
    }
    function dismiss(){active=false;value.value='';payload='';data=null;if(overlay.parentNode)overlay.parentNode.removeChild(overlay);}
    function copied(){if(!active)return;copy.textContent='Tersalin!';status.textContent='Token tersalin. Tempel di Vanta.';}
    function fallback(){
      if(!active)return;
      copy.textContent='Salin token';
      selectText();var ok=false;
      try{ok=document.execCommand('copy');}catch(e){}
      if(ok)copied();else status.textContent='Tekan dan tahan teks, lalu pilih Salin.';
    }
    close.onclick=dismiss;select.onclick=selectText;
    overlay.onclick=function(e){if(e.target===overlay)dismiss();};
    overlay.onkeydown=function(e){if(e.key==='Escape'||e.keyCode===27)dismiss();};
    copy.onclick=function(){
      try{
        var clipboard=navigator.clipboard;
        if(clipboard&&typeof clipboard.writeText==='function'){
          var result=clipboard.writeText(payload);
          if(result&&typeof result.then==='function'){result.then(copied,fallback);return;}
          copied();return;
        }
      }catch(e){}
      fallback();
    };
    row.appendChild(close);row.appendChild(select);row.appendChild(copy);
    card.appendChild(heading);card.appendChild(description);card.appendChild(value);card.appendChild(status);card.appendChild(row);
    overlay.appendChild(card);(document.body||document.documentElement).appendChild(overlay);
  }catch(e){
    if(payload&&typeof prompt==='function'){prompt('Salin data sesi ini, lalu tempel di Vanta:',payload);return;}
    alert('Popup belum bisa dibuka. Muat ulang RunningHub dan coba lagi.');
  }
}
// Encode URL delimiters so the complete script survives bookmark URL storage.
window.vantaRunningHubSessionCode='javascript:'+encodeURIComponent('void ('+exportRunningHubSession.toString().replace(/\r?\n\s*/g,' ')+')();');
window.vantaRunningHubBookmarkTestCode="javascript:void(alert('VANTA bookmark berjalan'))";
async function copyRunningHubBookmarkCode(fieldId,code){
  var field=document.getElementById(fieldId),help=document.getElementById('rhSessionBrowserHelp');
  if(!field||!code)return false;
  field.value=code;
  try{await navigator.clipboard.writeText(code);return true;}catch(e){}
  if(help)help.open=true;
  try{field.focus();field.select();field.setSelectionRange(0,code.length);}catch(e){}
  try{return document.execCommand('copy');}catch(e){return false;}
}
window.vantaCopyRunningHubCode=function(){return copyRunningHubBookmarkCode('rhSessionCodeManual',window.vantaRunningHubSessionCode);};
window.vantaCopyRunningHubBookmarkTest=function(){return copyRunningHubBookmarkCode('rhBookmarkTestCode',window.vantaRunningHubBookmarkTestCode);};
window.vantaSelectRunningHubCode=function(){
  var field=document.getElementById('rhSessionCodeManual');if(!field)return;
  field.value=window.vantaRunningHubSessionCode;
  try{field.focus();field.select();field.setSelectionRange(0,field.value.length);}catch(e){}
};
