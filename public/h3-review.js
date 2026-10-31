(()=>{
  const $=id=>document.getElementById(id),key='vantaDeviceIdV1';
  let device=localStorage.getItem(key);
  if(!device){device=crypto.randomUUID().replaceAll('-','');localStorage.setItem(key,device);}
  const headers={'X-Vanta-Device':device};
  let active=false,controller=new AbortController();
  const show=text=>{$('status').textContent=String(text).slice(0,1200);};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function api(url,options={}){
    const r=await fetch(url,{credentials:'same-origin',signal:controller.signal,...options,
      headers:{...headers,...options.headers}});
    if(r.status===401){location.href='/login.html?next=%2Fh3-review.html';throw Error('Login VANTA diperlukan.');}
    const data=await r.json();if(!r.ok)throw Error(data.error||'Permintaan uji belum berhasil.');return data;
  }
  api('/api/session').then(data=>{
    for(const a of data.accounts||[]){const option=document.createElement('option');option.value=a.id;option.textContent=a.name;$('account').append(option);}
  }).catch(e=>show(e.message));
  $('reviewForm').addEventListener('submit',async event=>{
    event.preventDefault();if(active)return;
    const image=$('reference').files[0],video=$('source').files[0],details=$('details').value.trim();
    if(!image||!video||details.length<10)return;
    if(image.size>20*1024*1024||video.size>100*1024*1024){show('Gambar maksimal 20 MB; video maksimal 100 MB.');return;}
    active=true;$('run').disabled=true;$('result').hidden=true;$('download').hidden=true;
    let jobId='',taskId='';
    try{
      const form=new FormData();form.append('referenceImage',image);form.append('videoReference',video);
      form.append('workflow','minimaxH3Review');form.append('mode','plus');
      form.append('accountId',$('account').value);form.append('referenceDetails',details);
      show('Mengunggah satu uji non-eksplisit…');
      const created=await api('/api/generate',{method:'POST',body:form,
        headers:{'X-Vanta-Request-Id':crypto.randomUUID()}});
      if(!created.jobId)throw Error('Tidak menerima ID pengiriman. Periksa History sebelum mengirim ulang.');
      jobId=created.jobId;
      let task;
      while(!task){
        const job=await api('/api/generate/jobs/'+encodeURIComponent(created.jobId));
        show(job.message||job.stage||'Menyiapkan uji');
        if(['error','uncertain'].includes(job.stage))throw Error(job.error||'Periksa History sebelum mengirim ulang.');
        if(job.stage==='accepted'){task=job.task;break;}
        await pause(2000);
      }
      if(!task?.taskId||!task?.accountId)throw Error('Task diterima tanpa informasi pemantauan lengkap. Periksa History.');
      taskId=task.taskId;
      show('Task '+task.taskId+' diterima RunningHub. Memantau satu render uji…');
      while(true){
        const state=await api('/api/tasks/'+encodeURIComponent(task.taskId),{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:task.accountId})});
        if(state.state==='failed')throw Error(state.message||'RunningHub mengonfirmasi uji gagal.');
        if(state.state==='success'){
          const query='?accountId='+encodeURIComponent(task.accountId);
          $('result').src='/api/tasks/'+encodeURIComponent(task.taskId)+'/preview'+query;$('result').hidden=false;
          $('download').href='/api/tasks/'+encodeURIComponent(task.taskId)+'/download'+query;$('download').hidden=false;
          show('Render selesai: '+task.taskId+'. Periksa detail, gerakan, sambungan kepala dan perubahan di luar kepala. Status selesai bukan bukti kualitas lulus.');
          break;
        }
        show('Task '+task.taskId+' · '+(state.message||state.state));await pause(10000);
      }
    }catch(error){if(error.name!=='AbortError')show(error.message+
      (taskId?'\nTask '+taskId+'. Periksa History sebelum mengirim ulang.':
        jobId?'\nPengiriman '+jobId+'. Periksa History sebelum mengirim ulang.':''));}
    finally{active=false;$('run').disabled=false;}
  });
  window.addEventListener('pagehide',()=>controller.abort(),{once:true});
})();
