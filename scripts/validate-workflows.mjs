import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=(p)=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const graphs={r15:read('r15-camera-adaptive-api.json'),current:read('current-api.json'),r4:read('motionfly-r4-sam3-diagnostic-api.json')};
for(const [name,graph] of Object.entries(graphs)){
 for(const [id,node] of Object.entries(graph))for(const [field,value] of Object.entries(node.inputs||{}))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))assert.ok(graph[value[0]],name+' broken reference '+id+'.'+field+'->'+value[0]);
 assert.ok(graph['30']?.class_type==='LoadImage');
 assert.ok(graph['33']?.class_type==='VHS_LoadVideo');
 assert.equal(graph['33'].inputs.force_rate,name==='current'?30:35,name+' FPS');
}
for(const name of ['r15','current']){
 const g=graphs[name];
 for(const id of ['104','418','331','489','490'])assert.ok(g[id],name+' changed');
 assert.equal(g['489'].inputs.width,1080);
 assert.equal(g['489'].inputs.height,1920);
}
const g=graphs.r4;
for(const id of ['30','33','85','86','87','89','91','104','239','393','394'])assert.ok(g[id],'diagnostic node '+id+' absent');
for(const id of ['331','418','417','490','492'])assert.ok(!g[id],'must NOT generate or stabilize: '+id);
assert.equal(g['393'].class_type,'VHS_VideoCombine');
assert.equal(g['393'].inputs.save_output,true);
assert.deepEqual(g['393'].inputs.images,['104',0]);
assert.deepEqual(g['393'].inputs.frame_rate,['239',0]);
assert.equal(g['394'].class_type,'SaveImage');
assert.deepEqual(g['394'].inputs.images,['104',1]);
assert.deepEqual(g['89'].inputs.image,['33',0]);
assert.deepEqual(g['85'].inputs.images,['89',0]);
assert.deepEqual(g['104'].inputs.driving_track_data,['85',0]);
assert.deepEqual(g['104'].inputs.ref_track_data,['91',0]);
assert.ok(Object.keys(g).length<40);
console.log('PASS: R15 & Current remain full generation, R4 mask-only API graph has dual outputs and no sampler or stabilizer.');

// R4 Full Controlled Test: only the two public media inputs; masks are reused from a completed SAM3 task.
const full=read('motionfly-r4-full-controlled-api.json');
for(const [id,node] of Object.entries(full))for(const [field,v] of Object.entries(node.inputs||{}))if(Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1]))assert.ok(full[v[0]],'R4 Full broken reference '+id+'.'+field);
for(const id of ['30','33','331','418','489','490','500','501'])assert.ok(full[id], 'R4 Full missing '+id);
assert.deepEqual(full['418'].inputs.pose_video_mask,['501',0]);
assert.deepEqual(full['418'].inputs.reference_image_mask,['500',0]);
assert.equal(full['33'].inputs.frame_load_cap,337);
assert.equal(full['501'].inputs.frame_load_cap,337);
assert.equal(full['33'].inputs.force_rate,35);
assert.equal(full['489'].inputs.divisible_by,8);
assert.equal(full['489'].inputs.width,1080);
assert.equal(full['489'].inputs.height,1920);
assert.equal(full['331'].inputs.steps,6);
assert.equal(full['331'].inputs.cfg,1);
assert.ok(!full['492'],'Stabilizer must not be included');
console.log('PASS: R4 Full Controlled Test has 337 synchronized frames, two cached masks, 6-step CFG1 and 1080×1920 output.');

const adapted=graphs.r15;
assert.equal(adapted['33'].inputs.frame_load_cap,0,'R15 Camera Engine must not hard-limit length');
assert.deepEqual(adapted['418'].inputs.pose_video_mask,['104',0]);
assert.deepEqual(adapted['418'].inputs.reference_image_mask,['104',1]);
assert.equal(adapted['489'].inputs.divisible_by,8);
assert.equal(adapted['331'].inputs.steps,6);assert.equal(adapted['331'].inputs.cfg,1);
assert.ok(!adapted['492'],'No Video Stabilizer Classic');
console.log('PASS: R15 camera-aware graph, Current & other graphs preserved.');
