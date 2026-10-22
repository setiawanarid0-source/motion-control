import assert from 'node:assert/strict';
import { buildCharacterSwapWorkflow, CHARACTER_SWAP_NATIVE_FPS, CHARACTER_SWAP_FRAME_CAP } from '../character-swap.js';

const first=buildCharacterSwapWorkflow({imageName:'ref-alpha.png',videoName:'guide-alpha.mp4'});
const second=buildCharacterSwapWorkflow({imageName:'ref-bravo.webp',videoName:'guide-bravo.mov'});
const graph=first.graph;
assert.equal(Object.keys(graph).length,25);
assert.equal(graph['1283'].class_type,'BFSShotPlanner');
assert.equal(graph['1267'].class_type,'LoraLoaderModelOnly');
assert.match(graph['1267'].inputs.lora_name,/character_swap_v1\\.1/);
assert.equal(graph['1177'].inputs.guide_mode,'aligned guide (Add Guide)');
assert.equal(graph['751'].class_type,'VHS_VideoCombine');
assert.equal(graph['1202'].inputs.crossfade,0);
assert.equal(graph['1202'].inputs.comparison,false);
assert.equal(graph['181'].inputs.steps,8);
assert.equal(CHARACTER_SWAP_NATIVE_FPS,24);
assert.equal(CHARACTER_SWAP_FRAME_CAP,360);
for(const current of [first,second]){
 const plan=JSON.parse(current.graph['1283'].inputs.plan);
 assert.equal(plan.fps,24);
 assert.equal(plan.end_f,360);
 assert.equal(plan.second_pass.enabled,false);
 assert.equal(plan.auto_prompt.enabled,false);
 assert.deepEqual(plan.auto_prompts,{});
 assert.deepEqual(plan.ref_details,{});
 assert.deepEqual(plan.picture_details,{});
 assert.deepEqual(plan.global_refs,[plan.global_ref]);
 assert.equal(plan.global_prompt,current.graph['1270'].inputs.value);
 assert.equal(current.nodeInfoList[0].fieldValue,current.graph['1283'].inputs.plan);
 assert.ok(!JSON.stringify(current.graph).includes('Klickpin.com'));
 assert.ok(!JSON.stringify(current.graph).includes('11_lin_seven_view'));
 for(const [id,node] of Object.entries(current.graph)){
  for(const [field,val] of Object.entries(node.inputs||{}))
   if(Array.isArray(val)&&val.length===2&&typeof val[0]==='string'&&Number.isInteger(val[1]))
    assert.ok(current.graph[val[0]],id+'.'+field+' has dangling dependency '+val[0]);
 }
}
assert.equal(JSON.parse(first.graph['1283'].inputs.plan).video,'guide-alpha.mp4');
assert.equal(JSON.parse(second.graph['1283'].inputs.plan).video,'guide-bravo.mov');
assert.notEqual(first.graph['1283'].inputs.plan,second.graph['1283'].inputs.plan);
assert.throws(()=>buildCharacterSwapWorkflow({imageName:'',videoName:'test.mp4'}));
console.log('Character Swap: isolated inputs, graph references, no old cache, fixed prompt and 24fps verified.');
