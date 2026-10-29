import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateRifeVideoProbe,rifeGraphForSourceFps,verifyRifeInput,RIFE_TARGET_FPS,RIFE_WORKFLOW_ID} from '../rife-video.js';
import {createGenerationQueue} from '../generation-queue.js';

const graph=JSON.parse(fs.readFileSync(new URL('../workflows/rife60-api.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(graph),['1','2','3']);
assert.equal(graph['1'].class_type,'VHS_LoadVideo');
assert.equal(graph['1'].inputs.force_rate,0,'Do not drop or duplicate native source frames to force 30 fps');
assert.equal(graph['1'].inputs.force_size,'Disabled');
assert.equal(graph['1'].inputs.custom_width,0);
assert.equal(graph['1'].inputs.custom_height,0);
assert.equal(graph['1'].inputs.frame_load_cap,0);
assert.equal(graph['2'].class_type,'RIFEInterpolation');
assert.equal(graph['2'].inputs.target_fps,60);
assert.equal(graph['2'].inputs.scale,1);
assert.deepEqual(graph['2'].inputs.images,['1',0]);
assert.equal(graph['3'].class_type,'VHS_VideoCombine');
assert.deepEqual(graph['3'].inputs.images,['2',0]);
assert.deepEqual(graph['3'].inputs.audio,['1',2]);
assert.equal(graph['3'].inputs.frame_rate,60);
assert.equal(graph['3'].inputs.save_output,true);
assert.ok(Object.values(graph).every(x=>!/Upscale|Resize|MotionFly|KSampler/i.test(x.class_type)));
for(const node of Object.values(graph))
  for(const value of Object.values(node.inputs||{}))
    if(Array.isArray(value)&&typeof value[0]==='string'&&Number.isInteger(value[1]))
      assert.ok(graph[value[0]],'Broken graph link '+value[0]);
assert.equal(RIFE_TARGET_FPS,60);
assert.equal(RIFE_WORKFLOW_ID,'2032484067282784257');

const rates=['1/1','12/1','24000/1001','24/1','25/1','30000/1001','30/1','40/1','48/1','50/1','60000/1001','59/1','5999/100'];
for(const fps of rates){
  const x=validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:fps}]});
  assert.equal(x.width,1080);assert.equal(x.height,1920);assert.equal(x.targetFps,60);
  assert.ok(x.sourceFps>=1&&x.sourceFps<60,fps);
  const custom=rifeGraphForSourceFps(graph,x.sourceFps);
  assert.equal(custom['1'].inputs.force_rate,0);
  assert.equal(custom['2'].inputs.source_fps,x.sourceFps);
  assert.equal(custom['2'].inputs.target_fps,60);
  assert.equal(custom['2'].inputs.scale,1);
  assert.equal(custom['3'].inputs.frame_rate,60);
}
assert.equal(graph['2'].inputs.source_fps,30,'Shared graph must remain immutable');
assert.equal(rifeGraphForSourceFps(graph,24)['2'].inputs.source_fps,24);
assert.equal(rifeGraphForSourceFps(graph,50)['2'].inputs.source_fps,50);
for(const fps of ['0/0','0/1','1/2','60/1','120/1','abc','NaN']){
  assert.throws(()=>validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:fps}]}),
    /FPS video/,fps);
}
assert.throws(()=>validateRifeVideoProbe({streams:[]}),/dimensi/);
assert.equal(validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:'0/0',r_frame_rate:'25/1'}]}).sourceFps,25);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rife-queue-'));
try{
  const source=path.join(root,'source.mp4');fs.writeFileSync(source,Buffer.alloc(4096));
  const q=createGenerationQueue({dir:root});
  const id=crypto.randomUUID();
  await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60',mode:'standard'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(q.read(id).image,null,'RIFE must not invent a reference image');
  assert.ok(fs.existsSync(q.read(id).video.path));
  const repeat=await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(repeat.jobId,id,'Idempotency');
  await assert.rejects(q.stage({jobId:crypto.randomUUID(),deviceId:'device123',
    body:{workflow:'r15'},video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}}),/Media/);
  // Real ffprobe confirms that common sub-60 FPS files are accepted.
  for(const inputRate of [24,50]){
    const sample=path.join(root,'video-'+inputRate+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i','color=c=black:s=64x64:r='+inputRate,'-t','0.5',
      '-c:v','libx264','-pix_fmt','yuv420p',sample],{timeout:15000,maxBuffer:65536});
    const real=await verifyRifeInput({path:sample});
    assert.equal(real.sourceFps,inputRate);
    assert.equal(real.targetFps,60);
  }
}finally{fs.rmSync(root,{recursive:true,force:true});}

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(server.includes('workflowId: videoOnly ? RIFE_WORKFLOW_ID : LOCKED_WORKFLOW_ID'));
assert.ok(server.includes("nodeId: '1', fieldName: 'video'"));
assert.ok(server.includes("nodeId: '2', fieldName: 'source_fps', fieldValue: sourceFps"));
assert.ok(server.includes("nodeId: '2', fieldName: 'target_fps', fieldValue: RIFE_TARGET_FPS"));
assert.ok(server.includes('rifeSource=await verifyRifeInput(videoFile);'));
assert.ok(server.includes("rifeGraphForSourceFps(workflowGraphs.rife60,sourceFps)"));
assert.ok(server.includes("...(workflowKey==='rife60'?{}:{retainSeconds:259200})"),
  'RIFE must not retain an extra paid RunningHub machine');
assert.ok(ui.includes("state.workflow==='rife60'||state.image"));
assert.ok(ui.includes("if(state.workflow!=='rife60')fd.append('referenceImage',state.image)"));
assert.ok(html.includes('data-workflow="rife60"'));
assert.ok(html.includes('id="rifeNotice"'));
console.log('PASS: RIFE any source FPS <60→60, original frames/resolution/audio, real ffprobe 24/50, UI, queue and MotionFly fallback.');
