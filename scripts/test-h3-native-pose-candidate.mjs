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
const full={...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,hasAudio:true,inferenceProfile:'native-fun-pose4-caption',sceneCuts:[],diagnosticOutputs:true};
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
const retargetSource={...full,inferenceProfile:'native-fun-retarget4-caption'};
const retarget=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:retargetSource});
assert.equal(Object.values(retarget).filter(n=>n.class_type==='BodyRatioMapperProportionTransfer').length,1,
 'Solve body proportions once for the complete sequence, never independently per window');
assert.deepEqual(retarget['67'].inputs.ref_pose_keypoint,['66',0]);
assert.deepEqual(retarget['64'].inputs.image,['30',0]);
assert.equal(retarget['60'].inputs.frame_load_cap,361);
assert.equal(retarget['67'].inputs.head_fixed_mode,false);
assert.equal(retarget['67'].inputs.offset_stabilizer_x,false);
assert.equal(retarget['67'].inputs.offset_stabilizer_y,false);
for(const [i,s] of h3Segments(361,[],5).entries()){
 const b=1000+30*i;
 assert.deepEqual(retarget[b+19].inputs,{image:['68',0],batch_index:s.loadStart,length:s.inputFrames});
 const control=retarget[b+8].inputs.control_video;
 assert.equal(control[0],String(b+(s.modelFrames>s.inputFrames?22:19)));
 assert.equal(retarget[b],undefined,'No second raw-source path or repeated proportion solve');
 assert.equal(retarget[b+9].inputs['ref_images.ref_image_1'][0],'31');
}
const retargetPlan=h3ExecutionPlan(retargetSource);
assert.equal(retargetPlan.poseRetargeting,'photo_proportions_once_for_whole_sequence');
for(const [id,node] of Object.entries(retarget))assert.equal(h3NodeClass(id,retargetPlan),node.class_type,'Retarget timing node '+id);
const visualSource={...full,inferenceProfile:'native-fun-retarget4-visual'};
const visual=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:visualSource});
assert.equal(visual['85'],undefined);assert.equal(visual['86'],undefined,'No generated body description');
assert.equal(visual['68'].class_type,'BodyRatioMapperSDPoseRender');
assert.equal(visual['68'].inputs.draw_mouth,true);assert.equal(visual['68'].inputs.resolution_x,1088);
assert.equal(visual['60'].inputs.custom_width,544);assert.equal(visual['60'].inputs.custom_height,976);
assert.deepEqual(visual['31'].inputs.image,['30',0],'Only the analysis branch may resize the photo');
let visualFrames=0;
for(const [i,s] of h3Segments(361,[],22).entries()){
 const b=1000+30*i;
 assert.equal(visual[b+9].inputs.prompt.includes('<Picture 1>'),true);
 assert.equal(visual[b+17].inputs.length,s.length);visualFrames+=s.length;
 if(i){assert.equal(visual[b+11].inputs.length,22);assert.equal(visual[b+17].inputs.batch_index,22);}
 assert.equal(visual[b+18].inputs.width,1080);assert.equal(visual[b+18].inputs.height,1936);
}
assert.equal(visualFrames,361);assert.equal(Object.values(visual).filter(n=>n.class_type==='SamplerCustomAdvanced').length,4);
const visualPlan=h3ExecutionPlan(visualSource);
assert.equal(visualPlan.appearanceCaptionModel,null);assert.equal(visualPlan.sampling.steps,4);
for(const [id,node] of Object.entries(visual))assert.equal(h3NodeClass(id,visualPlan),node.class_type,'Detailed pose timing node '+id);
const faceSource={...full,inferenceProfile:'native-fun-retarget4-face-performance'};
const face=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:faceSource});
assert.deepEqual(face['79'].inputs.image,['61',0]);assert.equal(face['78'].inputs.scale,1);
assert.equal(face['79'].inputs.padding,0);assert.equal(face['79'].inputs.keep_aspect,'pad');
assert.equal(face['68'].inputs.draw_face,false,'Low-confidence facial dots must not compete with the facial performance');
assert.deepEqual(face['494'].inputs.images,['79',0]);
for(const [i,s] of h3Segments(361,[],22).entries()){
 const b=1000+30*i;
 assert.deepEqual(face[b+23].inputs,{image:['79',0],batch_index:s.loadStart,length:s.inputFrames});
 assert.deepEqual(face[b+9].inputs['ref_videos.ref_video_1'],[String(b+(s.modelFrames>s.inputFrames?26:23)),0]);
 assert.equal(face[b+9].inputs.prompt.includes('<Video 1>'),true);
 if(s.modelFrames>s.inputFrames)assert.equal(face[b+25].inputs.amount,s.modelFrames-s.inputFrames,
   'Pad face/control to the same native grid so the encoder does not discard the final performance frames');
 assert.deepEqual(face[b+8].inputs.control_video,visual[b+8].inputs.control_video);
}
const facePlan=h3ExecutionPlan(faceSource);
assert.equal(facePlan.guideAppearance,'pose_and_face_performance_with_generated_continuation');
for(const [id,node] of Object.entries(face))assert.equal(h3NodeClass(id,facePlan),node.class_type,'Face performance timing node '+id);
const guardedSource={...full,inferenceProfile:'native-fun-retarget4-face-guard'};
const guarded=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:guardedSource});
assert.deepEqual(guarded['80'].inputs.image,['79',0]);
assert.equal(guarded['81'].inputs.expression,'256/((a==361)*(b==256)*(c==256))');
assert.deepEqual(guarded['81'].inputs,{a:['80',2],b:['80',0],c:['80',1],expression:'256/((a==361)*(b==256)*(c==256))'});
assert.deepEqual(guarded['494'].inputs.images,['82',0],'QA and inference must use the same validated face sequence');
for(let i=0;i<4;i++){
 assert.deepEqual(guarded[1023+i*30].inputs.image,['82',0]);
 assert.deepEqual(guarded[1009+i*30].inputs.prompt,face[1009+i*30].inputs.prompt);
}
assert.equal(guarded['82'].inputs.height,256);assert.deepEqual(guarded['82'].inputs.width,['81',0]);
assert.equal(guarded['82'].inputs.upscale_method,'nearest-exact','The assertion pass must not quantize/interpolate valid facial crops');
assert.equal(h3ExecutionPlan(guardedSource).faceCropValidation,'exact_source_frame_count_and_256_square');
for(const [id,node] of Object.entries(guarded))assert.equal(h3NodeClass(id,h3ExecutionPlan(guardedSource)),node.class_type,'Guarded face timing node '+id);
const globalSource={...full,inferenceProfile:'native-fun-global4-face-attributes'};
const global=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:globalSource});
assert.equal(Object.values(global).filter(n=>n.class_type==='SamplerCustomAdvanced').length,1,
 'A 15-second clip must share one denoising trajectory with no independently sampled joins');
assert.equal(global['1009'].inputs.length,362);assert.equal(global['1017'].inputs.length,361);
assert.equal(global['1017'].inputs.batch_index,0);assert.equal(global['49'],undefined);
assert.equal(global['1008'].inputs.model[0],'10');assert.equal(global['10'].inputs.start_percent,0);
assert.equal(global['10'].inputs.sink_conditioning,'exact_kv');assert.equal(global['10'].inputs.dense_blocks,'0,1');
assert.equal(global['86'].inputs.image[0],'30');assert.equal(global['86'].inputs.max_length,384);
assert.ok(global['86'].inputs.prompt.includes('Do not describe body shape'));
assert.ok(global['86'].inputs.prompt.includes('hand coverings'));
assert.equal(global['87'].class_type,'StringConcatenate');
assert.ok(global['87'].inputs.string_a.includes('<Picture 1>'));assert.ok(global['87'].inputs.string_a.includes('<Video 1>'));
assert.deepEqual(global['1009'].inputs.prompt,['87',0]);
assert.equal(global['1021'].inputs.amount,1);assert.equal(global['1025'].inputs.amount,1);
const globalPlan=h3ExecutionPlan(globalSource);
const ordinaryGraph=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:{...globalSource,diagnosticOutputs:false}});
for(const id of ['69','70','71','72','73','75','76','77','492','493','494','495'])assert.equal(ordinaryGraph[id],undefined,'Private diagnostic output absent from normal requests: '+id);
for(const id of Object.keys(ordinaryGraph))assert.deepEqual(ordinaryGraph[id],global[id],'The normal graph retains the tested inference path: '+id);
assert.equal(ordinaryGraph['490'].class_type,'VHS_VideoCombine');
assert.equal(globalPlan.samplerCount,1);assert.equal(globalPlan.nativeWindowFrames,362);
assert.equal(globalPlan.appearanceCaptionModel,NATIVE_POSE_MODELS.caption);
for(const [id,node] of Object.entries(global))assert.equal(h3NodeClass(id,globalPlan),node.class_type,'Global native timing node '+id);
const global8Source={...globalSource,inferenceProfile:'native-fun-global8-face-attributes'};
const global8=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:global8Source});
assert.equal(global8['6'].inputs.lora_name,'minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors');
assert.deepEqual(global8['8'].inputs,{model:['6',0],shift_video:12,shift_audio:3});
assert.deepEqual(global8['9'].inputs.model,['8',0],'Calculate sparse sigma boundaries after the matched DMD shift');
assert.deepEqual(global8['1008'].inputs.model,['10',0]);assert.equal(global8['1010'].inputs.steps,8);
assert.equal(global8['40'].inputs.sampler_name,'euler');assert.equal(global8['1009'].inputs.length,362);
for(const id of Object.keys(global).filter(id=>!['6','9','40','1010'].includes(id)))assert.deepEqual(global8[id],global[id],
 'Four/eight-step comparison retains the same input, pose, face, attributes, continuation and export: '+id);
assert.equal(h3ExecutionPlan(global8Source).sampling.steps,8);
for(const [id,node] of Object.entries(global8))assert.equal(h3NodeClass(id,h3ExecutionPlan(global8Source)),node.class_type,'Global DMD timing node '+id);
const inventorySource={...globalSource,inferenceProfile:'native-photo-inventory-check'};
const inventory=h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:inventorySource});
assert.deepEqual(Object.keys(inventory).sort(),['30','85','86','495'].sort());
for(const id of Object.keys(inventory))assert.deepEqual(inventory[id],global[id],'Inspect the same inventory settings used by the real recipe');
assert.equal(h3ExecutionPlan(inventorySource).samplerCount,0);assert.equal(h3ExecutionPlan(inventorySource).diagnosticOnly,true);
assert.throws(()=>h3GraphForInputs({revision:H3_REVISION},{imageName:'photo',videoName:'guide',source:{...inventorySource,diagnosticOutputs:false}}),/private diagnostic/);
for(let n=6;n<=1440;n++){
 const parts=h3Segments(n,[],22,362);let cursor=0;
 for(const p of parts){assert.equal(p.start,cursor);assert.ok(p.modelFrames<=362);cursor+=p.length;}
 assert.equal(cursor,n);if(n<=362)assert.equal(parts.length,1);
}
assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption');
console.log('PASS: pose-only source conditioning, current native photo, shared caption, matched model paths, generated-only continuation, exact frames/audio and no output resize/refinement; GPU quality remains unvalidated');
