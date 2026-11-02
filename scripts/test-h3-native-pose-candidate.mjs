import assert from 'node:assert/strict';
import {h3PhotoPlan,h3Segments,h3GraphForInputs,h3ExecutionPlan,H3_REVISION,H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {nativePoseCandidateGraph,NATIVE_POSE_MODELS} from '../h3-native-pose-candidate.js';
for(const totalFrames of [6,22,120,124,125,361,1440]){
 const source={...h3PhotoPlan(1536,2752),fps:24,totalFrames,hasAudio:true},segments=h3Segments(totalFrames,[],5);
 const g=nativePoseCandidateGraph({imageName:'api/current-photo.jpg',videoName:'api/current-guide.mp4',source,segments});
 assert.equal(g['30'].inputs.image,'api/current-photo.jpg');assert.deepEqual(g['86'].inputs.image,['30',0]);
 let exported=0;
 for(const [i,s] of segments.entries()){
  const b=1000+30*i,patch=g[b+8];
  assert.equal(patch.class_type,'MiniMaxH3FunControlNetApply');
  assert.deepEqual(patch.inputs.control_video,[String(b+7),0]);assert.equal(g[b+7].class_type,'SDPoseDrawKeypoints');
  assert.equal(patch.inputs.source_video,undefined);assert.equal(patch.inputs.mask,undefined);
  assert.deepEqual(g[b+9].inputs['ref_images.ref_image_1'],['31',0]);
  assert.ok(!Object.keys(g[b+9].inputs).some(k=>k.startsWith('ref_videos')));
  assert.deepEqual(g[b+10].inputs.model,g[b+14].inputs.model);
  assert.equal(g[b+10].inputs.steps,4);assert.equal(g[b+17].inputs.length,s.length);exported+=s.length;
  assert.deepEqual([g[b+18].inputs.width,g[b+18].inputs.height],[1080,1936]);
  if(i){
   assert.equal(g[b+11].inputs.length,5);assert.deepEqual(g[b+11].inputs.image,[String(b-30+16),0]);
   assert.deepEqual(g[b+12].inputs.image,[String(b+11),0]);
  }else assert.equal(g[b+12],undefined,'The original RGB driver must never become an Add Guide');
 }
 assert.equal(exported,totalFrames);
 assert.ok(!Object.values(g).some(n=>/Upscale|Refine|Composite|FaceRestore|BlockSparseAttention/.test(n.class_type)));
 assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,segments.length);
 const before=JSON.stringify(g);g['6'].inputs.strength_model=0;
 assert.notEqual(before,JSON.stringify(g));assert.equal(NATIVE_POSE_MODELS.turbo,'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors');
}
const source={...h3PhotoPlan(1536,2752),fps:24,totalFrames:120,hasAudio:false},segments=h3Segments(120,[],5);
assert.throws(()=>nativePoseCandidateGraph({imageName:'../secret',videoName:'guide',source,segments}));
assert.throws(()=>nativePoseCandidateGraph({imageName:'photo',videoName:'guide',source,segments,models:{}}));
const g=nativePoseCandidateGraph({imageName:'photo',videoName:'guide',source,segments});
assert.equal(g['50'],undefined);assert.equal(g['490'].inputs.audio,undefined);
const full={...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,hasAudio:true,inferenceProfile:'native-fun-pose4-caption',sceneCuts:[]};
const integrated=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:full}),plan=h3ExecutionPlan(full);
assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption','A private candidate must not promote itself');
assert.equal(plan.guideAppearance,'drawn_pose_only_with_generated_continuation');assert.equal(plan.sampling.steps,4);
assert.equal(plan.sampling.turbo,NATIVE_POSE_MODELS.turbo);
assert.equal(plan.attentionConditioning,'native_full_attention');assert.equal(plan.postDecodeResize,false);
for(const [id,node] of Object.entries(integrated))assert.equal(h3NodeClass(id,plan),node.class_type,'Accurate timing node '+id);
const eightSource={...full,inferenceProfile:'native-fun-pose8-caption'};
const eight=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:eightSource});
assert.equal(eight['6'].inputs.lora_name,'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors');
assert.deepEqual(eight['8'].inputs,{model:['6',0],shift_video:12,shift_audio:3});
assert.equal(eight['40'].inputs.sampler_name,'euler');
for(let i=0;i<3;i++){
 assert.equal(eight[1010+i*30].inputs.steps,8);
 assert.deepEqual(eight[1008+i*30].inputs.model,['8',0]);
}
assert.equal(h3ExecutionPlan(eightSource).sampling.steps,8);
assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption');
console.log('PASS: pose-only source conditioning, current native photo, shared caption, matched model paths, generated-only continuation, exact frames/audio and no output resize/refinement; GPU quality remains unvalidated');
