import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AKATZ_PROFILE,AKATZ_REVISION,AKATZ_ASSET,AKATZ_TURBO_ASSET,
  prepareAkatzInput,akatzGraphForInputs,akatzExecutionPlan} from '../h3-akatz-motion.js';
import {h3PhotoPlan,H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {runningHubInstanceType} from '../runninghub-instance.js';

const character='api-lora-usa/'+'a'.repeat(32)+'.safetensors',turbo='api-lora-usa/'+'b'.repeat(32)+'.safetensors';
const sourceFor=(totalFrames,hasAudio=true)=>({...h3PhotoPlan(1143,2048),inferenceProfile:AKATZ_PROFILE,
  totalFrames,fps:24,hasAudio,driverCanvas:[736,1280]});
assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption');
assert.ok(AKATZ_ASSET.url.includes('/resolve/0f409f0c2a18f123f3985041ec52982c813f5a9c/'));
assert.ok(AKATZ_TURBO_ASSET.url.includes('/resolve/30f485ed874aa44c8183348ad361c5eabad318da/'));
assert.ok(AKATZ_TURBO_ASSET.url.endsWith('/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'));
assert.equal(AKATZ_TURBO_ASSET.sha256,'5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c');
for(let frames=6;frames<=362;frames++){
  const source=sourceFor(frames),plan=akatzExecutionPlan(source);
  const g=akatzGraphForInputs({imageName:'api/photo.jpg',videoName:'api/driver.mp4',source,
    characterLoraFile:character,turboLoraFile:turbo});
  assert.equal(plan.revision,AKATZ_REVISION);assert.equal(plan.nativeWindowFrames,124);
  assert.ok(plan.peakWindowFrames<=124,'Both sampling and source reference must stay bounded');
  assert.equal(plan.samplerCount,plan.segments.length);
  assert.ok(plan.samplerCount<=3);assert.equal(plan.workBudget.totalSteps,plan.samplerCount*4);
  assert.ok(plan.workBudget.totalSteps<=12);assert.equal(plan.workBudget.providerHardLimitSeconds,2400);
  assert.equal(plan.workBudget.measuredRuntimeSeconds,null,'A budget is not a measured runtime');
  assert.equal(plan.attentionConditioning,'dense_target_and_reference_all_steps');
  assert.equal(g['10'],undefined,'The four-step detail reconstruction must never enter sparse target attention');
  assert.deepEqual(g['41'].inputs.model,['8',0]);
  assert.equal(g['490'].inputs.crf,12,'Preserve generated detail in the final video encoder');
  assert.deepEqual(plan.outputEncoding,{format:'video/h264-mp4',crf:12});
  assert.match(g['87'].inputs.string_a,/eyebrow raises.*eyelid opening.*blinks/);
  assert.match(g['87'].inputs.string_a,/mouth corners.*lip shape.*mouth opening.*speech articulation/);
  assert.match(g['87'].inputs.string_a,/not a frozen expression/);
  if(frames<=124)assert.equal(plan.samplerCount,1,'Short clips must not be split');
  const timeline=[];
  for(const [i,seg] of plan.segments.entries()){
    const b=1000+i*40,at=n=>g[String(b+n)]?.inputs,link=(n,out=0)=>[String(b+n),out];
    assert.equal(seg.start,timeline.length);assert.equal(seg.modelFrames%17,5);
    assert.ok(seg.modelFrames>=seg.inputFrames&&seg.modelFrames<=124);
    assert.equal(at(0).frame_load_cap,seg.inputFrames);assert.equal(at(0).skip_first_frames,seg.loadStart);
    assert.equal(at(0).force_size,'Disabled');
    assert.equal(at(14).batch_index,seg.contextFrames);assert.equal(at(14).length,seg.frames);
    for(let j=0;j<at(14).length;j++)timeline.push(at(0).skip_first_frames+at(14).batch_index+j);
    const padding=at(2)?.amount||0;
    assert.equal(seg.inputFrames+padding,at(5).length);
    assert.deepEqual(at(5)['ref_images.ref_image_1'],['31',0]);
    assert.deepEqual(at(5)['ref_videos.ref_video_1'],link(padding?3:0));
    assert.equal(at(5).ref_image_size,'max','Never downsize the reference photo to speed up');
    assert.deepEqual([at(5).width,at(5).height],[1088,1952]);
    assert.deepEqual([at(15).width,at(15).height],[1080,1936]);
    assert.deepEqual(at(15).image,link(14));assert.deepEqual(at(14).image,link(13));
    assert.equal(typeof at(9).noise_seed,'number');assert.equal(at(9).noise_seed,seg.seed);
    assert.equal(at(10).cfg,1);assert.deepEqual(at(10).model,g['41'].inputs.model);
    if(i){
      const prev=plan.segments[i-1],previousBase=b-40;
      assert.equal(seg.contextFrames,5,'Native 17n+5 history clip without a fourth window');
      assert.deepEqual(at(6).image,[String(previousBase+13),0]);
      assert.equal(at(6).batch_index,prev.inputFrames-5);assert.equal(at(6).length,5);
      assert.deepEqual(at(7).image,link(6),'Continuity may anchor only generated frames');
      assert.deepEqual(at(7).latent,link(5,1));
    }else assert.equal(at(7),undefined,'Do not pin the first source RGB frame');
    assert.equal(at(4).start_time,seg.loadStart/24);assert.equal(at(4).duration,seg.inputFrames/24);
  }
  assert.deepEqual(timeline,Array.from({length:frames},(_,i)=>i),'All source times exported once, with no skipped or repeated real frames');
  assert.equal(g['6'].inputs.file_name,turbo);assert.equal(g['7'].inputs.file_name,character);
  assert.equal(g['40'].inputs.sampler_name,'euler');assert.equal(g['41'].inputs.scheduler,'simple');
  assert.equal(g['41'].inputs.steps,4);assert.equal(g['490'].inputs.frame_rate,24);
  assert.deepEqual([g['8'].inputs.shift_video,g['8'].inputs.shift_audio],[12,3]);
  assert.deepEqual(g['490'].inputs.images,plan.samplerCount===1?['1015',0]:['49',0]);
  assert.deepEqual(g['490'].inputs.audio,['50',0]);assert.equal(g['50'].inputs.duration,frames/24);
  if(plan.samplerCount>1){
    assert.equal(g['49'].inputs.inputcount,plan.samplerCount);
    for(let i=0;i<plan.samplerCount;i++)assert.deepEqual(g['49'].inputs['image_'+(i+1)],[String(1015+i*40),0]);
  }
  assert.ok(!Object.values(g).some(n=>/Upscale|ImageScale|Refine|Composite|FaceRestore|H3Relay|BodyRatio|SDPose|BlockSparseAttention/.test(n.class_type)));
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,plan.samplerCount);
  for(const [id,n] of Object.entries(g)){
    assert.equal(h3NodeClass(id,plan),n.class_type);
    for(const value of Object.values(n.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string')
      assert.ok(g[value[0]],'No missing node dependency: '+id+' → '+value[0]);
  }
}
for(const frames of [0,5,363,1440])assert.throws(()=>akatzExecutionPlan(sourceFor(frames)));
const args={imageName:'photo.jpg',videoName:'driver.mp4',source:sourceFor(361,false),characterLoraFile:character,turboLoraFile:turbo};
const silent=akatzGraphForInputs(args);
assert.equal(silent['50'],undefined);assert.equal(silent['1004'],undefined);assert.equal(silent['1008'],undefined);
assert.equal(silent['490'].inputs.audio,undefined);assert.deepEqual(silent['1010'].inputs.positive,['1005',0]);
assert.equal(h3NodeClass('104',{revision:'akatz-native-1080-v1'}),'SamplerCustomAdvanced','Historical Akatz task IDs stay observable');
for(const revision of ['akatz-native-1080-v1','akatz-native-1080-v2','akatz-native-1080-v3'])
  assert.equal(h3NodeClass('10',{revision}),'BlockSparseAttention','Old in-flight tasks keep their original trace schema');
assert.equal(h3NodeClass('10',akatzExecutionPlan(sourceFor(361))),null);
assert.equal(h3NodeClass('1131',{revision:'akatz-native-1080-v2',samplerCount:4}),'SamplerCustomAdvanced');
assert.equal(h3NodeClass('1131',akatzExecutionPlan(sourceFor(361))),null,'The new profile must have no fourth window');
assert.throws(()=>akatzGraphForInputs({...args,imageName:'../private'}));
assert.throws(()=>akatzGraphForInputs({...args,turboLoraFile:'another-model.safetensors'}));
assert.throws(()=>akatzGraphForInputs({...args,source:{...args.source,outputWidth:768}}));
assert.throws(()=>akatzExecutionPlan({...args.source,seed:'42'}));

// Execute the real provider boundary with fake uploads and fake model receipts.
// This verifies payload typing and that no submission happens before setup.
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=server.indexOf('async function createTask('),end=server.indexOf('const upload = multer(',begin);
const calls=[];let payload,submitted=0;
const context={AKATZ_PROFILE,akatzGraphForInputs,runningHubInstanceType,
  workflowGraphs:{minimaxH3Akatz:{revision:AKATZ_REVISION}},
  h3AkatzModels:{character:{ensure:async()=>{calls.push('character');return character;}},
    turbo:{ensure:async()=>{calls.push('turbo');return turbo;}}},
  uploadToRunningHub:async(_key,file)=>'api/'+file.originalname,
  rhJson:async(_route,_key,data)=>{payload=data;submitted++;return {code:0,data:{taskId:'2118000000000000001'}};}};
vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
const task={apiKey:'fixture-only',workflowId:'owner-workflow',workflowKey:'minimaxH3Akatz',mode:'plus',
  imageFile:{originalname:'photo.jpg'},h3Source:{...sourceFor(361),file:{originalname:'driver.mp4'}},
  onBeforeSubmit:()=>calls.push('submit'),onModelPreparation:()=>calls.push('models')};
await context.createTask(task);
assert.deepEqual(calls,['models','character','turbo','submit']);assert.equal(submitted,1);
assert.equal(payload.instanceType,'plus');assert.deepEqual([...payload.nodeInfoList],[]);
assert.equal(payload.retainSeconds,undefined);
const sent=JSON.parse(payload.workflow);assert.equal(sent['7'].inputs.file_name,character);
assert.equal(typeof sent['1009'].inputs.noise_seed,'number');
assert.equal(Object.values(sent).filter(n=>n.class_type==='SamplerCustomAdvanced').length,3);
assert.equal(sent['41'].inputs.steps,4);
await assert.rejects(context.createTask({...task,mode:'standard'}),/Plus/);assert.equal(submitted,1);
context.h3AkatzModels.turbo.ensure=async()=>{throw Error('Model setup incomplete');};
await assert.rejects(context.createTask(task),e=>e.code==='H3_MODEL_PREPARATION_FAILED'&&/Model setup incomplete/.test(e.message));assert.equal(submitted,1,
  'Failed model setup cannot submit a paid task');

// Actual short, rotated media preprocessing; compare against FFmpeg's own
// autorotated source frame to catch a second rotation or a geometry change.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-native-media-'));let prepared;
try{
  const input=path.join(dir,'base.mp4'),rotated=path.join(dir,'rotated.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=160x96:r=30',
    '-vf','drawbox=x=0:y=0:w=80:h=96:color=red:t=fill','-t','0.25','-c:v','libx264','-pix_fmt','yuv420p',input]);
  const ffmpegHelp=execFileSync('ffmpeg',['-hide_banner','-h','full'],{encoding:'utf8',maxBuffer:8*1024*1024});
  const rotationArgs=ffmpegHelp.includes('-display_rotation')
    ?['-display_rotation','90','-i',input,'-c','copy']
    :['-i',input,'-c','copy','-metadata:s:v:0','rotate=90'];
  execFileSync('ffmpeg',['-v','error','-y',...rotationArgs,rotated]);
  const rotationProbe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',rotated]));
  assert.ok(rotationProbe.streams[0].side_data_list?.some(x=>Math.abs(x.rotation)===90),
    'The regression fixture must contain a real display rotation');
  const photo=path.join(dir,'reference.jpg');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=96x160:r=1','-frames:v','1',photo]);
  const hash=()=>createHash('sha256').update(fs.readFileSync(photo)).digest('hex'),before=hash();
  const image={path:photo,originalname:'reference.jpg',mimetype:'image/jpeg',size:fs.statSync(photo).size};
  prepared=await prepareAkatzInput({path:rotated,originalname:'short.mp4',mimetype:'video/mp4'},'plus',image);
  assert.equal(prepared.totalFrames,6);assert.deepEqual(prepared.driverCanvas,[96,160]);
  assert.ok(Number.isSafeInteger(prepared.seed));
  assert.deepEqual(prepared.driverEncoding,{crf:12,maxrate:'24M',bufsize:'48M'});
  const first=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  const a=first(rotated),b=first(prepared.file.path);assert.equal(a.length,b.length);
  const mean=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;assert.ok(mean<4,'Native driver must not rotate or scale again');
  assert.equal(hash(),before,'The original reference photo bytes remain unchanged');
}finally{if(prepared)await prepared.release();fs.rmSync(dir,{recursive:true,force:true});}

// Measure the actual preprocessor against the old re-encode using small,
// detailed moving frames. This tests pixel preservation, not generative quality.
const detailDir=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-driver-detail-'));let detail;
try{
  const source=path.join(detailDir,'detail.mp4'),baseline=path.join(detailDir,'old-crf16.mp4'),photo=path.join(detailDir,'photo.png');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=96x160:r=1','-frames:v','1',photo]);
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=360x640:r=24',
    '-vf','noise=alls=12:allf=t:all_seed=17','-t','0.75','-c:v','libx264','-crf','0','-pix_fmt','yuv420p',source]);
  detail=await prepareAkatzInput({path:source,originalname:'detail.mp4',mimetype:'video/mp4'},'plus',
    {path:photo,originalname:'photo.png',mimetype:'image/png'});
  assert.equal(detail.totalFrames,18);assert.deepEqual(detail.driverCanvas,[384,640]);
  const filter='setpts=PTS-STARTPTS,fps=24,setsar=1,pad=384:640:(ow-iw)/2:(oh-ih)/2:color=black';
  execFileSync('ffmpeg',['-v','error','-y','-i',source,'-vf',filter,'-an','-frames:v','18',
    '-c:v','libx264','-preset','fast','-crf','16','-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p',baseline]);
  const pixels=(file,filters='null')=>execFileSync('ffmpeg',['-v','error','-i',file,'-an','-vf',filters,
    '-frames:v','18','-f','rawvideo','-pix_fmt','yuv420p','-'],{maxBuffer:10*1024*1024});
  const original=pixels(source,filter),old=pixels(baseline),current=pixels(detail.file.path);
  assert.equal(current.length,original.length);assert.equal(old.length,original.length);
  const mse=bytes=>bytes.reduce((sum,value,i)=>sum+(value-original[i])**2,0)/bytes.length;
  const oldMse=mse(old),newMse=mse(current);
  assert.ok(newMse<oldMse*.85,`Driver detail regressed: new MSE ${newMse}, old ${oldMse}`);
  console.log('PASS: actual low-resolution driver pixel error reduced '+Math.round((1-newMse/oldMse)*100)+'% at identical frame count, pixels and orientation; no inference');
}finally{if(detail)await detail.release();fs.rmSync(detailDir,{recursive:true,force:true});}
console.log('PASS: dense four-step Ref2VA, explicit source expression timing, at most 12 total steps, generated-only five-frame continuity, exhaustive 6–362 frame timeline, native 1080, rotated short input and one owner-initiated provider submission');
