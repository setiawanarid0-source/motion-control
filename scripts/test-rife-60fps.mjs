import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateRifeVideoProbe} from '../rife-video.js';
import {createGenerationQueue} from '../generation-queue.js';

const graph=JSON.parse(fs.readFileSync(new URL('../workflows/rife60-api.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(graph),['1','2','3']);
assert.equal(graph['1'].class_type,'VHS_LoadVideo');
assert.equal(graph['1'].inputs.force_rate,30);
assert.equal(graph['1'].inputs.force_size,'Disabled');
assert.equal(graph['1'].inputs.custom_width,0);
assert.equal(graph['1'].inputs.custom_height,0);
assert.equal(graph['1'].inputs.frame_load_cap,0);
assert.equal(graph['2'].class_type,'RIFE VFI');
assert.equal(graph['2'].inputs.multiplier,2);
assert.equal(graph['2'].inputs.scale_factor,1);
assert.deepEqual(graph['2'].inputs.frames,['1',0]);
assert.equal(graph['3'].class_type,'VHS_VideoCombine');
assert.deepEqual(graph['3'].inputs.images,['2',0]);
assert.deepEqual(graph['3'].inputs.audio,['1',2]);
assert.equal(graph['3'].inputs.frame_rate,60);
assert.equal(graph['3'].inputs.save_output,true);
assert.ok(Object.values(graph).every(x=>!/Upscale|Resize|MotionFly|KSampler/i.test(x.class_type)));
for(const node of Object.values(graph))
  for(const value of Object.values(node.inputs||{}))
    if(Array.isArray(value)&&typeof value[0]==='string'&&Number.isInteger(value[1]))
      assert.ok(graph[value[0]],'Broken link '+value[0]);

for(const fps of ['30/1','30000/1001']){
  const x=validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:fps}]});
  assert.equal(x.width,1080);assert.equal(x.height,1920);assert.equal(x.targetFps,60);
}
for(const fps of ['25/1','60/1','0/0','abc']){
  assert.throws(()=>validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:fps}]}),/30 FPS/);
}
assert.throws(()=>validateRifeVideoProbe({streams:[]}),/dimensi/);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rife-queue-'));
try{
  const source=path.join(root,'source.mp4');fs.writeFileSync(source,Buffer.alloc(4096));
  const q=createGenerationQueue({dir:root});
  const id=crypto.randomUUID();
  await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60',mode:'standard'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(q.read(id).image,null,'RIFE must never require or invent a reference image');
  assert.ok(fs.existsSync(q.read(id).video.path));
  const repeat=await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(repeat.jobId,id,'Idempotency');
  await assert.rejects(q.stage({jobId:crypto.randomUUID(),deviceId:'device123',
    body:{workflow:'r15'},video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}}),/Media/);
}finally{fs.rmSync(root,{recursive:true,force:true});}

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(server.includes('workflowId: videoOnly ? RIFE_WORKFLOW_ID : LOCKED_WORKFLOW_ID'));
assert.ok(server.includes("nodeId: '1', fieldName: 'video'"));
assert.ok(server.includes('if(videoOnly)await verifyRifeInput(videoFile);'));
assert.ok(ui.includes("state.workflow==='rife60'||state.image"));
assert.ok(ui.includes("if(state.workflow!=='rife60')fd.append('referenceImage',state.image)"));
assert.ok(html.includes('data-workflow="rife60"'));
assert.ok(html.includes('id="rifeNotice"'));
console.log('PASS: RIFE frame doubling and native resolution, 30fps preflight, video-only queue, UI, and unchanged motion workflow fallback.');
