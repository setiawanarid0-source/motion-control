import fs from 'node:fs';
import assert from 'node:assert/strict';
const graph=JSON.parse(fs.readFileSync(new URL('./motionfly-r4-source-camera-adaptive-api.json',import.meta.url),'utf8'));
for(const [id,node] of Object.entries(graph))for(const [k,value] of Object.entries(node.inputs||{}))
 if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))
  assert.ok(graph[value[0]],id+'.'+k+' points to missing node '+value[0]);
assert.deepEqual(graph['89'].inputs.image,['33',0],'driver video must feed both tracking and conditioning');
assert.deepEqual(graph['85'].inputs.images,['89',0],'SAM3 driver tracking must follow source video');
assert.deepEqual(graph['104'].inputs.driving_track_data,['85',0]);
assert.deepEqual(graph['418'].inputs.pose_video,['89',0]);
assert.deepEqual(graph['418'].inputs.pose_video_mask,['104',0]);
assert.deepEqual(graph['418'].inputs.reference_image_mask,['104',1]);
assert.equal(graph['33'].inputs.frame_load_cap,0,'DO NOT hard-cap arbitrary driving video lengths');
assert.equal(graph['33'].inputs.force_rate,35);
assert.deepEqual(graph['490'].inputs.frame_rate,['239',0]);
assert.deepEqual(graph['490'].inputs.audio,['33',2]);
assert.equal(graph['489'].inputs.width,1080);
assert.equal(graph['489'].inputs.height,1920);
assert.equal(graph['489'].inputs.divisible_by,8);
assert.equal(graph['331'].inputs.steps,6);
assert.equal(graph['331'].inputs.cfg,1);
for(const id of ['500','501','492'])assert.ok(!graph[id],'no hardcoded cached masks or universal stabilizer: '+id);
assert.match(graph['3'].inputs.text,/If the driving camera is fixed/i);
assert.match(graph['3'].inputs.text,/If the driving camera deliberately pans/i);
assert.ok(!/completely fixed throughout.*never transfer any camera motion/i.test(graph['3'].inputs.text),'always-static prompt forbidden');
console.log('PASS: arbitrary-length 35 FPS source camera behavior, SAM3 masks per upload, 6-step CFG 1, 1080x1920; experimental graph only.');