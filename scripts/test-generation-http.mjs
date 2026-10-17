import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-upload-http-'));
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
});
const server=spawn(process.execPath,['server.js'],{
  cwd:new URL('..',import.meta.url).pathname,
  env:{...process.env,PORT:String(port),VANTA_DATA_DIR:dir,
    APP_MASTER_KEY:'integration-test-only-not-production',VANTA_REFERENCE_AUDIT_TASK:''},
  stdio:['ignore','pipe','pipe']
});
let output='';
server.stdout.on('data',chunk=>output+=String(chunk).slice(-1000));
server.stderr.on('data',chunk=>output+=String(chunk).slice(-1000));
const url='http://127.0.0.1:'+port,device='01234567890123456789012345678901';
const headers={'X-Vanta-Device':device};
async function waitForServer(){
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('Test server exited: '+output.slice(-400));
    try{const r=await fetch(url+'/health');if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Test server did not boot: '+output.slice(-600));
}
try{
  await waitForServer();
  const jobId=crypto.randomUUID();
  const form=(mode='standard')=>{
    const data=new FormData();
    data.append('referenceImage',new Blob([Buffer.alloc(1024,1)],{type:'image/jpeg'}),'source.jpg');
    data.append('videoReference',new Blob([Buffer.alloc(4096,2)],{type:'video/mp4'}),'source.mp4');
    data.append('workflow','r15');data.append('mode',mode);
    data.append('accountId','auto');return data;
  };
  const started=Date.now();
  const response=await fetch(url+'/api/generate',{
    method:'POST',headers:{...headers,'X-Vanta-Request-Id':jobId},body:form()
  });
  const first=await response.json();
  assert.equal(response.status,202,JSON.stringify(first));
  assert.equal(first.jobId,jobId);
  assert.ok(Date.now()-started<8000,'Upload must respond before expensive preprocessing');
  const owned=await fetch(url+'/api/generate/jobs/'+jobId,{headers});
  assert.equal(owned.status,200);
  const foreign=await fetch(url+'/api/generate/jobs/'+jobId,{
    headers:{'X-Vanta-Device':'other-device-012345678901234567'}
  });
  assert.equal(foreign.status,404);
  let state=null;
  for(let i=0;i<50;i++){
    const r=await fetch(url+'/api/generate/jobs/'+jobId,{headers});
    state=await r.json();
    if(state.stage==='error')break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(state.stage,'error','No RunningHub accounts: preflight rejects without paid task');
  assert.equal(state.task,null);
  const replay=await fetch(url+'/api/generate',{
    method:'POST',headers:{...headers,'X-Vanta-Request-Id':jobId},body:form()
  });
  assert.equal(replay.status,202);
  assert.equal((await replay.json()).jobId,jobId);
  const latest=await fetch(url+'/api/generate/jobs',{headers});
  assert.ok((await latest.json()).jobs.some(x=>x.jobId===jobId));
  // Only Standard and Plus are offered/accepted for NEW requests.
  const plusId=crypto.randomUUID();
  const plusResponse=await fetch(url+'/api/generate',{
    method:'POST',headers:{...headers,'X-Vanta-Request-Id':plusId},body:form('plus')
  });
  assert.equal(plusResponse.status,202);
  assert.equal((await plusResponse.json()).jobId,plusId);
  const liteResponse=await fetch(url+'/api/generate',{
    method:'POST',headers:{...headers,'X-Vanta-Request-Id':crypto.randomUUID()},body:form('lite')
  });
  assert.equal(liteResponse.status,400,'Legacy Lite must not be available for new uploads');
  assert.match((await liteResponse.json()).error,/Standard atau Plus/);
  console.log('PASS: HTTP 202 before processing, Standard/Plus validation, session isolation, and idempotency');
}finally{
  server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!==null||server.killed){setTimeout(resolve,300);}else{server.once('exit',resolve);setTimeout(resolve,2000);}});
  fs.rmSync(dir,{recursive:true,force:true});
}
