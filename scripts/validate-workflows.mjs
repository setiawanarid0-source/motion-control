import fs from 'node:fs';
import assert from 'node:assert/strict';
const load=p=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const graphs={r15:load('r15-api.json'),current:load('current-api.json'),r3:load('motionfly-r3-driver-stabilization-api.json')};
for(const [name,graph] of Object.entries(graphs)){
 for(const id of ['30','33','104','418','489','490'])assert.ok(graph[id],name+' missing '+id);
 for(const [id,node] of Object.entries(graph))for(const [field,value] of Object.entries(node.inputs||{}))
  if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))
   assert.ok(graph[value[0]],name+' broken input '+id+'.'+field+' -> '+value[0]);
 assert.equal(graph['33'].inputs.force_rate,name==='r3'?35:30,name+' wrong fps');
 assert.equal(graph['489'].inputs.width,1080,name+' width');
 assert.equal(graph['489'].inputs.height,1920,name+' height');
 assert.deepEqual(graph['490'].inputs.frame_rate,['239',0],name+' output FPS');
}
const m=graphs.r3;
assert.equal(m['492'].class_type,'video_stabilizer_classic');
assert.deepEqual(m['492'].inputs.frames,['33',0]);
assert.deepEqual(m['492'].inputs.frame_rate,['239',0]);
assert.deepEqual(m['89'].inputs.image,['492',0]);
assert.deepEqual(m['418'].inputs.pose_video,['89',0]);
assert.deepEqual(m['490'].inputs.images,['489',0]);
assert.deepEqual(m['492'].inputs,{frames:['33',0],frame_rate:['239',0],framing_mode:'crop_and_pad',transform_mode:'similarity',camera_lock:true,strength:1,smooth:1,keep_fov:0.6,padding_color:'#000000'});
assert.equal(m['417'].inputs.retain_first_frame,true);
assert.match(m['3'].inputs.text,/CAMERA LOCK/);
assert.equal(Object.keys(m).length,40,'R3 API node count (exclude UI Note node and inactive graph)');
assert.ok(!m['493'],'No clean background / placeholder input');
assert.deepEqual(m['490'].inputs.audio,['33',2]);
console.log('PASS: R15 and Current unchanged; MotionFly R3 two-input 35 FPS; stabilizer node 492 -> 89 -> SCAIL-2; 1080x1920; final video/audio wired.');
