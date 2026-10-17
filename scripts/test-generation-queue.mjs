import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGenerationQueue} from '../generation-queue.js';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-generation-queue-'));
const img=path.join(folder,'source.jpg'),vid=path.join(folder,'source.mp4');
fs.writeFileSync(img,Buffer.alloc(1024,1));
fs.writeFileSync(vid,Buffer.alloc(4096,2));
const device='01234567890123456789012345678901';
const file=(src,name,mime)=>({path:src,originalname:name,mimetype:mime,size:fs.statSync(src).size});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const queue=createGenerationQueue({dir:folder,maxConcurrent:1});
  const id=crypto.randomUUID();
  const data=await queue.stage({jobId:id,deviceId:device,body:{workflow:'r15',mode:'lite',accountId:'test'},
    image:file(img,'reference.jpg','image/jpeg'),video:file(vid,'motion.mp4','video/mp4')});
  assert.equal(data.stage,'queued');
  assert.ok(!data.task);
  assert.ok(fs.existsSync(queue.read(id).image.path));
  assert.equal(queue.owned(id,'other-device'),null);
  assert.equal(queue.latest(device).length,1);
  const again=await queue.stage({jobId:id,deviceId:device,body:{workflow:'r15'},
    image:file(img,'reference.jpg','image/jpeg'),video:file(vid,'motion.mp4','video/mp4')});
  assert.equal(again.jobId,id);
  assert.equal(queue.latest(device).length,1,'Idempotency must not queue a second paid job');
  let called=0;
  queue.setExecutor(async(job,progress)=>{
    called++;
    progress('analyzing');await sleep(10);
    progress('preparing_motion');await sleep(20);
    progress('submitting');await sleep(10);
    queue.update(job.jobId,{stage:'accepted',task:{taskId:'2109000000000000001'}});
  });
  for(let i=0;i<30&&!queue.owned(id,device).task;i++)await sleep(20);
  assert.equal(called,1);
  assert.equal(queue.owned(id,device).stage,'accepted');
  assert.equal(queue.owned(id,device).task.taskId,'2109000000000000001');
  const paid=crypto.randomUUID();
  const second=await queue.stage({jobId:paid,deviceId:device,body:{workflow:'r15'},
    image:file(img,'reference.jpg','image/jpeg'),video:file(vid,'motion.mp4','video/mp4')});
  queue.update(paid,{stage:'submitting'});
  const before=called;
  const restarted=createGenerationQueue({dir:folder});
  restarted.resume();
  assert.equal(restarted.owned(paid,device).stage,'uncertain');
  assert.equal(called,before,'An ambiguous paid request must not be retried');
  const other=crypto.randomUUID();
  await restarted.stage({jobId:other,deviceId:device,body:{workflow:'current'},
    image:file(img,'reference.jpg','image/jpeg'),video:file(vid,'motion.mp4','video/mp4')});
  const reboot=createGenerationQueue({dir:folder});
  reboot.resume();
  assert.equal(reboot.owned(other,device).stage,'queued','Unpaid preflight may be restarted');
  assert.ok(!JSON.stringify(queue.latest(device)).includes(folder),'Do not expose storage paths');
  console.log('PASS: durable async preflight queue, repeat-ID idempotence, restart safety, and client isolation');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
