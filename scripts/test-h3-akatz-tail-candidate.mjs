import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAkatzTailContextCandidate,buildAkatzTailPairedComparison,H3_TAIL_CONTEXT_CANDIDATE} from '../h3-akatz-tail-candidate.js';
import {akatzGraphForInputs,akatzExecutionPlan,AKATZ_PROFILE} from '../h3-akatz-motion.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
const argsFor=(frames,hasAudio)=>({source:{...h3PhotoPlan(1536,2752),
  inferenceProfile:AKATZ_PROFILE,totalFrames:frames,fps:24,hasAudio,seed:1234},
  imageName:'api/photo.jpg',videoName:'api/driver.mp4',
  characterLoraFile:'api-lora-usa/'+'a'.repeat(32)+'.safetensors',
  turboLoraFile:'api-lora-usa/'+'b'.repeat(32)+'.safetensors'});
let cases=0;
for(let frames=6;frames<=362;frames++)for(const audio of [false,true]){
  const args=argsFor(frames,audio),original=structuredClone(args);
  const baseline=akatzGraphForInputs(args),basePlan=akatzExecutionPlan(args.source);
  const {graph:g,plan:p}=buildAkatzTailContextCandidate(args);
  assert.deepEqual(args,original);
  assert.equal(p.revision,H3_TAIL_CONTEXT_CANDIDATE);
  assert.equal(p.productionEnabled,false);assert.equal(p.submissionReady,false);
  assert.equal(p.visualAcceptance,'not_rendered');
  assert.deepEqual(Object.keys(g).sort(),Object.keys(baseline).sort(),'No additional nodes/models/samplers');
  assert.equal(p.samplerCount,basePlan.samplerCount);
  assert.equal(p.workBudget.totalSteps,basePlan.workBudget.totalSteps);
  assert.ok(p.workBudget.totalSteps<=12);assert.ok(p.peakWindowFrames<=141);
  if(basePlan.samplerCount<3){
    assert.equal(p.applied,false);assert.deepEqual(g,baseline);
  }else{
    assert.equal(p.applied,true);
    assert.deepEqual(p.segments.slice(0,2),basePlan.segments.slice(0,2));
    for(const [id,n] of Object.entries(g))if(Number(id)<1080&&id!=='490')
      assert.deepEqual(n,baseline[id],'The first two windows and global recipe must be byte-identical');
    const s=p.segments[2],old=basePlan.segments[2],prev=p.segments[1];
    assert.equal(s.contextFrames,22);assert.equal(s.loadStart,old.loadStart-17);
    assert.equal(s.modelFrames,old.modelFrames+17);
    assert.equal(s.modelFrames-s.inputFrames,old.modelFrames-old.inputFrames,'No extra padding');
    assert.equal(s.loadStart,prev.loadStart+prev.modelFrames-22);
    assert.equal(prev.inputFrames,prev.modelFrames,'Raw history must be all real');
    assert.deepEqual(g['1087'].inputs.context_latent,['1051',0]);
    assert.deepEqual(g['1087'].inputs.conditioning,['1085',0]);
    assert.equal(g['1094'].inputs.batch_index,22);
    assert.equal(g['1094'].inputs.length,old.frames);
    assert.deepEqual(g['1096'],baseline['1096'],'Seed transport is unchanged');
    assert.deepEqual(g['1085'].inputs['ref_images.ref_image_1'],['31',0]);
    if(audio){
      assert.equal(g['1088'].inputs.frame_idx,22);
      assert.deepEqual(g['1097'],baseline['1097'],'New-frame source audio timing cannot move');
      assert.deepEqual(g['50'],baseline['50']);
      assert.deepEqual(g['490'].inputs.audio,['50',0]);
    }
    const out={...g['490'].inputs};out.filename_prefix=baseline['490'].inputs.filename_prefix;
    assert.deepEqual(out,baseline['490'].inputs,'No output filtering, resizing or encoder changes');
  }
  const timeline=[];
  for(const [i,s] of p.segments.entries()){
    const b=1000+i*40;
    assert.equal(g[String(b)].inputs.skip_first_frames,s.loadStart);
    assert.equal(g[String(b)].inputs.frame_load_cap,s.inputFrames);
    assert.equal(g[String(b+5)].inputs.length,s.modelFrames);
    assert.equal(s.modelFrames%17,5);
    assert.equal(g[String(b+14)].inputs.length,s.frames);
    for(let j=0;j<s.frames;j++)timeline.push(s.loadStart+s.contextFrames+j);
  }
  assert.deepEqual(timeline,Array.from({length:frames},(_,i)=>i),'Each original source time exactly once');
  assert.ok(!Object.values(g).some(n=>/Refine|ImageScale|Upscale|ColorMatch|Sharpen/.test(n.class_type)));
  for(const [id,n] of Object.entries(g))for(const v of Object.values(n.inputs))
    if(Array.isArray(v)&&typeof v[0]==='string')assert.ok(g[v[0]],'Missing dependency '+id);
  cases++;
}
const p=buildAkatzTailContextCandidate(argsFor(361,true)).plan;
assert.deepEqual(p.segments.map(s=>[s.start,s.frames,s.loadStart,s.inputFrames,s.modelFrames,s.contextFrames]),
  [[0,124,0,124,124,0],[124,119,119,124,124,5],[243,118,221,140,141,22]]);
assert.equal(p.workBudget.baselineModelFrames,372);
assert.equal(p.workBudget.candidateModelFrames,389);
for(const audio of [false,true]){
  const args=argsFor(361,audio),base=akatzGraphForInputs(args);
  const {graph:g,plan:p}=buildAkatzTailPairedComparison(args);
  assert.equal(p.totalSteps,16);assert.equal(p.samplerCount,4);assert.equal(p.sharedOutputFrames,243);
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,4);
  assert.equal(Object.values(g).filter(n=>n.class_type==='VHS_VideoCombine').length,2);
  for(const [id,n] of Object.entries(base))if(id!=='490')assert.deepEqual(g[id],n);
  for(const id of ['1011','1051'])assert.equal(Object.keys(g).filter(k=>k===id).length,1);
  assert.deepEqual(g['49'].inputs.image_1,g['2049'].inputs.image_1);
  assert.deepEqual(g['49'].inputs.image_2,g['2049'].inputs.image_2);
  assert.deepEqual(g['49'].inputs.image_3,['1095',0]);
  assert.deepEqual(g['2049'].inputs.image_3,['2095',0]);
  assert.deepEqual(g['1087'].inputs.context_latent,['1051',0]);
  assert.deepEqual(g['2087'].inputs.context_latent,['1051',0]);
  assert.deepEqual(g['2091'].inputs.noise,g['1091'].inputs.noise);
  assert.equal(g['2089'],undefined);assert.equal(g['2096'],undefined);
  assert.equal(g['2087'].inputs.context_length,'22');
  assert.equal(g['2094'].inputs.batch_index,22);
  assert.equal(g['2094'].inputs.length,118);
  if(audio)assert.deepEqual(g['2088'].inputs.audio,['1097',0]);
  for(const [id,n] of Object.entries(g))for(const v of Object.values(n.inputs))
    if(Array.isArray(v)&&typeof v[0]==='string')assert.ok(g[v[0]],'Missing paired dependency '+id);
}
assert.throws(()=>buildAkatzTailPairedComparison(argsFor(124,false)));
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(!server.includes('h3-akatz-tail-candidate'),'No connection to live generation');
console.log('PASS: '+cases+' tail-context duration/audio cases; first two windows identical, exact native timeline, no extra sampler or live activation; appearance/memory/runtime remain unqualified');

