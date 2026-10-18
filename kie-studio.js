// Separate encrypted kie.ai image service. RunningHub vault, jobs and workflows are untouched.
import express from 'express';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const KIE_MODELS=[
 {id:'qwen',name:'Qwen Image 3.0 Pro',create:'qwen3/pro-text-to-image',edit:'qwen3/pro-image-to-image',images:'image_urls',aspect:'image_size',resolution:'resolution',resolutions:['1K','2K']},
 {id:'wan',name:'WAN 2.7 Image Pro',create:'wan/2-7-image-pro',edit:'wan/2-7-image-pro',images:'input_urls',resolution:'resolution',resolutions:['1K','2K']},
 {id:'seedream',name:'Seedream 5.0 Pro',create:'seedream/5-pro-text-to-image',edit:'seedream/5-pro-image-to-image',images:'image_urls',aspect:'aspect_ratio',resolution:'quality',resolutions:['basic','high']},
 {id:'nano2',name:'Nano Banana 2',create:'nano-banana-2',edit:'nano-banana-2',images:'image_input',aspect:'aspect_ratio',resolution:'resolution',resolutions:['1K','2K','4K']},
 {id:'nanopro',name:'Nano Banana Pro',create:'nano-banana-pro',edit:'nano-banana-pro',images:'image_input',aspect:'aspect_ratio',resolution:'resolution',resolutions:['1K','2K','4K']},
 {id:'gpt2',name:'GPT Image 2',create:'gpt-image-2-text-to-image',edit:'gpt-image-2-image-to-image',images:'input_urls',aspect:'aspect_ratio',resolutions:[]},
 {id:'flare',name:'GPT Image 2.5 Flare',create:'gpt-image-2-5-flare-text-to-image',edit:'gpt-image-2-5-flare-image-to-image',images:'input_urls',aspect:'aspect_ratio',resolution:'resolution',resolutions:['1K','2K','4K']},
 {id:'sunburst',name:'GPT Image 2.5 Sunburst',create:'gpt-image-2-5-sunburst-text-to-image',edit:'gpt-image-2-5-sunburst-image-to-image',images:'input_urls',aspect:'aspect_ratio',resolution:'resolution',resolutions:['1K','2K','4K']}
];
const RATIOS=new Set(['auto','1:1','3:2','2:3','4:3','3:4','16:9','9:16','21:9']);
const BASE='https://api.kie.ai';
const FILE_API='https://kieai.redpandaai.co/api/file-stream-upload';
const MAX_FILE=10*1024*1024,RETENTION=3*24*60*60*1000;
const ID=/^[a-zA-Z0-9_-]{8,130}$/;
const acceptedImage=new Set(['image/png','image/jpeg','image/webp']);
const upload=multer({dest:path.join(os.tmpdir(),'vanta-kie-upload'),limits:{fileSize:MAX_FILE,files:2},fileFilter:(req,file,cb)=>cb(null,acceptedImage.has(file.mimetype))});
const safeUrl=s=>{try{const u=new URL(String(s));return u.protocol==='https:'&&!!u.hostname&&
  !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)?u.toString():null;}catch{return null;}};
const cleanError=e=>{
  const response=e?.response?.data, msg=response?.msg||response?.message||e?.message||'Layanan kie.ai belum merespons';
  return String(msg).replace(/Bearer\s+[^\s]+/gi,'Bearer [redacted]').slice(0,240);
};
export function buildKieInput(model,mode,{prompt,aspect,resolution,urls=[]}){
  if(!model||!['create','edit'].includes(mode))throw Error('Model atau mode tidak dikenal.');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw Error('Prompt wajib diisi (maksimal 12.000 karakter).');
  if(mode==='edit'&&(!urls.length||urls.length>2))throw Error('Edit Image memerlukan 1–2 gambar referensi.');
  if(mode==='create'&&urls.length)throw Error('Create Image tidak menerima gambar referensi.');
  const input={prompt:prompt.trim()};
  if(model.aspect){if(!RATIOS.has(aspect))throw Error('Aspect ratio tidak tersedia.');input[model.aspect]=aspect;}
  if(model.resolution){if(!model.resolutions.includes(resolution))throw Error('Resolusi atau kualitas tidak tersedia.');input[model.resolution]=resolution;}
  if(mode==='edit')input[model.images]=urls;
  if(model.id==='qwen')input.output_format='png';
  if(model.id==='nano2'||model.id==='nanopro')input.output_format='png';
  if(model.id==='seedream')input.output_format='png';
  if(model.id==='wan'){input.n=1;input.watermark=false;}
  return input;
}
export function createKieStudio({encrypt,decrypt,dir}){
  const router=express.Router();
  const root=path.join(dir,'kie-studio'),accountsFile=path.join(root,'accounts.enc'),
    tasksFile=path.join(root,'tasks.enc'),mediaRoot=path.join(root,'media');
  const pending=new Map();
  // Deduplicate live balance probes per account. Never share RunningHub balances.
  const balanceProbes=new Map();
  const AUTO_BALANCE_MAX_AGE_MS=30000;
  function load(file,key){
    try{const data=decrypt(fs.readFileSync(file,'utf8'));return Array.isArray(data?.[key])?data[key]:[];}catch{return[];}
  }
  function save(file,key,items){
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    const tmp=file+'.tmp-'+process.pid+'-'+crypto.randomUUID();
    try{fs.writeFileSync(tmp,encrypt({[key]:items,updatedAt:Date.now()}),{mode:0o600});fs.renameSync(tmp,file);}
    finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  }
  const getAccounts=()=>load(accountsFile,'accounts');
  const getTasks=()=>load(tasksFile,'tasks');
  const publicAccount=a=>({id:a.id,name:a.name,
    credits:a.state==='unavailable'?null:(a.credits??null),
    state:a.state||'unknown',lastCheckedAt:a.lastCheckedAt||null});
  async function refreshAccountBalance(id,{force=false}={}){
    const previous=balanceProbes.get(id);
    if(previous)return previous;
    const account=getAccounts().find(x=>x.id===id);
    if(!account)return null;
    const lastAttempt=Date.parse(account.lastAttemptAt||account.lastCheckedAt||'');
    if(!force&&Number.isFinite(lastAttempt)&&Date.now()-lastAttempt<AUTO_BALANCE_MAX_AGE_MS)
      return publicAccount(account);
    const request=(async()=>{
      let balance=null,failed=false;
      try{balance=await credits(account.key,10000);}
      catch(error){failed=true;console.warn('kie.ai account balance refresh failed',id,cleanError(error));}
      // Read again after the network call: never resurrect a removed account, and
      // never overwrite another account added/refreshed while this call awaited.
      const latest=getAccounts(),index=latest.findIndex(x=>x.id===id&&x.fingerprint===account.fingerprint);
      if(index<0)return null;
      latest[index]={...latest[index],
        ...(failed?{state:'unavailable'}:{credits:balance,state:'ready',lastCheckedAt:new Date().toISOString()}),
        lastAttemptAt:new Date().toISOString()};
      save(accountsFile,'accounts',latest);
      return publicAccount(latest[index]);
    })().finally(()=>balanceProbes.delete(id));
    balanceProbes.set(id,request);
    return request;
  }
  async function refreshBalances({force=false}={}){
    const accounts=getAccounts();
    await Promise.all(accounts.map(a=>refreshAccountBalance(a.id,{force})));
    return getAccounts().map(publicAccount);
  }
  const publicTask=t=>({id:t.id,accountId:t.accountId,accountName:t.accountName,
    model:t.model,modelName:t.modelName,mode:t.mode,prompt:t.prompt,aspect:t.aspect,
    resolution:t.resolution,status:t.status,error:t.error||null,createdAt:t.createdAt,
    completedAt:t.completedAt||null,creditsConsumed:t.creditsConsumed??null,
    resultUrls:t.resultUrls||[],referenceCount:t.referenceCount||0,
    references:(t.references||[]).map((url,index)=>url?'/api/kie/tasks/'+encodeURIComponent(t.id)+'/reference/'+index:null)});
  async function kieRequest(key,method,uri,data,timeout=30000){
    const resp=await axios({url:BASE+uri,method,data,timeout,headers:{
      Authorization:'Bearer '+key,...(data?{'Content-Type':'application/json'}:{})
    },validateStatus:()=>true,maxRedirects:0});
    if(resp.status!==200||Number(resp.data?.code)!==200)
      throw Error(String(resp.data?.msg||'kie.ai API error '+resp.status).slice(0,240));
    return resp.data.data;
  }
  async function credits(key,timeout=30000){
    const n=Number(await kieRequest(key,'GET','/api/v1/chat/credit',undefined,timeout));
    if(!Number.isFinite(n)||n<0)throw Error('Saldo kie.ai tidak dapat diverifikasi.');
    return n;
  }
  const updateTask=(id,fields)=>{
    const tasks=getTasks(),i=tasks.findIndex(t=>t.id===id);
    if(i<0)return null;
    tasks[i]={...tasks[i],...fields};save(tasksFile,'tasks',tasks);return tasks[i];
  };
  const prune=()=>{
    const all=getTasks(),now=Date.now(),keep=all.filter(t=>now-Date.parse(t.createdAt)<RETENTION);
    if(keep.length!==all.length)save(tasksFile,'tasks',keep);
    try{
      for(const entry of fs.readdirSync(mediaRoot)){
        if(!ID.test(entry)||keep.some(x=>x.id===entry))continue;
        fs.rmSync(path.join(mediaRoot,entry),{recursive:true,force:true});
      }
    }catch{}
  };
  function resultUrls(data){
    let parsed=data.resultJson||data.resultUrls||null;
    if(typeof parsed==='string'){try{parsed=JSON.parse(parsed);}catch{parsed=null;}}
    const list=Array.isArray(parsed)?parsed:parsed?.resultUrls||parsed?.result_urls||[];
    return (Array.isArray(list)?list:[]).map(x=>typeof x==='string'?x:x?.url).map(safeUrl).filter(Boolean).slice(0,10);
  }
  async function refreshTask(task){
    if(pending.has(task.id))return pending.get(task.id);
    const job=(async()=>{
      try{
        const data=await kieRequest(task.key,'GET','/api/v1/jobs/recordInfo?taskId='+encodeURIComponent(task.id));
        const st=String(data?.state||'').toLowerCase();
        let status=task.status,extra={lastCheckedAt:Date.now()};
        if(['waiting','queuing'].includes(st))status='queued';
        else if(st==='generating')status='generating';
        else if(st==='fail'){status='failed';extra.error=String(data.failMsg||data.failCode||'kie.ai melaporkan task gagal').slice(0,200);extra.completedAt=new Date().toISOString();}
        else if(st==='success'){
          status='success';extra.resultUrls=resultUrls(data);extra.completedAt=new Date().toISOString();
          if(!extra.resultUrls.length){status='check_error';extra.error='Hasil kie.ai belum mengandung URL gambar. Pemeriksaan akan diulang.';}
          else extra.error=null;
        }else{status='check_error';extra.error='Status kie.ai belum tersedia.';}
        if(data.creditsConsumed!=null&&Number.isFinite(Number(data.creditsConsumed)))extra.creditsConsumed=Number(data.creditsConsumed);
        const updated=updateTask(task.id,{status,...extra});
        // On transition to success/failure, re-check the actual provider balance.
        // Never subtract estimated model prices or modify an active paid task.
        if(updated&&['success','failed'].includes(status)&&status!==task.status)
          void refreshAccountBalance(task.accountId,{force:true}).catch(e=>
            console.warn('kie.ai post-task credit sync deferred',task.id,cleanError(e)));
        return updated;
      }catch(e){return updateTask(task.id,{status:'check_error',error:'Tidak dapat memeriksa status kie.ai: '+cleanError(e),lastCheckedAt:Date.now()});}
    })().finally(()=>pending.delete(task.id));
    pending.set(task.id,job);return job;
  }
  async function refreshPending(limit=5){
    const tasks=getTasks().filter(t=>!['success','failed'].includes(t.status));
    await Promise.all(tasks.slice(0,limit).map(t=>refreshTask(t)));
  }
  const guard=(req,res,next)=>{if(!/^[a-zA-Z0-9_-]{20,128}$/.test(String(req.headers['x-vanta-device']||'')))
    return res.status(401).json({error:'Sesi browser tidak tersedia.'});next();};
  router.use(guard);
  router.get('/models',(req,res)=>res.json({models:KIE_MODELS.map(({images,...m})=>m)}));
  router.get('/accounts',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{res.json({accounts:await refreshBalances()});}
    catch(e){res.status(503).json({error:'Saldo kie.ai belum dapat diperbarui.'});}
  });
  router.post('/accounts',async(req,res)=>{
    const key=String(req.body?.apiKey||'').trim();
    if(key.length<12||key.length>256)return res.status(400).json({error:'API key kie.ai tidak valid.'});
    try{
      const balance=await credits(key),accounts=getAccounts();
      const fingerprint=crypto.createHash('sha256').update(key).digest('hex');
      if(accounts.some(a=>a.fingerprint===fingerprint))return res.status(409).json({error:'API key sudah ada.'});
      const nextIndex=Math.max(0,...accounts.map(a=>Number((String(a.name||'').match(/^Account (\d+)$/)||[])[1])||0))+1;
      const account={id:crypto.randomUUID(),name:'Account '+String(nextIndex).padStart(2,'0'),
        key,fingerprint,credits:balance,state:'ready',lastCheckedAt:new Date().toISOString(),
        lastAttemptAt:new Date().toISOString()};
      save(accountsFile,'accounts',[...accounts,account]);res.status(201).json({account:publicAccount(account)});
    }catch(e){res.status(400).json({error:'Validasi kie.ai gagal: '+cleanError(e)});}
  });
  router.post('/accounts/refresh',async(req,res)=>{
    try{res.setHeader('Cache-Control','no-store');res.json({accounts:await refreshBalances({force:true})});}
    catch(e){res.status(503).json({error:'Tidak dapat memperbarui saldo kie.ai.'});}
  });
  router.delete('/accounts/:id',(req,res)=>{
    const accounts=getAccounts(),next=accounts.filter(a=>a.id!==req.params.id);
    if(next.length===accounts.length)return res.status(404).json({error:'Akun tidak ditemukan.'});
    // Accepted jobs retain their own encrypted key in tasks.enc for status recovery.
    save(accountsFile,'accounts',next);res.json({ok:true});
  });
  router.get('/tasks',async(req,res)=>{
    try{prune();await refreshPending();res.setHeader('Cache-Control','no-store');
      res.json({tasks:getTasks().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(publicTask)});
    }catch(e){res.status(503).json({error:'History kie.ai sementara tidak tersedia.'});}
  });
  router.get('/tasks/:id',async(req,res)=>{
    let t=getTasks().find(x=>x.id===req.params.id);
    if(!t)return res.status(404).json({error:'Task tidak ditemukan.'});
    if(!['success','failed'].includes(t.status))t=await refreshTask(t)||t;
    res.setHeader('Cache-Control','no-store');res.json({task:publicTask(t)});
  });
  router.delete('/tasks/:id',(req,res)=>{
    const id=String(req.params.id||'');
    if(!ID.test(id))return res.status(400).json({error:'Task ID tidak valid.'});
    try{
      const tasks=getTasks(),item=tasks.find(x=>x.id===id);
      if(!item)return res.status(404).json({error:'Task tidak ditemukan.'});
      if(!['success','failed'].includes(item.status))
        return res.status(409).json({error:'Task masih berjalan dan tidak boleh dihapus.'});
      save(tasksFile,'tasks',tasks.filter(x=>x.id!==id));
      // Only this task's local reference cache; no other accounts/jobs affected.
      fs.rmSync(path.join(mediaRoot,id),{recursive:true,force:true});
      return res.json({ok:true});
    }catch(error){
      return res.status(503).json({error:'History sementara tidak dapat dihapus.'});
    }
  });
  router.get('/tasks/:id/reference/:index',(req,res)=>{
    const t=getTasks().find(x=>x.id===req.params.id),n=Number(req.params.index);
    if(!t||!Number.isInteger(n)||n<0||n>1||n>=t.referenceCount)return res.sendStatus(404);
    const file=path.join(mediaRoot,t.id,'reference-'+n);
    if(fs.existsSync(file)){res.setHeader('Cache-Control','private,no-store');res.type(t.referenceTypes?.[n]||'image/jpeg');return res.sendFile(file);}
    const remote=safeUrl(t.references?.[n]);if(remote)return res.redirect(remote);
    res.sendStatus(404);
  });
  const files=upload.array('references',2);
  router.post('/generate',(req,res)=>{
    files(req,res,async error=>{
      const incoming=req.files||[];
      const release=()=>Promise.all(incoming.map(x=>fs.promises.rm(x.path,{force:true}).catch(()=>{})));
      if(error){await release();return res.status(400).json({error:'Gambar maksimal 10 MB, format JPG/PNG/WEBP; maksimum dua.'});}
      const mode=String(req.body?.mode||''),model=KIE_MODELS.find(x=>x.id===req.body?.model),
        prompt=String(req.body?.prompt||''),accountId=String(req.body?.accountId||'auto'),
        aspect=String(req.body?.aspect||'1:1'),resolution=String(req.body?.resolution||'1K');
      let submitted=false,accepted=false,taskId='';
      try{
        if(!model||!['create','edit'].includes(mode))throw Error('Pilih model dan mode Create/Edit.');
        if(mode==='edit'&&(!incoming.length||incoming.length>2))throw Error('Pilih satu atau dua gambar referensi.');
        if(mode==='create'&&incoming.length)throw Error('Create Image tidak menerima referensi.');
        if(!prompt.trim()||prompt.length>12000)throw Error('Prompt wajib diisi (maksimal 12.000 karakter).');
        const accounts=getAccounts(),candidates=accountId==='auto'?accounts.filter(a=>a.state==='ready')
          .sort((a,b)=>Number(b.credits||0)-Number(a.credits||0))
          :accounts.filter(a=>a.id===accountId);
        if(!candidates.length)throw Error('Tambahkan akun kie.ai terlebih dahulu.');
        // No repeated paid submission after the first createTask call has started.
        let account=null;for(const candidate of candidates){
          try{const balance=await credits(candidate.key);if(balance>0){account={...candidate,credits:balance};break;}}
          catch(e){if(accountId!=='auto')throw e;}
        }
        if(!account)throw Error('Tidak ada akun kie.ai yang dapat digunakan atau kreditnya habis.');
        // Preflight used the actual provider balance; persist it before submitting.
        // Subsequent live probes reconcile spending once kie.ai has charged the task.
        const at=getAccounts(),index=at.findIndex(a=>a.id===account.id);
        if(index>=0){
          at[index]={...at[index],credits:account.credits,state:'ready',
            lastCheckedAt:new Date().toISOString(),lastAttemptAt:new Date().toISOString()};
          save(accountsFile,'accounts',at);
        }
        const refs=[];
        for(const [index,file] of incoming.entries()){
          const form=new FormData();
          form.append('file',fs.createReadStream(file.path),{filename:file.originalname||'reference-'+index+'.png',contentType:file.mimetype});
          form.append('uploadPath','vanta/image-references');form.append('fileName',crypto.randomUUID()+'-'+index+'.png');
          const response=await axios.post(FILE_API,form,{
            headers:{Authorization:'Bearer '+account.key,...form.getHeaders()},timeout:120000,maxBodyLength:MAX_FILE+40000,
            validateStatus:()=>true});
          const url=safeUrl(response.data?.data?.downloadUrl);
          if(response.status!==200||!url)throw Error(String(response.data?.msg||'Upload referensi kie.ai gagal.').slice(0,180));
          refs.push(url);
        }
        const input=buildKieInput(model,mode,{prompt,aspect,resolution,urls:refs});
        submitted=true;
        const data=await kieRequest(account.key,'POST','/api/v1/jobs/createTask',{
          model:mode==='edit'?model.edit:model.create,input
        },65000);
        taskId=String(data?.taskId||'');
        if(!ID.test(taskId))throw Error('kie.ai belum memberikan task ID. Periksa akun sebelum generate ulang.');
        accepted=true;
        const task={id:taskId,key:account.key,accountId:account.id,accountName:account.name,
          mode,model:model.id,modelName:model.name,prompt:prompt.trim(),aspect,resolution,
          referenceCount:refs.length,referenceTypes:incoming.map(x=>x.mimetype),references:refs,
          status:'queued',error:null,createdAt:new Date().toISOString(),resultUrls:[]};
        const tasks=getTasks();
        if(!tasks.some(x=>x.id===taskId))save(tasksFile,'tasks',[task,...tasks].slice(0,250));
        // Credits may be charged at submission or completion, provider-dependent.
        void refreshAccountBalance(account.id,{force:true}).catch(e=>
          console.warn('kie.ai submitted-task credit sync deferred',taskId,cleanError(e)));
        // Best effort reference persistence for three-day History; never jeopardize the paid task.
        try{
          fs.mkdirSync(path.join(mediaRoot,taskId),{recursive:true,mode:0o700});
          const space=fs.statfsSync(mediaRoot);
          if(Number(space.bavail)*Number(space.bsize)>100*1024*1024)
            for(const [i,file] of incoming.entries())
              fs.copyFileSync(file.path,path.join(mediaRoot,taskId,'reference-'+i));
        }catch(e){console.warn('kie.ai reference preview cache skipped',taskId,e.message);}
        res.status(202).json({task:publicTask(task)});
      }catch(e){
        if(submitted&&!accepted){
          // Never silently resend a possibly charged request.
          return res.status(502).json({error:'Konfirmasi kie.ai tidak pasti. Periksa History/akun kie.ai sebelum mengirim ulang. '+cleanError(e)});
        }
        return res.status(400).json({error:cleanError(e)});
      }finally{await release();}
    });
  });
  setInterval(()=>{prune();refreshPending(4).catch(e=>console.warn('kie status monitor',e.message));},25000).unref();
  return router;
}
