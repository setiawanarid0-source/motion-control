import fs from 'node:fs';
import assert from 'node:assert/strict';
const load=p=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const graphs={r15:load('r15-api.json'),current:load('current-api.json'),r2:load('motionfly-r2-hard-background-api.json')};
for(const [name,g] of Object.entries(graphs)){
 for(const id of ['30','33','104','418','489','490']) assert.ok(g[id],name+' missing '+id);
 for(const [id,node] of Object.entries(g)){
  for(const [field,val] of Object.entries(node.inputs||{})){
   if(Array.isArray(val)&&val.length===2&&typeof val[0]==='string'&&Number.isInteger(val[1]))
    assert.ok(g[val[0]],name+' broken link '+id+'.'+field+' -> '+val[0]);
  }
 }
 assert.equal(g['33'].inputs.force_rate,name==='r2'?35:30,name+' wrong FPS');
 assert.equal(g['489'].inputs.width,1080);
 assert.equal(g['489'].inputs.height,1920);
 assert.deepEqual(g['490'].inputs.frame_rate,['239',0]);
}
const g=graphs.r2;
assert.deepEqual(g['418'].inputs.pose_video,['89',0],'R2 must preserve original driving path');
assert.deepEqual(g['490'].inputs.images,['499',0]);
assert.deepEqual(g['492'].inputs.image,['489',0]);
assert.deepEqual(g['495'].inputs.amount,['492',3]);
assert.deepEqual(g['496'].inputs.images,['401',0]);
assert.deepEqual(g['496'].inputs.conditioning,['275',0]);
assert.deepEqual(g['497'].inputs.track_data,['496',0]);
assert.deepEqual(g['498'].inputs.mask,['497',0]);
assert.deepEqual(g['499'].inputs.destination,['495',0]);
assert.deepEqual(g['499'].inputs.source,['492',0]);
assert.deepEqual(g['499'].inputs.mask,['498',0]);
assert.deepEqual(g['494'].inputs.image,['493',0]);
assert.equal(g['490'].inputs.save_output,true);
assert.equal(g['417'].inputs.retain_first_frame,true);
assert.match(g['3'].inputs.text,/CAMERA LOCK/);
assert.equal(g['493'].inputs.image,'UPLOAD_CLEAN_BACKGROUND_REQUIRED.png');
console.log('PASS: R15 and Current unchanged, MotionFly R2 API graph linked, 35fps, 1080x1920, clean plate output composite.');
