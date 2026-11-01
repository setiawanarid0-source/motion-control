import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGenerationQueue} from '../generation-queue.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {LONG_H3_JOB,LONG_H3_TOKEN,longH3Profile,longH3Result,longH3ModelChoices,stageLongH3Benchmark,runLongH3Deployment} from '../h3-long-benchmark.js';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'h3-long-test-'));
let called=0;
try{
  const stage=async args=>{called++;assert.equal(args.checkpointDir,'/data/h3-benchmark-checkpoints');return {stage:'queued'};};
  for(const args of [{rootDir:'/tmp',token:LONG_H3_TOKEN},{rootDir:'/data',token:''},{rootDir:'/data',token:'old-token'}])
    assert.equal(await runLongH3Deployment({...args,stage}),null);
  assert.equal(called,0);
  assert.equal((await runLongH3Deployment({rootDir:'/data',token:LONG_H3_TOKEN,stage})).stage,'queued');
  const queue={read:()=>null,stage:async()=>{throw Error('Unapproved bytes must never be queued');}};
  const args={queue,checkpointDir:dir,download:async()=>{called++;return Buffer.from('changed public fixture');}};
  await assert.rejects(stageLongH3Benchmark(args),/hash mismatch/);
  const before=called;
  assert.equal((await stageLongH3Benchmark(args)).stage,'checkpointed');
  assert.equal(called,before,'Persistent marker prevents retries even after the queue record expires');
  const job={jobId:LONG_H3_JOB,deviceId:'h3-safe-long-benchmark-20261101-v1',
    image:{originalname:'H3-safe-reference-large.png'},video:{originalname:'H3-safe-guide-15s.mp4'}};
  assert.equal(longH3Profile(job),'guide-dmad4-focus');
  assert.equal(longH3Profile({...job,image:{originalname:'private-photo.png'}}),null);
  assert.equal(longH3Profile({jobId:LONG_H3_JOB}),null);
  const model='models/minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors';
  const rejection={msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},node_errors:{6:{
    class_type:'LoraLoaderModelOnly',errors:[{extra_info:{input_config:[[model,'private-key','https://secret.invalid/key','../minimax_dmad_4step.safetensors']]}}]}}})};
  assert.deepEqual(longH3ModelChoices(rejection).dmad4Options,[model]);
  assert.equal(longH3ModelChoices({...rejection,data:{taskId:'2113333333333333333'}}),null,'An accepted task is never treated as a reject');
  assert.equal(longH3Result({taskId:'123'},queue),null);
  const photo=h3PhotoPlan(1600,2850),user=h3PhotoPlan(1533,2734);
  const pixels=(photo.referenceWidth+photo.referencePadRight)*(photo.referenceHeight+photo.referencePadBottom);
  const userPixels=(user.referenceWidth+user.referencePadRight)*(user.referenceHeight+user.referencePadBottom)+512*704;
  assert.deepEqual([photo.canvasWidth,photo.canvasHeight],[user.canvasWidth,user.canvasHeight]);
  assert.ok(pixels>=userPixels&&pixels<userPixels*1.01,'The long trial must not use a much smaller native reference than the slow task');
  if(process.env.VANTA_H3_LONG_SOURCE_DIR){
    const q=createGenerationQueue({dir:path.join(dir,'queue')});
    const result=await stageLongH3Benchmark({queue:q,checkpointDir:path.join(dir,'integration-lock'),
      download:asset=>fs.readFile(path.join(process.env.VANTA_H3_LONG_SOURCE_DIR,asset.name))});
    assert.equal(longH3Profile(q.read(result.jobId)),'guide-dmad4-focus');
    assert.ok((await fs.stat(q.read(result.jobId).image.path)).size>1000000);
  }
  console.log('PASS: explicit fifteen-second clothed trial, native reference/output cost match, asset hashes and permanent once-only checkpoint');
}finally{await fs.rm(dir,{recursive:true,force:true});}
