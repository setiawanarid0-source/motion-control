import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AKATZ_PROFILE,AKATZ_REVISION,AKATZ_ASSET,AKATZ_TURBO_ASSET,AKATZ_NODE_CLASSES,
  prepareAkatzInput,akatzGraphForInputs,akatzExecutionPlan} from '../h3-akatz-motion.js';
import {h3PhotoPlan,H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {runningHubInstanceType} from '../runninghub-instance.js';

const character='api-lora-usa/'+'a'.repeat(32)+'.safetensors',turbo='api-lora-usa/'+'b'.repeat(32)+'.safetensors';
const sourceFor=(totalFrames,hasAudio=true)=>({...h3PhotoPlan(1143,2048),inferenceProfile:AKATZ_PROFILE,
  totalFrames,fps:24,hasAudio,driverCanvas:[736,1280]});
assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption');
assert.ok(AKATZ_ASSET.url.includes('/resolve/0f409f0c2a18f123f3985041ec52982c813f5a9c/'));
assert.ok(AKATZ_TURBO_ASSET.url.includes('/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/'));
for(let frames=6;frames<=362;frames++){
  const source=sourceFor(frames),plan=akatzExecutionPlan(source);
  const g=akatzGraphForInputs({imageName:'api/photo.jpg',videoName:'api/driver.mp4',source,
    characterLoraFile:character,turboLoraFile:turbo});
  assert.equal(plan.revision,AKATZ_REVISION);assert.equal(plan.samplerCount,1);
  assert.equal(plan.nativeWindowFrames%17,5);assert.ok(plan.nativeWindowFrames>=frames);
  assert.equal(g['107'].inputs.length,frames,'Export every real frame, including a short tail');
  const padding=g['35']?.inputs.amount||0;assert.equal(frames+padding,g['100'].inputs.length);
  assert.deepEqual(g['100'].inputs['ref_images.ref_image_1'],['31',0]);
  assert.deepEqual(g['100'].inputs['ref_videos.ref_video_1'],[padding?'36':'33',0]);
  assert.equal(g['33'].inputs.frame_load_cap,frames);
  assert.equal(g['33'].inputs.force_size,'Disabled');
  assert.equal(g['6'].inputs.file_name,turbo);assert.equal(g['7'].inputs.file_name,character);
  assert.equal(g['40'].inputs.sampler_name,'er_sde');assert.equal(g['41'].inputs.scheduler,'normal');
  assert.equal(g['41'].inputs.steps,8);assert.equal(g['103'].inputs.cfg,1);
  assert.deepEqual(g['41'].inputs.model,g['103'].inputs.model);
  assert.equal(typeof g['102'].inputs.noise_seed,'number');
  assert.equal(g['100'].inputs.ref_image_size,'max');
  assert.deepEqual([g['100'].inputs.width,g['100'].inputs.height],[1088,1952]);
  assert.deepEqual([g['108'].inputs.width,g['108'].inputs.height],[1080,1936]);
  assert.deepEqual(g['108'].inputs.image,['107',0]);assert.deepEqual(g['107'].inputs.image,['106',0]);
  assert.deepEqual(g['490'].inputs.images,['108',0]);assert.equal(g['490'].inputs.frame_rate,24);
  assert.ok(!Object.values(g).some(n=>/Upscale|ImageScale|Refine|Composite|FaceRestore|H3Relay|BodyRatio|SDPose/.test(n.class_type)));
  assert.ok(Object.values(g).filter(n=>n.class_type==='MiniMaxH3AddGuide').every(n=>!n.inputs.image),
    'Source RGB frames must not become hard appearance guides');
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,1);
  for(const [id,n] of Object.entries(g)){
    assert.equal(AKATZ_NODE_CLASSES[id],n.class_type);assert.equal(h3NodeClass(id,plan),n.class_type);
    for(const value of Object.values(n.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string')
      assert.ok(g[value[0]],'No missing node dependency: '+id+' → '+value[0]);
  }
}
for(const frames of [0,5,363,1440])assert.throws(()=>akatzExecutionPlan(sourceFor(frames)));
const args={imageName:'photo.jpg',videoName:'driver.mp4',source:sourceFor(361,false),characterLoraFile:character,turboLoraFile:turbo};
const silent=akatzGraphForInputs(args);
assert.equal(silent['50'],undefined);assert.equal(silent['101'],undefined);
assert.equal(silent['490'].inputs.audio,undefined);assert.deepEqual(silent['103'].inputs.positive,['100',0]);
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
assert.equal(typeof sent['102'].inputs.noise_seed,'number');assert.equal(sent['107'].inputs.length,361);
await assert.rejects(context.createTask({...task,mode:'standard'}),/Plus/);assert.equal(submitted,1);
context.h3AkatzModels.turbo.ensure=async()=>{throw Error('Model setup incomplete');};
await assert.rejects(context.createTask(task),/Model setup incomplete/);assert.equal(submitted,1,
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
  const first=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  const a=first(rotated),b=first(prepared.file.path);assert.equal(a.length,b.length);
  const mean=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;assert.ok(mean<4,'Native driver must not rotate or scale again');
  assert.equal(hash(),before,'The original reference photo bytes remain unchanged');
}finally{if(prepared)await prepared.release();fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: single-shot Akatz 6–362 frame coverage, pinned two-model provisioning, native 1080 output, unscaled/rotated short input, no RGB hard guide or refinement, owner-only submission and truthful timing metadata');
