import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateRifeVideoProbe,rifeGraphForSourceFps,verifyRifeInput,RIFE_TARGET_FPS} from '../rife-video.js';
import {createGenerationQueue} from '../generation-queue.js';

const graph=JSON.parse(fs.readFileSync(new URL('../workflows/rife60-api.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(graph),['1','2','3']);
assert.equal(graph['1'].class_type,'VHS_LoadVideo');
assert.equal(graph['1'].inputs.force_rate,0,'must read real source FPS, not force a 30 FPS source');
assert.equal(graph['1'].inputs.force_size,'Disabled');
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

const rates=['1/1','12/1','24000/1001','24/1','25/1','30000/1001',
  '30/1','40/1','48/1','50/1','60000/1001','59/1','59999/1000'];
for(const value of rates){
  const x=validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:value,r_frame_rate:value}]});
  assert.equal(x.width,1080);assert.equal(x.height,1920);assert.equal(x.targetFps,60);
  assert.ok(x.sourceFps>0&&x.sourceFps<60,value);
  const custom=rifeGraphForSourceFps(graph,x.sourceFps);
  assert.equal(custom['1'].inputs.force_rate,0);
  assert.equal(custom['2'].inputs.source_fps,x.sourceFps);
  assert.equal(custom['2'].inputs.target_fps,60);
  assert.equal(custom['3'].inputs.frame_rate,60);
}
assert.equal(graph['2'].inputs.source_fps,30,'Shared template unchanged for concurrent tasks');
assert.equal(rifeGraphForSourceFps(graph,24)['2'].inputs.source_fps,24);
assert.equal(rifeGraphForSourceFps(graph,50)['2'].inputs.source_fps,50);
assert.throws(()=>validateRifeVideoProbe({streams:[]}),/dimensi/);
for(const v of ['60/1','120/1'])
  assert.throws(()=>validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:v,r_frame_rate:v}]}),
    /di bawah 60/,'60+ source must be explicitly rejected, never converted to 30');
for(const v of ['0/0','N/A']){
  assert.throws(()=>validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:v,r_frame_rate:v}]}),
    /tidak dapat dibaca/,'Unreadable FPS must be rejected rather than fabricated');
}
const falseHeader=validateRifeVideoProbe({streams:[{
  width:1920,height:1080,avg_frame_rate:'60/1',r_frame_rate:'60/1',
  nb_read_packets:'300',duration:'10'
}]});
assert.equal(falseHeader.sourceFps,30,'Confirmed 300 frames over 10sec overrides false 60 FPS header');
assert.equal(falseHeader.detectionMethod,'counted_frames');
const variable=validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:'30/1',r_frame_rate:'120/1'}]});
assert.equal(variable.sourceFps,30,'Do not force VFR to 30; the actual average happens to be 30');
assert.equal(variable.variableFrameRate,true);
const recovered=validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:'0/0',r_frame_rate:'25/1'}]});
assert.equal(recovered.sourceFps,25);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rife-no-conversion-'));
try{
  const source=path.join(dir,'source.mp4');fs.writeFileSync(source,Buffer.alloc(4096));
  const q=createGenerationQueue({dir});
  const id=crypto.randomUUID();
  await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60',mode:'standard'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(q.read(id).image,null);
  assert.ok(fs.existsSync(q.read(id).video.path));
  const repeat=await q.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(repeat.jobId,id);
  await assert.rejects(q.stage({jobId:crypto.randomUUID(),deviceId:'device123',
    body:{workflow:'r15'},video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}}),/Media/);

  for(const fps of [24,25,30,40,50,60,120]){
    const input=path.join(dir,'video-'+fps+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i','color=c=black:s=64x64:r='+fps,'-t','1',
      '-c:v','libx264','-pix_fmt','yuv420p',input],{timeout:30000,maxBuffer:65536});
    const originalBytes=fs.readFileSync(input);
    if(fps<60){
      const result=await verifyRifeInput({path:input});
      assert.equal(result.sourceFps,fps);
      assert.equal(result.width,64);assert.equal(result.height,64);
      assert.equal(result.targetFps,60);
    }else{
      await assert.rejects(verifyRifeInput({path:input}),/di bawah 60/);
    }
    assert.deepEqual(fs.readFileSync(input),originalBytes,'Source must never be modified');
  }
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(server.includes('workflowId: LOCKED_WORKFLOW_ID,'));
assert.ok(server.includes("nodeId: '2', fieldName: 'source_fps', fieldValue: sourceFps"));
assert.ok(server.includes("nodeId: '2', fieldName: 'target_fps', fieldValue: RIFE_TARGET_FPS"));
assert.ok(server.includes('rifeSource=await verifyRifeInput(videoFile);'));
assert.ok(server.includes('videoFile:preparedMotion?.file||videoFile,'));
assert.ok(!server.includes('rifeSource?.file'),'RIFE must upload original source');
assert.ok(!server.includes('prepareRifeSource'),'RIFE must not create local FPS converted video');
const sourceCode=fs.readFileSync(new URL('../rife-video.js',import.meta.url),'utf8');
assert.ok(!sourceCode.includes('execFileAsync(\'ffmpeg\''),'RIFE preflight must not transcode source');
assert.ok(!sourceCode.includes('FALLBACK_RATE'),'RIFE preflight must not invent a 30 FPS fallback');
assert.ok(app.includes("state.workflow==='rife60'||state.image"));
assert.ok(html.includes('data-workflow="rife60"'));
console.log('PASS: RIFE reads native FPS from original video, no 30fps fallback/transcode, rejects 60+ explicitly, preserves MotionFly and queue.');
