import fs from 'node:fs';
import assert from 'node:assert/strict';
const load=p=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const graphs={r15:load('r15-api.json'),current:load('current-api.json'),motionfly:load('motionfly-camera-static-api.json')};
for(const [name,g] of Object.entries(graphs)){
 for(const id of ['30','33','104','418','489','490']) assert.ok(g[id],name+' missing '+id);
 for(const [id,node] of Object.entries(g))for(const [field,val] of Object.entries(node.inputs||{}))
  if(Array.isArray(val)&&val.length===2&&typeof val[0]==='string'&&Number.isInteger(val[1]))
   assert.ok(g[val[0]],name+' broken link '+id+'.'+field+' -> '+val[0]);
 assert.equal(g['33'].inputs.force_rate,name==='motionfly'?35:30,name+' wrong fps');
 assert.equal(g['489'].inputs.width,1080);assert.equal(g['489'].inputs.height,1920);
 assert.deepEqual(g['490'].inputs.frame_rate,['239',0]);
}
const m=graphs.motionfly;
assert.deepEqual(m['418'].inputs.pose_video,['89',0]);
assert.deepEqual(m['490'].inputs.images,['489',0]);
assert.equal(m['417'].inputs.retain_first_frame,true);
for(let i=492;i<=499;i++)assert.ok(!m[String(i)],'Unexpected R2 composite node '+i);
assert.match(m['3'].inputs.text,/CAMERA LOCK/);
console.log('PASS: two-input MotionFly 35 fps; R15/Current unchanged; output receives generated video directly; no clean-background dependency.');
