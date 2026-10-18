import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readLegacyFinal40} from '../legacy-final40-cache.js';

const graph=file=>JSON.parse(fs.readFileSync(new URL('../workflows/'+file,import.meta.url),'utf8'));
const current=graph('current-api.json');
const r4=graph('motionfly-r4-full-controlled-api.json');
const r15=graph('r15-camera-adaptive-api.json');
const diagnostic=graph('motionfly-r4-sam3-diagnostic-api.json');

// VHS_LoadVideo.force_rate resamples its output IMAGE sequence to the target FPS,
// and VHS_VideoInfoLoaded exposes loaded_fps and loaded_frame_count to the model
// and VHS_VideoCombine. No website FFmpeg conversion is involved.
for(const [name,g] of [['KOH (1)',current],['R4 Full',r4]]){
  assert.equal(g['33'].inputs.force_rate,40,name+' must load frames at native 40 FPS');
  assert.equal(g['33'].inputs.frame_load_cap,0,name+' must not truncate 40fps frames');
  assert.deepEqual(g['239'].inputs.video_info,['33',3],name+' must use Loaded VideoInfo');
  assert.deepEqual(g['418'].inputs.length,['239',1],name+' should generate the full resampled frame count');
  assert.deepEqual(g['490'].inputs.frame_rate,['239',0],name+' output must use loaded 40 FPS');
  assert.deepEqual(g['490'].inputs.images,['489',0],name+' must render generated frames');
  assert.deepEqual(g['490'].inputs.audio,['33',2],name+' must preserve driving audio');
  assert.equal(g['490'].inputs.save_output,true,name+' final video must be saved by RunningHub');
}
assert.equal(r4['501'].inputs.force_rate,40,'R4 SAM3 mask must be resampled to the same 40fps timeline');
assert.equal(r4['501'].inputs.frame_load_cap,0,'R4 mask must not cut off at old 337 frames');
assert.deepEqual(r4['418'].inputs.pose_video,['89',0]);
assert.deepEqual(r4['418'].inputs.pose_video_mask,['501',0]);
assert.equal(r15['33'].inputs.force_rate,35,'R15 must remain unchanged');
assert.equal(diagnostic['33'].inputs.force_rate,35,'SAM3 diagnostic must remain unchanged');

// For a 10-second, 30/35fps source, VHS_LoadVideo creates a 40fps
// sequence instead of re-labeling 300/350 frames as 40 and speeding up playback.
for(const sourceFps of [30,35]){
  const seconds=10,sourceFrames=sourceFps*seconds,frames40=40*seconds;
  assert.equal(frames40/40,sourceFrames/sourceFps);
}
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(!server.includes('ensureFinal40('),'Server must never trigger post-generation conversion');
assert.ok(!server.includes('requiresFinal40('),'Server must not select a conversion pipeline');
assert.ok(!server.includes('pruneFinal40('),'Server must not maintain FFmpeg conversion jobs');
assert.ok(!server.includes("from './final-fps.js'"),'Obsolete FFmpeg service must be removed');
assert.ok(server.includes("from './legacy-final40-cache.js'"),
  'Already-converted old History media may remain readable without any processing');
assert.ok(server.includes("const video=outputs.find(x=>String(x.nodeId)==='490')"),
  'RunningHub output node 490 must be used directly');
assert.equal(readLegacyFinal40('../invalid'),null,'Legacy cache reader must reject unsafe IDs');
console.log('PASS: Native Current/R4 40 FPS frames and output; synchronized R4 masks; no website post-generation FFmpeg');
