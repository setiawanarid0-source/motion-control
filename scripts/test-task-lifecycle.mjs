import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createTaskRegistry,TASK_HISTORY_RETENTION_MS} from '../task-registry.js';
import {partitionAccountRefresh,canStartNewTask} from '../account-eligibility.js';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-lifecycle-'));
let now=Date.now();
const secret=crypto.randomBytes(32);
const encrypt=data=>{
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
  const raw=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),raw].map(x=>x.toString('base64url')).join('.');
};
const decrypt=token=>{
  const [iv,tag,body]=token.split('.').map(x=>Buffer.from(x,'base64url'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',secret,iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString());
};
try{
  const registry=createTaskRegistry({dir:folder,encrypt,decrypt,now:()=>now});
  registry.ensureWritable();
  const account={id:'acc-01',name:'Account 01',key:'private-key-1234567890'};
  const job='2109000000000000101';
  registry.add({taskId:job,accountId:account.id,accountName:account.name,
    key:account.key,workflow:'MotionFly',submittedAt:new Date(now).toISOString(),status:'queued'});
  assert.equal(registry.active().length,1);
  // Balance can drop immediately, including when RunningHub reports active tasks.
  const part=partitionAccountRefresh([{account,status:{remainCoins:5,currentTaskCounts:1}}]);
  assert.equal(part.removed.length,1);
  registry.retireAccount(account);
  assert.equal(canStartNewTask({remainCoins:5}),false);
  assert.equal(registry.getRetiredAccount(account.id).key,account.key);
  assert.equal(registry.get(job).key,account.key);
  assert.ok(!JSON.stringify(registry.publicList()).includes(account.key));
  assert.ok(!fs.readFileSync(registry.file,'utf8').includes(account.key));
  assert.equal(fs.statSync(registry.file).mode & 0o777,0o600);
  // Transient network errors do not make an accepted RunningHub job 'failed'.
  registry.update(job,{status:'check_error',error:'Retrying'});
  assert.equal(registry.active().length,1);
  now+=TASK_HISTORY_RETENTION_MS+86400*1000;
  registry.purgeExpired();
  assert.ok(registry.get(job),'Active task must never expire regardless of credit or elapsed time');
  assert.ok(registry.getRetiredAccount(account.id),'Retired credential must survive an active task');
  registry.update(job,{status:'success',resultUrl:'https://files.runninghub.ai/result.mp4'});
  assert.equal(registry.get(job).status,'success');
  registry.update(job,{status:'check_error',error:'Transient status error'});
  assert.equal(registry.get(job).status,'success');
  now+=TASK_HISTORY_RETENTION_MS-60000;
  registry.purgeExpired();
  assert.ok(registry.get(job),'Finished task stays accessible throughout History retention');
  now+=120000;
  registry.purgeExpired();
  assert.equal(registry.get(job),null);
  assert.equal(registry.getRetiredAccount(account.id),null);
  assert.equal(registry.publicList().length,0);
  fs.writeFileSync(registry.file,'corrupt',{mode:0o600});
  assert.throws(()=>registry.ensureWritable(),/could not be read/);
  console.log('PASS: active jobs survive account retirement, encrypted keys, retries, History TTL and corruption fail-closed');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
