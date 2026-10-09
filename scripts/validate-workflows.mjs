import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=(p)=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const graphs={r15:read('r15-api.json'),current:read('current-api.json'),r4:read('motionfly-r4-sam3-diagnostic-api.json')};
for(const [name,graph] of Object.entries(graphs)){
 for(const [id,node] of Object.entries(graph))for(const [field,value] of Object.entries(node.inputs||{}))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))assert.ok(graph[value[0]],name+' broken reference '+id+'.'+field+'->'+value[0]);
 assert.ok(graph['30']?.class_type==='LoadImage');
 assert.ok(graph['33']?.class_type==='VHS_LoadVideo');
 assert.equal(graph['33'].inputs.force_rate,name==='r4'?35:30,name+' FPS');
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
