// Short-lived, durable preflight queue for heavy video processing.
// Returns a job ID immediately after upload, before any FFmpeg / RunningHub work.
// A potentially paid RunningHub submission is never automatically retried.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {PRIVATE_MEDIA_RETENTION,privateMediaKey,privateMediaOwner} from './private-media-bucket.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const WAITING=new Set(['queued','analyzing','checking_account','preparing_motion','saving_references','uploading_inputs','preparing_models']);
const FINISHED=new Set(['accepted','error','uncertain']);
const MODEL_PHASES=new Set(['checking_cache','downloading','verifying','uploading','waiting_confirmation','ready']);
function safeSubmissionAccount(value){
  if(!value||!UUID.test(String(value.id||''))||!['standard','plus','lite'].includes(value.mode))return null;
  return {id:value.id,name:/^Account \d{2,4}$/.test(String(value.name||''))?value.name:'Akun RunningHub',mode:value.mode};
}
function safeModelPreparation(value){
  if(!value||!MODEL_PHASES.has(value.phase)||!['character','accelerator','all'].includes(value.component))return null;
  const result={phase:value.phase,component:value.component};
  if(Number.isSafeInteger(value.loaded)&&value.loaded>=0&&Number.isSafeInteger(value.total)&&value.total>0)
    Object.assign(result,{loaded:Math.min(value.loaded,value.total),total:value.total});
  return result;
}
const LABELS={
  queued:'Menunggu persiapan media',
  analyzing:'Menganalisis video referensi',
  checking_account:'Memeriksa akun RunningHub',
  preparing_motion:'Menyiapkan gerakan 35 FPS',
  saving_references:'Menyimpan media referensi',
  uploading_inputs:'Mengunggah input ke RunningHub',
  preparing_models:'Menyiapkan model Akatz',
  submitting:'Mengirim task ke RunningHub',
  accepted:'Task diterima RunningHub',
  error:'Persiapan belum berhasil',
  uncertain:'Memeriksa apakah RunningHub menerima task'
};
const MAX_AGE=3*24*60*60*1000;
export function createGenerationQueue({dir,now=()=>Date.now(),maxConcurrent=1,mediaStore=null,startPaused=false}){
  const root=path.join(dir,'generation-submissions');
  const active=new Set();
  let scheduled=false;
  let executor=null;
  let paused=startPaused;
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
    const modelPreparation=x.stage==='preparing_models'?safeModelPreparation(x.modelPreparation):null;
    const submissionAccount=safeSubmissionAccount(x.submissionAccount);
    return {jobId:x.jobId,stage:x.stage,message:x.message||LABELS[x.stage]||'Menyiapkan',
      createdAt:x.createdAt,updatedAt:x.updatedAt,
      workflow:x.body?.workflow||null,failureStage:x.failureStage||null,
      task:x.stage==='accepted'?x.task||null:null,error:x.error||null,
      ...(['RUNNINGHUB_PAID_BALANCE_REQUIRED','RH_WEB_WORKSPACE_NOT_FOUND'].includes(x.failureCode)?{failureCode:x.failureCode}:{}),
      ...(submissionAccount?{submissionAccount}:{}),
      ...(modelPreparation?{modelPreparation}:{})};
  }
  function owned(id,deviceId){
    if(!UUID.test(String(id||'')))return null;
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
  async function releaseMedia(job,{includeRemote=true}={}){
    let bytes=0,files=0,complete=true;
    for(const [kind,file]of [['image',job.image],['video',job.video]]){
      const expected=path.join(folder(job.jobId),kind==='image'?'reference.bin':'driving.bin');
      if(file?.path===expected||(file?.object&&privateMediaOwner(file.object.key,'queue',job.jobId))){
        try{const info=await fs.promises.stat(expected);await fs.promises.rm(expected,{force:true});bytes+=info.size;files++;}
        catch(e){if(e.code!=='ENOENT')complete=false;}
      }
      if(includeRemote&&file?.object&&mediaStore?.ready&&privateMediaOwner(file.object.key,'queue',job.jobId))
        try{await mediaStore.remove(file.object.key);}catch{complete=false;}
    }
    return {bytes,files,complete};
  }
  async function cleanupFinished({includeSubmitting=false}={}){
    let freedBytes=0,removedFiles=0;
    for(const job of enumerate()){
      if(job.mediaReleased||(!FINISHED.has(job.stage)&&!(includeSubmitting&&job.stage==='submitting')))continue;
      const r=await releaseMedia(job);freedBytes+=r.bytes;removedFiles+=r.files;
      if(r.complete){const current=read(job.jobId);if(current)try{save({...current,mediaReleased:true});}catch{}}
    }return {freedBytes,removedFiles};
  }
  async function storeInput(jobId,file,kind,expiresAt){
    if(!file)return null;
    const {path:sourcePath,...metadata}=file;
    const object=await mediaStore.putFile(privateMediaKey('queue',jobId,expiresAt,kind==='image'?'reference.bin':'driving.bin'),sourcePath,file.mimetype);
    return {...metadata,object};
  }
  async function recoverMedia(){
    const released=await cleanupFinished({includeSubmitting:true});let migratedJobs=0,deferred=0;
    for(const id of await fs.promises.readdir(root).catch(()=>[])){
      if(!UUID.test(id)||active.has(id)||read(id))continue;
      const dest=folder(id),info=await fs.promises.lstat(dest);
      if(!info.isDirectory()||now()-info.mtimeMs<(fs.existsSync(filename(id))?MAX_AGE:4*60*60*1000))continue;
      // Incomplete, never-acknowledged uploads have no recoverable state. Only
      // remove our raw input names; unrelated files and symlinks stay intact.
      const r=await releaseMedia({jobId:id,image:{path:path.join(dest,'reference.bin')},video:{path:path.join(dest,'driving.bin')}});
      released.freedBytes+=r.bytes;released.removedFiles+=r.files;
      await fs.promises.rmdir(dest).catch(()=>{});
    }
    if(mediaStore?.ready)for(const job of enumerate()){
      if(!WAITING.has(job.stage)||active.has(job.jobId)||!job.video?.path)continue;
      const patch={},receipts=[];
      try{
        const expiresAt=Date.parse(job.createdAt)+PRIVATE_MEDIA_RETENTION;
        for(const kind of ['image','video'])if(job[kind]?.path){patch[kind]=await storeInput(job.jobId,job[kind],kind,expiresAt);receipts.push(patch[kind].object);}
        update(job.jobId,patch);const r=await releaseMedia(job,{includeRemote:false});released.freedBytes+=r.bytes;released.removedFiles+=r.files;migratedJobs++;
      }catch{deferred++;await Promise.allSettled(receipts.map(x=>mediaStore.remove(x.key)));}
    }
    return {...released,migratedJobs,deferred};
  }
  async function materialize(job){
    if(!job.image?.object&&!job.video?.object)return {job,release:async()=>{}};
    if(!mediaStore?.ready)throw Error('Penyimpanan media belum tersedia. Task belum dikirim.');
    const temp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vanta-generation-input-'));
    const release=()=>fs.promises.rm(temp,{recursive:true,force:true});
    try{
      const prepared={...job};
      for(const kind of ['image','video'])if(job[kind]?.object){
        if(!privateMediaOwner(job[kind].object.key,'queue',job.jobId))throw Error('Invalid queued media owner');
        const file=path.join(temp,kind==='image'?'reference.bin':'driving.bin');
        await mediaStore.download(job[kind].object,file);prepared[kind]={...job[kind],path:file};
      }return {job:prepared,release};
    }catch(e){await release();throw e;}
  }
  async function stage({jobId,deviceId,body,image,video}){
    folder(jobId);
    const videoOnly=String(body?.workflow||'motionflyHD')==='rife60';
    if(!deviceId||!video?.path||(!videoOnly&&!image?.path))throw Error('Media yang diperlukan belum lengkap');
    const old=read(jobId);
    if(old){
      if(old.deviceId!==deviceId)throw Error('Pengiriman tidak ditemukan');
      return view(old); // idempotent retry never starts a second paid task
    }
    const dest=folder(jobId);
    if(fs.existsSync(dest))throw Error('Penyimpanan pengiriman sebelumnya tidak lengkap; tidak aman mengulang otomatis');
    let created=false;const receipts=[];
    try{
      await cleanupFinished();await fs.promises.mkdir(root,{recursive:true,mode:0o700});
      await fs.promises.mkdir(dest,{mode:0o700});created=true;
      const imageDest=path.join(dest,'reference.bin'),videoDest=path.join(dest,'driving.bin');
      let storedImage,storedVideo;
      if(mediaStore?.ready){
        const expiresAt=now()+PRIVATE_MEDIA_RETENTION;
        storedImage=await storeInput(jobId,image,'image',expiresAt);if(storedImage)receipts.push(storedImage.object);
        storedVideo=await storeInput(jobId,video,'video',expiresAt);receipts.push(storedVideo.object);
      }else{
        if(image?.path)await fs.promises.copyFile(image.path,imageDest);
        await fs.promises.copyFile(video.path,videoDest);
      }
      const createdAt=new Date(now()).toISOString();
      const data={jobId,deviceId,createdAt,updatedAt:createdAt,stage:'queued',
        message:LABELS.queued,body:{
          workflow:String(body.workflow||'motionflyHD'),
          mode:String(body.mode||'standard'),
          accountId:String(body.accountId||'auto'),
          ...(body.akatzExpression==null?{}:{akatzExpression:String(body.akatzExpression)}),
          ...(body.akatzFaceControl==null?{}:{akatzFaceControl:String(body.akatzFaceControl)})
        },image:storedImage||(image?.path?{path:imageDest,originalname:String(image.originalname||'reference.jpg'),
          mimetype:image.mimetype,size:image.size}:null),
        video:storedVideo||{path:videoDest,originalname:String(video.originalname||'driving.mp4'),
          mimetype:video.mimetype,size:video.size}};
      save(data);
      schedule();
      return view(data);
    }catch(error){
      if(created)await fs.promises.rm(dest,{recursive:true,force:true}).catch(()=>{});
      if(mediaStore?.ready)await Promise.allSettled(receipts.map(x=>mediaStore.remove(x.key)));
      throw error;
    }
  }
  function schedule(){
    if(paused||scheduled||!executor)return;
    scheduled=true;
    setImmediate(async()=>{
      scheduled=false;
      if(active.size>=maxConcurrent)return;
      const next=enumerate().filter(x=>x.stage==='queued'&&!active.has(x.jobId))
        .sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0];
      if(!next)return;
      active.add(next.jobId);
      const report=(stage,message,details)=>{
        if(!LABELS[stage])throw Error('Unknown generation state '+stage);
        const modelPreparation=stage==='preparing_models'?safeModelPreparation(details):null;
        const submissionAccount=stage==='submitting'?safeSubmissionAccount(details?.account):null;
        update(next.jobId,{stage,message:message||LABELS[stage],modelPreparation,
          ...(submissionAccount?{submissionAccount}:{})});
        if(modelPreparation)console.info('H3 model transfer',JSON.stringify({jobId:next.jobId,...modelPreparation}));
        else console.info('Media preflight stage',next.jobId,stage);
      };
      let inputs;
      try{
        inputs=await materialize(read(next.jobId));await executor(inputs.job,report);
      }catch(error){
        console.error('Preflight background processing failed',next.jobId,String(error.message||error).slice(0,200));
        const last=read(next.jobId);
        update(next.jobId,{stage:last?.stage==='submitting'?'uncertain':'error',
          error:last?.stage==='submitting'?
            'Status penerimaan task belum bisa dipastikan. Periksa History sebelum mencoba lagi.':
            'Persiapan video terhenti. Kredit belum digunakan untuk tahap ini.'});
      }finally{
        if(inputs)await inputs.release();
        active.delete(next.jobId);
        const last=read(next.jobId);
        if(last&&FINISHED.has(last.stage)){
          await cleanupFinished().catch(()=>{});
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
    paused=false;
    void cleanupFinished().catch(()=>{});
    schedule();
  }
  function purge(){
    for(const data of enumerate()){
      if(active.has(data.jobId)||!FINISHED.has(data.stage))continue;
      if(now()-Date.parse(data.updatedAt||data.createdAt)>MAX_AGE)
        fs.rmSync(folder(data.jobId),{recursive:true,force:true});
    }
  }
  return {stage,read,update,view,owned,latest,setExecutor,resume,purge,recoverMedia,cleanupFinished,LABELS};
}

