import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAkatzContextCandidate,H3_CONTEXT_REQUIREMENT} from '../h3-akatz-context-candidate.js';
import {akatzGraphForInputs,AKATZ_PROFILE,AKATZ_REVISION} from '../h3-akatz-motion.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';

const sourceFor=(frames,hasAudio)=>({...h3PhotoPlan(1143,2048),
  inferenceProfile:AKATZ_PROFILE,totalFrames:frames,fps:24,hasAudio,seed:42});
const argsFor=(frames,hasAudio)=>({source:sourceFor(frames,hasAudio),
  imageName:'api/photo.jpg',videoName:'api/driver.mp4',
  characterLoraFile:'api-lora-usa/'+'a'.repeat(32)+'.safetensors',
  turboLoraFile:'api-lora-usa/'+'b'.repeat(32)+'.safetensors'});
let cases=0;
for(let frames=6;frames<=362;frames++)for(const audio of [false,true]){
  const args=argsFor(frames,audio),before=structuredClone(args);
  const {graph:g,plan:p}=buildAkatzContextCandidate(args);
  assert.deepEqual(args,before,'Building a candidate cannot mutate inputs or the live profile');
  const nodes=Object.values(g),input=id=>g[String(id)].inputs;
  assert.equal(nodes.filter(n=>n.class_type==='SamplerCustomAdvanced').length,1);
  assert.equal(nodes.filter(n=>n.class_type==='VAEDecode').length,1);
  assert.equal(nodes.filter(n=>n.class_type==='MiniMaxH3ReferenceToVideo').length,1);
  assert.equal(nodes.filter(n=>n.class_type==='ImageBatchMulti').length,0);
  assert.equal(nodes.filter(n=>n.class_type==='MiniMaxH3AddGuide'&&n.inputs.image).length,0,
    'Decoded output must never become a later window appearance guide');
  assert.equal(input(1000).frame_load_cap,frames);
  assert.equal(input(1000).skip_first_frames,0);
  assert.equal(input(1000).force_size,'Disabled');
  assert.equal(input(1005).length,p.modelFrames);
  assert.equal(p.modelFrames%17,5);
  assert.ok(p.gridTailFrames>=0&&p.gridTailFrames<17);
  assert.equal(input(1014).batch_index,0);
  assert.equal(input(1014).length,frames,'One contiguous output trim retains each real frame once');
  assert.deepEqual(input(1014).image,['1013',0]);
  assert.deepEqual(input(1015).image,['1014',0]);
  assert.deepEqual(input(490).images,['1015',0]);
  if(p.gridTailFrames){
    assert.equal(input(1001).batch_index,frames-1,'Only repeat the last frame for grid padding');
    assert.equal(input(1002).amount,p.gridTailFrames);
    assert.deepEqual(input(1005)['ref_videos.ref_video_1'],['1003',0]);
  }else{
    assert.equal(g['1001'],undefined);
    assert.equal(g['1002'],undefined);
    assert.equal(g['1003'],undefined);
    assert.deepEqual(input(1005)['ref_videos.ref_video_1'],['1000',0]);
  }
  assert.deepEqual(input(1005)['ref_images.ref_image_1'],['31',0]);
  assert.equal(input(1005).ref_image_size,'max');
  assert.deepEqual([input(1005).width,input(1005).height],[1088,1952]);
  assert.deepEqual([input(1015).width,input(1015).height],[1080,1936]);
  assert.equal(input(41).steps,4);
  assert.equal(input(490).crf,12);
  assert.equal(input(490).frame_rate,24);
  assert.deepEqual(input(41).model,input(1010).model);
  assert.deepEqual(input(1009).noise_seed,['1016',0]);
  assert.equal(input(1016).expression,'42','The candidate is not another seed change');
  assert.equal(g['1004']!==undefined,audio);
  assert.equal(g['1008']!==undefined,audio);
  assert.equal(g['50']!==undefined,audio);
  if(audio){
    for(const id of [50,1004]){
      assert.equal(input(id).start_time,0);
      assert.equal(input(id).duration,frames/24);
    }
    assert.deepEqual(input(490).audio,['50',0]);
  }else assert.equal(input(490).audio,undefined);
  if(frames>124){
    assert.equal(g['12'].class_type,'MiniMaxH3ContextWindows');
    assert.equal(input(12).context_length,124);
    assert.equal(input(12).context_overlap,39);
    assert.equal(input(12).fuse_method,'pyramid');
    assert.equal(input(12).freenoise,false);
    assert.equal(input(12).split_conds_to_windows,false);
    assert.deepEqual(input(12).model,['8',0]);
    assert.deepEqual(input(1010).model,['12',0]);
  }else{
    assert.equal(g['12'],undefined,'Short clips need no temporal patch');
    assert.deepEqual(input(1010).model,['8',0]);
  }
  assert.equal(p.generatedHistoryFrames,0);
  assert.equal(p.productionEnabled,false);
  assert.equal(p.submissionReady,false);
  assert.equal(p.visualAcceptance,'not_rendered');
  assert.equal(p.workBudget.measuredRuntimeSeconds,null);
  assert.equal(p.workBudget.modelCalls,null,'Scheduler steps cannot be presented as model-call budget');
  assert.ok(!nodes.some(n=>/ImageScale|Upscale|Refine|ColorMatch|FaceRestore|BlockSparseAttention/.test(n.class_type)));
  for(const [id,n] of Object.entries(g))for(const value of Object.values(n.inputs))
    if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string')
      assert.ok(g[value[0]],'No stale dependency: '+id+' -> '+value[0]);
  // Every model, appearance instruction and encoder setting is inherited.
  const live=akatzGraphForInputs(args);
  for(const id of ['1','2','3','4','6','7','8','9','30','31','40','85','86','87'])
    assert.deepEqual(g[id],live[id]);
  cases++;
}
const baseline=akatzGraphForInputs(argsFor(361,true));
assert.equal(Object.values(baseline).filter(n=>n.class_type==='SamplerCustomAdvanced').length,3);
assert.equal(baseline['12'],undefined);
assert.equal(AKATZ_REVISION,'akatz-native-1080-v7');
assert.equal(H3_CONTEXT_REQUIREMENT.coreCommit,'6651247a8b50cefd1436c834f704bdf7767722e9');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(!server.includes('h3-akatz-context-candidate'),'Candidate must remain outside the production route');
for(const frames of [0,5,363])assert.throws(()=>buildAkatzContextCandidate(argsFor(frames,false)));
console.log(`H3 context candidate: ${cases} duration/audio cases passed; no provider calls or GPU inference.`);
