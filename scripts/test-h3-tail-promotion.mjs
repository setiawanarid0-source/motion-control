import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {akatzGraphForInputs,akatzExecutionPlan,AKATZ_PROFILE,AKATZ_REVISION} from '../h3-akatz-motion.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/h3-tail-context22-contract.json',import.meta.url),'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
assert.equal(AKATZ_REVISION,'akatz-native-1080-v7');
assert.equal(fixture.candidateCommit,'30d55f366756e7f8cbcb1cc5f6e84840818a1d68');
for(const item of fixture.cases){
  const args={source:{...h3PhotoPlan(...fixture.sourceGeometry),inferenceProfile:AKATZ_PROFILE,
    totalFrames:item.frames,fps:24,hasAudio:item.hasAudio,seed:fixture.seed},
    imageName:'api/photo.jpg',videoName:'api/driver.mp4',
    characterLoraFile:'api-lora-usa/'+'a'.repeat(32)+'.safetensors',
    turboLoraFile:'api-lora-usa/'+'b'.repeat(32)+'.safetensors'};
  const g=akatzGraphForInputs(args),p=akatzExecutionPlan(args.source);
  const hash=createHash('sha256').update(JSON.stringify(canonical(g))).digest('hex');
  assert.equal(hash,item.sha256,'Production must equal the frozen prepared candidate: '+item.frames+'/'+item.hasAudio);
  assert.deepEqual(p.segments.map(s=>[s.start,s.frames,s.loadStart,s.inputFrames,s.modelFrames,s.contextFrames]),item.segments);
  assert.equal(Object.values(g).filter(n=>n.class_type==='VHS_VideoCombine').length,1,'No paired paid comparison in production');
  assert.ok(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length<=3);
  assert.equal(p.workBudget.sampledModelFrames,p.segments.reduce((n,s)=>n+s.modelFrames,0));
  if(item.frames===361){
    assert.deepEqual(p.continuationFramesPerWindow,[0,5,22]);
    assert.equal(p.workBudget.sampledModelFrames,389);
    assert.equal(p.peakWindowFrames,141);
    assert.equal(p.workBudget.measuredRuntimeSeconds,null);
    assert.equal(p.gpuExecutionQualified,false);
  }
}
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(!server.includes('h3-akatz-tail-candidate'),'No diagnostic comparison route is activated');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(html,/Akatz V1\.5 Native · Versi uji v7/);
console.log('PASS: '+fixture.cases.length+' frozen pre-activation candidate contracts; v7 promotes the same graph, keeps one output and three samplers, and labels the owner test version.');

