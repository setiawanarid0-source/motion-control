import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGenerationQueue} from '../generation-queue.js';
import {stageSafeH3Benchmark,safeH3Profile,safeH3FaceFocus,safeH3Result,resumeSafeH3Progress,SAFE_H3_JOB,SAFE_H3_TOKEN,SAFE_H3_TARA_JOB,SAFE_H3_TARA_TOKEN} from '../h3-safe-benchmark.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'h3-safe-benchmark-test-'));
let downloads=0,stages=0;
const download=async()=>{downloads++;return Buffer.from('unapproved content');};
const queue={read:()=>null,stage:async()=>{stages++;}};
try{
  assert.equal(await stageSafeH3Benchmark({queue,token:'',download}),null);
  assert.equal(downloads,0,'Default startup must never start a benchmark');
  await assert.rejects(stageSafeH3Benchmark({queue,token:SAFE_H3_TOKEN,download}),/hash mismatch/);
  assert.equal(stages,0,'Changed or unreviewed public media cannot enter the paid queue');
  for(const stage of ['accepted','uncertain','error','submitting','queued']){
    const old=await stageSafeH3Benchmark({queue:{...queue,read:()=>({stage})},token:SAFE_H3_TOKEN,download});
    assert.equal(old.reused,true);assert.equal(old.stage,stage);
  }
  assert.equal(downloads,1,'Restart cannot rerun an accepted/uncertain/failed benchmark');
  assert.equal(safeH3Profile({jobId:SAFE_H3_JOB}),null);
  assert.equal(safeH3Profile({body:{h3BenchmarkProfile:'no-training-adapter'}}),null);
  assert.equal(safeH3FaceFocus({jobId:SAFE_H3_JOB}),null,'Fixture coordinates cannot be applied to arbitrary uploads');
  // Optional local integration fixture; CI and production tests do not download
  // media, require credentials, or make paid provider calls.
  if(process.env.VANTA_H3_SAFE_SOURCE){
    const media=await fs.readFile(process.env.VANTA_H3_SAFE_SOURCE);
    const q=createGenerationQueue({dir:root});
    const job=await stageSafeH3Benchmark({queue:q,token:SAFE_H3_TOKEN,download:async()=>media});
    const stored=q.read(job.jobId);
    assert.equal(safeH3Profile(stored),'no-training-adapter');
    assert.ok((await fs.stat(stored.image.path)).size>1000);
    assert.ok((await fs.stat(stored.video.path)).size>1000);
    assert.equal(stored.body.mode,'plus');
    assert.equal(stored.stage,'queued');
    assert.equal(safeH3Result({taskId:'2113333333333333333'},q),null);
    q.update(SAFE_H3_JOB,{stage:'accepted',task:{taskId:'2113333333333333333'}});
    assert.equal(safeH3Result({taskId:'2113333333333333333',status:'success'},q).inferenceProfile,'no-training-adapter');
    const replay=await stageSafeH3Benchmark({queue:q,token:SAFE_H3_TOKEN,download:async()=>{throw Error('No repeat');}});
    assert.equal(replay.reused,true);
    const second=await stageSafeH3Benchmark({queue:q,token:SAFE_H3_TARA_TOKEN,download:async()=>media});
    assert.equal(second.jobId,SAFE_H3_TARA_JOB);
    assert.equal(safeH3Profile(q.read(second.jobId)),'tara-native');
    q.update(SAFE_H3_TARA_JOB,{stage:'accepted',task:{taskId:'2113333333333333334',netWssUrl:'wss://www.runninghub.ai/ws?private'}});
    const resumed=[];
    resumeSafeH3Progress({queue:q,observe:(id,url)=>resumed.push({id,url})});
    assert.equal(resumed.length,2,'Reconnect accepted benchmark progress after deployment without creating tasks');
    assert.equal(resumed[1].id,'2113333333333333334');
    assert.equal(safeH3Result({taskId:'2113333333333333334',status:'success'},q).inferenceProfile,'tara-native');
  }
  console.log('PASS: opt-in clothed benchmark, approved-media hash, durable once-only submission and private inference profile');
}finally{await fs.rm(root,{recursive:true,force:true});}
