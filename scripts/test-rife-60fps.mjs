import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateRifeVideoProbe,rifeGraphForSourceFps,verifyRifeInput,prepareRifeSource,RIFE_TARGET_FPS} from '../rife-video.js';
import {createGenerationQueue} from '../generation-queue.js';

const graph=JSON.parse(fs.readFileSync(new URL('../workflows/rife60-api.json',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(graph),['1','2','3']);
assert.equal(graph['1'].class_type,'VHS_LoadVideo');
assert.equal(graph['1'].inputs.force_rate,0);
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

for(const value of ['1/1','12/1','24000/1001','24/1','25/1','30000/1001',
  '30/1','40/1','48/1','50/1','60000/1001','59/1','5999/100']){
  const x=validateRifeVideoProbe({streams:[{width:1080,height:1920,avg_frame_rate:value,r_frame_rate:value}]});
  assert.equal(x.width,1080);assert.equal(x.height,1920);
  assert.equal(x.targetFps,60);
  assert.ok(x.sourceFps>=1&&x.sourceFps<60,value);
  assert.equal(x.needsNormalization,false,value);
  const customized=rifeGraphForSourceFps(graph,x.sourceFps);
  assert.equal(customized['1'].inputs.force_rate,0);
  assert.equal(customized['2'].inputs.source_fps,x.sourceFps);
  assert.equal(customized['2'].inputs.target_fps,60);
  assert.equal(customized['3'].inputs.frame_rate,60);
}
assert.equal(graph['2'].inputs.source_fps,30,'Shared graph must not mutate');
assert.equal(rifeGraphForSourceFps(graph,24)['2'].inputs.source_fps,24);
assert.equal(rifeGraphForSourceFps(graph,50)['2'].inputs.source_fps,50);
assert.throws(()=>validateRifeVideoProbe({streams:[]}),/dimensi/);
// Regression: a nominal 60/120/0FPS container is NOT automatically rejected.
for(const fps of ['60/1','120/1','0/0','NaN']){
  const input=validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:fps,r_frame_rate:fps}]});
  assert.equal(input.sourceFps,30,'Inconsistent metadata has a safe processing rate');
  assert.equal(input.needsNormalization,true,'Do not send misleading FPS to the GPU');
}
const counted=validateRifeVideoProbe({streams:[{
  width:1920,height:1080,avg_frame_rate:'60/1',r_frame_rate:'60/1',
  nb_read_packets:'300',duration:'10'
}]});
assert.equal(counted.sourceFps,30,'Measured 300 frames/10 seconds must override wrong 60FPS header');
assert.equal(counted.needsNormalization,true,'Header disagreeing with measured FPS gets corrected via CFR');
const vfr=validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:'30/1',r_frame_rate:'120/1'}]});
assert.equal(vfr.sourceFps,30);assert.equal(vfr.needsNormalization,true);
const missingAverage=validateRifeVideoProbe({streams:[{width:720,height:1280,avg_frame_rate:'0/0',r_frame_rate:'25/1'}]});
assert.equal(missingAverage.sourceFps,25);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rife-queue-'));
try{
  const source=path.join(root,'source.mp4');fs.writeFileSync(source,Buffer.alloc(4096));
  const queue=createGenerationQueue({dir:root});
  const id=crypto.randomUUID();
  await queue.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60',mode:'standard'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(queue.read(id).image,null);
  assert.ok(fs.existsSync(queue.read(id).video.path));
  const repeat=await queue.stage({jobId:id,deviceId:'device123',body:{workflow:'rife60'},
    video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}});
  assert.equal(repeat.jobId,id);
  await assert.rejects(queue.stage({jobId:crypto.randomUUID(),deviceId:'device123',
    body:{workflow:'r15'},video:{path:source,originalname:'video.mp4',mimetype:'video/mp4',size:4096}}),/Media/);

  // Verify real 24/50 FPS videos stay untouched and 60/120 FPS no longer fail
  // early: they are normalized to 30 FPS with the SAME resolution and duration.
  for(const inputRate of [24,50,60,120]){
    const input=path.join(root,'input-'+inputRate+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i','color=c=black:s=64x64:r='+inputRate,'-t','1',
      '-c:v','libx264','-pix_fmt','yuv420p',input],{timeout:30000,maxBuffer:65536});
    const checked=await verifyRifeInput({path:input});
    const prepared=await prepareRifeSource({path:input,size:fs.statSync(input).size,
      originalname:'input.mp4',mimetype:'video/mp4'});
    try{
      assert.equal(prepared.width,64);assert.equal(prepared.height,64);
      assert.equal(prepared.targetFps,60);
      if(inputRate<60){
        assert.equal(checked.sourceFps,inputRate);
        assert.equal(prepared.sourceFps,inputRate);
        assert.equal(prepared.file.path,input);
      }else{
        assert.ok(prepared.needsNormalization);
        assert.equal(prepared.sourceFps,30);
        assert.notEqual(prepared.file.path,input);
        assert.ok(fs.existsSync(prepared.file.path));
        const info=JSON.parse(String(execFileSync('ffprobe',['-v','error',
          '-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,duration',
          '-of','json',prepared.file.path])));
        assert.equal(info.streams[0].width,64);
        assert.equal(info.streams[0].height,64);
        assert.equal(info.streams[0].avg_frame_rate,'30/1');
        assert.ok(Math.abs(Number(info.streams[0].duration)-1)<0.08,'Duration stays 1 second');
      }
    }finally{await prepared.release();}
    if(inputRate>=60)assert.equal(fs.existsSync(prepared.file.path),false,'No lingering temporary video');
  }
}finally{fs.rmSync(root,{recursive:true,force:true});}

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(server.includes('workflowId: LOCKED_WORKFLOW_ID,'));
assert.ok(server.includes("nodeId: '2', fieldName: 'source_fps', fieldValue: sourceFps"));
assert.ok(server.includes("nodeId: '2', fieldName: 'target_fps', fieldValue: RIFE_TARGET_FPS"));
assert.ok(server.includes('rifeSource=await prepareRifeSource(videoFile);'));
assert.ok(server.includes('videoFile:preparedMotion?.file||rifeSource?.file||videoFile,'));
assert.ok(server.includes('rifeGraphForSourceFps(workflowGraphs.rife60,sourceFps)'));
assert.ok(server.includes("...(workflowKey==='rife60'?{}:{retainSeconds:259200})"));
assert.ok(ui.includes("state.workflow==='rife60'||state.image"));
assert.ok(html.includes('data-workflow="rife60"'));
console.log('PASS: RIFE detects timestamp rate correctly, rescues 60+ / invalid headers without upscale, preserves native 24/50, queue/history isolated.');
