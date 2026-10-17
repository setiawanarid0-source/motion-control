// Short-lived, durable preflight queue for heavy video processing.
// Returns a job ID immediately after upload, before any FFmpeg / RunningHub work.
// A potentially paid RunningHub submission is never automatically retried.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const WAITING=new Set(['queued','analyzing','checking_account','preparing_motion','saving_references','uploading_inputs']);
const FINISHED=new Set(['accepted','error','uncertain']);
const LABELS={
  queued:'Menunggu persiapan media',
  analyzing:'Menganalisis video referensi',
  checking_account:'Memeriksa akun RunningHub',
  preparing_motion:'Menyiapkan gerakan 35 FPS',
  saving_references:'Menyimpan media referensi',
  uploading_inputs:'Mengunggah input ke RunningHub',
  submitting:'Mengirim task ke RunningHub',
  accepted:'Task diterima RunningHub',
  error:'Persiapan belum berhasil',
  uncertain:'Memeriksa apakah RunningHub menerima task'
};
const MAX_AGE=3*24*60*60*1000;
export function createGenerationQueue({dir,now=()=>Date.now(),maxConcurrent=1}){
  const root=path.join(dir,'generation-submissions');
  const active=new Set();
  let scheduled=false;
  let executor=null;
  function folder(id){if(!UUID.test(String(id||'')))throw Error('ID pengiriman tidak valid');return path.join(root,id);}
  function filename(id){return path.join(folder(id),'state.json');}
  function read(id){try{
    const data=JSON.parse(fs.readFileSync(filename(id),'utf8'));
    return data&&data.jobId===id?data:null;
  }catch{return null;}}
  function save(data){
    fs.mkdirSync(folder(data.jobId),{recursive:true,mode:0o700});
    const dest=filename(data.jobId),tmp=dest+'.tmp-'+process.pid;
    try{
      fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});
      fs.renameSync(tmp,dest);
    }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  }
  function update(id,patch){
    const current=read(id);if(!current)throw Error('Pengiriman tidak ditemukan');
    if(FINISHED.has(current.stage)&&patch.stage!==current.stage)return current;
    const next={...current,...patch,updatedAt:new Date(now()).toISOString()};
    save(next);return next;
  }
  function view(x){
    return {jobId:x.jobId,stage:x.stage,message:x.message||LABELS[x.stage]||'Menyiapkan',
      createdAt:x.createdAt,updatedAt:x.updatedAt,
      task:x.stage==='accepted'?x.task||null:null,error:x.error||null};
  }
  function owned(id,deviceId){
    const x=read(id);
    return x&&x.deviceId===deviceId?view(x):null;
  }
  function enumerate(){
    try{return fs.readdirSync(root).filter(x=>UUID.test(x)).map(x=>read(x)).filter(Boolean);}
    catch{return[];}
  }
  function latest(deviceId){
    return enumerate().filter(x=>x.deviceId===deviceId)
      .sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0))
      .slice(0,12).map(view);
  }
  async function stage({jobId,deviceId,body,image,video}){
    folder(jobId);
    if(!deviceId||!image?.path||!video?.path)throw Error('Kedua referensi wajib diunggah');
    const old=read(jobId);
    if(old){
      if(old.deviceId!==deviceId)throw Error('Pengiriman tidak ditemukan');
      return view(old); // idempotent retry never starts a second paid task
    }
    const dest=folder(jobId);
    try{
      await fs.promises.mkdir(dest,{recursive:true,mode:0o700});
      const imageDest=path.join(dest,'reference.bin'),videoDest=path.join(dest,'driving.bin');
      await fs.promises.copyFile(image.path,imageDest);
      await fs.promises.copyFile(video.path,videoDest);
      const createdAt=new Date(now()).toISOString();
      const data={jobId,deviceId,createdAt,updatedAt:createdAt,stage:'queued',
        message:LABELS.queued,body:{
          workflow:String(body.workflow||'r15'),
          mode:String(body.mode||'lite'),
          accountId:String(body.accountId||'auto'),
          diagnosticTaskId:String(body.diagnosticTaskId||''),
          diagnosticAccountId:String(body.diagnosticAccountId||'')
        },image:{path:imageDest,originalname:String(image.originalname||'reference.jpg'),
          mimetype:image.mimetype,size:image.size},
        video:{path:videoDest,originalname:String(video.originalname||'driving.mp4'),
          mimetype:video.mimetype,size:video.size}};
      save(data);
      schedule();
      return view(data);
    }catch(error){
      await fs.promises.rm(dest,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
  function schedule(){
    if(scheduled||!executor)return;
    scheduled=true;
    setImmediate(async()=>{
      scheduled=false;
      if(active.size>=maxConcurrent)return;
      const next=enumerate().filter(x=>x.stage==='queued'&&!active.has(x.jobId))
        .sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0];
      if(!next)return;
      active.add(next.jobId);
      const report=(stage,message)=>{
        if(!LABELS[stage])throw Error('Unknown generation state '+stage);
        update(next.jobId,{stage,message:message||LABELS[stage]});
      };
      try{
        await executor(read(next.jobId),report);
      }catch(error){
        console.error('Preflight background processing failed',next.jobId,String(error.message||error).slice(0,200));
        const last=read(next.jobId);
        update(next.jobId,{stage:last?.stage==='submitting'?'uncertain':'error',
          error:last?.stage==='submitting'?
            'Status penerimaan task belum bisa dipastikan. Periksa History sebelum mencoba lagi.':
            'Persiapan video terhenti. Kredit belum digunakan untuk tahap ini.'});
      }finally{
        active.delete(next.jobId);
        const last=read(next.jobId);
        if(last&&FINISHED.has(last.stage)){
          for(const file of [last.image?.path,last.video?.path]){
            if(file)fs.promises.rm(file,{force:true}).catch(()=>{});
          }
        }
        schedule();
      }
    });
  }
  function setExecutor(fn){executor=fn;schedule();}
  function resume(){
    for(const data of enumerate()){
      if(WAITING.has(data.stage))update(data.jobId,{stage:'queued',message:'Melanjutkan persiapan media'});
      else if(data.stage==='submitting')update(data.jobId,{stage:'uncertain',
        error:'Koneksi terputus ketika task dikirim. Periksa History sebelum mencoba lagi.'});
    }
    schedule();
  }
  function purge(){
    for(const data of enumerate()){
      if(active.has(data.jobId)||!FINISHED.has(data.stage))continue;
      if(now()-Date.parse(data.updatedAt||data.createdAt)>MAX_AGE)
        fs.rmSync(folder(data.jobId),{recursive:true,force:true});
    }
  }
  return {stage,read,update,view,owned,latest,setExecutor,resume,purge,LABELS};
}
