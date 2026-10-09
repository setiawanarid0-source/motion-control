import fs from 'node:fs';
import assert from 'node:assert/strict';
const load = p => JSON.parse(fs.readFileSync(new URL('../workflows/' + p, import.meta.url), 'utf8'));
const graphs = {r15: load('r15-api.json'),current: load('current-api.json'),v4: load('koh1-v4-pose-only-api.json')};
for (const [name,g] of Object.entries(graphs)) {
  for (const id of ['30','33','104','418','489','490']) assert.ok(g[id], name+' missing node '+id);
  for (const [id,node] of Object.entries(g)) {
    for (const [field,val] of Object.entries(node.inputs||{})) {
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string' && Number.isInteger(val[1]))
        assert.ok(g[val[0]], name+' broken link at '+id+'.'+field+' -> '+val[0]);
    }
  }
  assert.equal(g['33'].inputs.force_rate,30,name+' requires 30fps');
  assert.equal(g['489'].inputs.width,1080,name+' needs 1080 width');
  assert.equal(g['489'].inputs.height,1920,name+' needs 1920 height');
  assert.deepEqual(g['490'].inputs.frame_rate,['239',0],name+' output FPS must inherit input FPS');
}
const v=graphs.v4;
assert.equal(v['492'].class_type,'DWPreprocessor');
assert.deepEqual(v['492'].inputs.image,['89',0]);
assert.deepEqual(v['493'].inputs.image,['492',0]);
assert.deepEqual(v['418'].inputs.pose_video,['493',0]);
assert.deepEqual(v['418'].inputs.pose_video_mask,['104',0]);
assert.deepEqual(v['418'].inputs.reference_image,['447',0]);
assert.deepEqual(v['418'].inputs.reference_image_mask,['104',1]);
assert.equal(v['271'].inputs.value,false);
assert.equal(v['331'].inputs.cfg,1);
assert.match(v['3'].inputs.text,/LOCKED-OFF TRIPOD CAMERA/);
console.log('PASS: r15,current,v4 graphs; 30 FPS; 1080x1920; all node references; V4 pose/mask/reference wiring.');
