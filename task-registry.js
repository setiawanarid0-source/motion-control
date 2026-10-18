// Encrypted, server-side task registry. Task credentials outlive Account Pool membership
// for the lifetime of the task and the three-day History retention window.
import fs from 'node:fs';
import path from 'node:path';

export const TASK_HISTORY_RETENTION_MS=3*24*60*60*1000;
const DONE=new Set(['success','failed']);
const VALID_ID=/^\d{10,25}$/;
const publicEntry=t=>({
  taskId:t.taskId,accountId:t.accountId,accountName:t.accountName,
  workflow:t.workflow,outputKind:t.outputKind||'video',mode:t.mode,
  video:t.video||'',submittedAt:t.submittedAt,startedAt:t.submittedAt,
  status:t.status,finishedAt:t.finishedAt||null,lastCheckedAt:t.lastCheckedAt||null,
  statusDetail:t.statusDetail||null,providerCode:t.providerCode??null,
  deliveryNote:t.deliveryNote||null,
  resultUrl:t.resultUrl||null,referenceMaskUrl:t.referenceMaskUrl||null,
  error:t.error||null,cameraQA:t.cameraQA||null
});
export function createTaskRegistry({dir,encrypt,decrypt,now=()=>Date.now()}){
  if(typeof encrypt!=='function'||typeof decrypt!=='function')throw Error('Task registry encryption required');
  const file=path.join(dir,'task-registry.enc');
  function all(){
    if(!fs.existsSync(file))return [];
    const raw=fs.readFileSync(file,'utf8').trim();
    const data=decrypt(raw);
    if(!data||!Array.isArray(data.tasks))throw Error('Encrypted task registry could not be read; refusing to overwrite');
    return data.tasks;
  }
  function retired(){
    if(!fs.existsSync(file))return [];
    const data=decrypt(fs.readFileSync(file,'utf8').trim());
    if(!data||!Array.isArray(data.tasks))throw Error('Task registry decryption failed');
    return Array.isArray(data.retiredAccounts)?data.retiredAccounts:[];
  }
  function commit(tasks,retiredAccounts=retired()){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const tmp=file+'.tmp-'+process.pid+'-'+now();
    try{
      fs.writeFileSync(tmp,encrypt({version:2,tasks,retiredAccounts}),{mode:0o600});
      fs.renameSync(tmp,file);
    }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  }
  function ensureWritable(){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const probe=path.join(dir,'.task-registry-write-test-'+process.pid);
    try{
      fs.writeFileSync(probe,'ok',{mode:0o600});
      fs.rmSync(probe,{force:true});
      all(); // Never silently overwrite a vault that cannot be decrypted.
    }finally{try{fs.rmSync(probe,{force:true});}catch{}}
  }
  function add(task){
    if(!VALID_ID.test(String(task?.taskId||''))||!task?.key||!task?.accountId)
      throw Error('Task registry requires accepted task ID and original account credential');
    const tasks=all();
    const id=String(task.taskId);
    const existing=tasks.find(t=>t.taskId===id);
    if(existing)return publicEntry(existing);
    const submittedAt=task.submittedAt||new Date(now()).toISOString();
    const entry={
      taskId:id,accountId:task.accountId,accountName:task.accountName||'Account',
      key:task.key,workflow:task.workflow||'',outputKind:task.outputKind||'video',
      mode:task.mode||'lite',video:task.video||'',submittedAt,
      status:task.status||'queued',finishedAt:null,lastCheckedAt:null,
      resultUrl:null,referenceMaskUrl:null,error:null,cameraQA:null,
      statusDetail:null,providerCode:null,deliveryNote:null
    };
    tasks.unshift(entry);
    commit(tasks);
    return publicEntry(entry);
  }
  function retireAccount(account){
    if(!account?.id||!account?.key)throw Error('Retired account requires encrypted credentials');
    const accounts=retired().filter(x=>x.id!==account.id);
    accounts.push({id:account.id,key:account.key,name:account.name,
      retiredAt:new Date(now()).toISOString()});
    commit(all(),accounts);
  }
  function getRetiredAccount(accountId){
    const acc=retired().find(x=>x.id===String(accountId));
    return acc?{id:acc.id,name:acc.name,key:acc.key}:null;
  }
  function retiredAccounts(){return retired().map(a=>({id:a.id,name:a.name}));}
  function get(taskId){return all().find(t=>t.taskId===String(taskId))||null;}
  function update(taskId,patch){
    const tasks=all();const t=tasks.find(x=>x.taskId===String(taskId));if(!t)return null;
    if(DONE.has(t.status)&&!DONE.has(patch.status))return publicEntry(t);
    const permitted=['status','lastCheckedAt','resultUrl','referenceMaskUrl','error','cameraQA','finishedAt',
      'statusDetail','providerCode','deliveryNote'];
    for(const key of permitted)if(Object.hasOwn(patch,key))t[key]=patch[key];
    if(DONE.has(t.status)&&!t.finishedAt)t.finishedAt=new Date(now()).toISOString();
    if(t.status==='success')t.error=null;
    commit(tasks);
    return publicEntry(t);
  }
  function publicList(){return all().map(publicEntry);}
  function active(){return all().filter(t=>!DONE.has(t.status));}
  function purgeExpired(){
    const tasks=all();const current=now();
    const keep=tasks.filter(t=>{
      if(!DONE.has(t.status))return true;
      const stopped=Date.parse(t.finishedAt||t.submittedAt||'');
      return !Number.isFinite(stopped)||current-stopped<=TASK_HISTORY_RETENTION_MS;
    });
    const activeAccountIds=new Set(keep.map(x=>x.accountId));
    const escrows=retired();
    const recent=escrows.filter(a=>{
      if(activeAccountIds.has(a.id))return true;
      const ts=Date.parse(a.retiredAt||'');
      return !Number.isFinite(ts)||current-ts<=TASK_HISTORY_RETENTION_MS;
    });
    if(keep.length!==tasks.length||recent.length!==escrows.length)commit(keep,recent);
    return tasks.length-keep.length;
  }
  return {ensureWritable,add,get,update,retireAccount,getRetiredAccount,retiredAccounts,publicList,active,purgeExpired,file};
}
