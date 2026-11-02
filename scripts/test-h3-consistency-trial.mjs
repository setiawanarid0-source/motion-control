import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import multer from 'multer';
import {consistencyTrialAuthorized,consistencyH3Profile,stageConsistencyTrial,
  verifyConsistencyMedia,installConsistencyTrial,consistencyModelChoices} from '../h3-consistency-trial.js';
import {h3PhotoPlan,h3Segments,h3GraphForInputs,H3_REVISION,H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';
const token='7'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
const expiry=new Date(Date.now()+60000).toISOString(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'h3-consistency-test-'));
let server;
try{
  assert.ok(consistencyTrialAuthorized(token,hash,expiry));
  for(const args of [[hash,hash,expiry],[token,'',expiry],[token,hash,'invalid'],[token,hash,'2020-01-01T00:00:00Z']])
    assert.equal(consistencyTrialAuthorized(...args),false);
  await assert.rejects(verifyConsistencyMedia({}),/Berkas/);
  const image={path:path.join(dir,'fake.jpg'),mimetype:'image/jpeg'},video={path:path.join(dir,'fake.mp4'),mimetype:'video/mp4'};
  await fs.writeFile(image.path,'not the approved photo');await fs.writeFile(video.path,'not the approved video');
  await assert.rejects(verifyConsistencyMedia({image,video}),/Checksum/);
  let staged=0,stagedJob=null;const queue={read:()=>null,stage:async job=>{staged++;stagedJob=job;assert.equal(consistencyH3Profile(job),'guide-dmad4-ffp');return {stage:'queued'};}};
  const args={queue,rootDir:'/data',caseName:'ffp-v1',checkpointDir:path.join(dir,'checkpoints'),image,video,verify:async()=>{}};
  await assert.rejects(stageConsistencyTrial({...args,rootDir:'/tmp'}),/tersedia/);
  await assert.rejects(stageConsistencyTrial({...args,caseName:'other'}),/tersedia/);
  assert.equal((await stageConsistencyTrial(args)).stage,'queued');
  assert.equal((await stageConsistencyTrial(args)).stage,'checkpointed');
  assert.equal(staged,1,'A restart/expired queue record must not trigger another paid run');
  const source={...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,hasAudio:true,sceneCuts:[],inferenceProfile:'guide-dmad4-ffp'};
  const graph=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo.jpg',videoName:'guide.mp4',source});
  assert.match(graph['7'].inputs.lora_name,/_ffp_/);assert.equal(graph['40'].inputs.sampler_name,'lcm');
  assert.equal(graph['41'].inputs.steps,4);assert.equal(graph['1004'].inputs.ref_image_size,'max');
  assert.equal(graph['1004'].inputs['ref_images.ref_image_2'],undefined);
  assert.match(graph['1004'].inputs.prompt,/^vfx_edit:/);
  assert.equal(graph['1036'].inputs.length,5);assert.equal(graph['1066'].inputs.length,5);
  assert.equal(graph['1037'],undefined,'Do not append contradictory source and generated guides at the same time');
  assert.equal(graph['33'].class_type,'ImageScale');assert.deepEqual(graph['33'].inputs.image,['30',0]);
  assert.deepEqual(graph['1005'].inputs.image,['1015',0]);assert.deepEqual(graph['1015'].inputs.image1,['34',0]);
  assert.equal(graph['1014'].inputs.batch_index,1);assert.equal(graph['1014'].inputs.length,123);
  assert.deepEqual(graph['1045'].inputs.image1,['1036',0]);assert.equal(graph['1044'].inputs.batch_index,5);
  const file='api-lora-usa/'+'a'.repeat(32)+'.safetensors';
  const uploaded=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo.jpg',videoName:'guide.mp4',source:{...source,appearanceLoraFile:file}});
  assert.equal(uploaded['7'].class_type,'RHLoraLoader');assert.equal(uploaded['7'].inputs.file_name,file);
  assert.equal(uploaded['7'].inputs.strength_clip,0);
  assert.throws(()=>h3GraphForInputs({revision:H3_REVISION},{imageName:'photo.jpg',videoName:'guide.mp4',source:{...source,appearanceLoraFile:'../weights'}}),/File model/);
  const motion=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo.jpg',videoName:'guide.mp4',
    source:{...source,inferenceProfile:'guide-dmad4-motion-anchor',referenceFace:{x:192,y:224,width:160,height:192}}});
  assert.equal(motion['7'].class_type,'LoraLoaderModelOnly');assert.match(motion['7'].inputs.lora_name,/motion_transfer_v1/);
  assert.equal(motion['41'].inputs.steps,4);assert.deepEqual(motion['1015'].inputs.image1,['34',0]);
  assert.deepEqual(motion['1045'].inputs.image1,['1036',0]);assert.deepEqual(motion['1004'].inputs['ref_images.ref_image_2'],['32',0]);
  const ffpFace=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo.jpg',videoName:'guide.mp4',
    source:{...source,inferenceProfile:'guide-dmad4-ffp-focus',appearanceLoraFile:file,referenceFace:{x:192,y:224,width:160,height:192}}});
  assert.equal(ffpFace['7'].class_type,'RHLoraLoader');assert.deepEqual(ffpFace['1004'].inputs['ref_images.ref_image_2'],['32',0]);
  assert.match(ffpFace['1004'].inputs.prompt,/^vfx_edit:/);assert.match(ffpFace['1004'].inputs.prompt,/<Picture 2> is a close-up/);
  assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-focus','Experimental path cannot change normal users before render validation');
  for(let n=6;n<=1440;n++){
    const parts=h3Segments(n,[],5);
    assert.equal(parts.reduce((s,p)=>s+p.length,0),n);
    assert.ok(parts.every(p=>p.modelFrames<=124));
    let start=0;
    for(const p of parts){assert.equal(p.start,start);assert.equal(p.loadStart,start-p.contextFrames);start+=p.length;}
  }
  assert.equal(consistencyModelChoices({data:{taskId:'paid'}}),null);
  let currentTask=null,cancelled=0;
  const app=express();installConsistencyTrial({app,upload:multer({dest:dir}),queue,rootDir:'/data',getTask:()=>currentTask,
    cancelTask:async id=>{cancelled++;return {taskId:id,status:'cancelled'};},hash,expires:expiry});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/internal/h3-consistency/';
  assert.equal((await fetch(base+'ffp-v1')).status,404);
  assert.equal((await fetch(base+'unknown',{headers:{'X-Vanta-H3-Trial':token}})).status,404);
  assert.equal((await fetch(base+'ffp-v1',{headers:{'X-Vanta-H3-Trial':token}})).status,200);
  const cancel=()=>fetch(base+'ffp-v1/cancel',{method:'POST',headers:{'X-Vanta-H3-Trial':token}});
  assert.equal((await cancel()).status,404);
  queue.read=()=>({...stagedJob,task:{taskId:'2117095711279767553'}});
  currentTask={taskId:'2117095711279767553',status:'running',video:'ordinary-user-clip.mp4',inputDiagnostics:{inferenceProfile:'guide-dmad4-ffp'}};
  assert.equal((await cancel()).status,404);assert.equal(cancelled,0,'Never cancel a normal user task');
  currentTask.video='h3-consistency-driving.mp4';assert.equal((await cancel()).status,200);assert.equal(cancelled,1);
  currentTask.status='success';assert.equal((await cancel()).status,200);assert.equal(cancelled,1,'Completed tasks cannot be cancelled');
  console.log('PASS: private case admission, expired/wrong credentials, checksums, permanent once-only guard, native FFP graph and aligned five-frame continuation');
}finally{if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
