import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {reviewPlan,prepareAlignedReview,alignedReviewGraph,headSwapPrompt,REVIEW_MODELS} from '../experiments/h3-aligned-review/review.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
import {graphValidationError,isDefinitelyRejectedGraph} from '../runninghub-graph-validation.js';
import {explicitQueueMaxed,queueCapacityError} from '../runninghub-capacity.js';
import {createGenerationQueue} from '../generation-queue.js';
const metadata={fps:24,duration:2,totalFrames:48,outputWidth:1080,outputHeight:1920};
for(let frames=6;frames<=121;frames++){
  const p=reviewPlan({...metadata,totalFrames:frames,duration:frames/24},'plus');
  assert.ok(p.modelFrames>=frames&&p.modelFrames-frames<=21);
  assert.equal(p.modelFrames%17,5,'Add Guide must receive a complete valid H3 clip');
  assert.equal(p.canvasWidth,1088);assert.equal(p.canvasHeight,1920);
  assert.equal(p.padLeft,4);assert.equal(p.padTop,0);
}
assert.throws(()=>reviewPlan(metadata,'standard'),/Plus/);
assert.throws(()=>reviewPlan({...metadata,duration:6},'plus'),/5 detik/);
const source={...reviewPlan(metadata,'plus'),file:{originalname:'aligned-guide.mp4'}};
const details='Adult character with a pink bob haircut, dark eyes and a small straight nose';
const args={imageName:'api/reference.jpg',videoName:'api/aligned-guide.mp4',source,referenceDetails:details};
const graph=alignedReviewGraph(args);
assert.equal(graph['40'].inputs.width,1088);assert.equal(graph['40'].inputs.height,1920);
assert.equal(graph['40'].inputs.length,56);
assert.ok(!Object.keys(graph['40'].inputs).some(k=>k.startsWith('ref_videos')),'Aligned guide is not a native reference video');
assert.deepEqual(graph['41'].inputs.image,['33',0]);
assert.deepEqual(graph['41'].inputs.latent,['40',1]);
assert.equal(graph['41'].inputs.frame_idx,0);
assert.deepEqual(graph['43'].inputs.positive,['41',0]);
assert.deepEqual(graph['46'].inputs.latent_image,['40',1]);
assert.deepEqual(graph['43'].inputs.model,['7',0]);
assert.deepEqual(graph['7'].inputs.model,['6',0]);
assert.equal(graph['6'].inputs.lora_name,REVIEW_MODELS.head);
assert.deepEqual(graph['6'].inputs.model,['5',0]);
assert.equal(graph['5'].inputs.lora_name,REVIEW_MODELS.turbo);
assert.equal(graph['48'].inputs.length,48,'Trim all generated temporal padding');
assert.deepEqual([graph['49'].inputs.width,graph['49'].inputs.height,graph['49'].inputs.x],[1080,1920,4]);
assert.deepEqual(graph['490'].inputs.images,['49',0]);
assert.deepEqual(graph['490'].inputs.audio,['33',2]);
assert.ok(!Object.values(graph).some(n=>/Resize|ImageScale|Composite|Uncrop/.test(n.class_type)),
  'Do not advertise a resized or pasted low-res render as native output-size inference');
assert.ok(graph['40'].inputs.prompt.includes(details),'Use actual reference details, not creator cache');
// The author's Head Swap contract uses all seven structured sections. A generic
// short edit instruction drops the explicit source/identity retention roles.
const prompt=headSwapPrompt(details);
const sections=['head_swap','subject_definitions','summary','retention_analysis',
  'detailed_description','overall_soundscape','non_diegetic_music'];
let sectionPosition=-1;
for(const section of sections){
  const next=prompt.indexOf(section+':\n');
  assert.ok(next>sectionPosition,'Head Swap sections must be complete and ordered: '+section);
  sectionPosition=next;
}
assert.equal(prompt.split(details).length,2,'Current reference details must appear exactly once');
const secondDetails='Adult character with short curly silver hair and a broad square jaw';
assert.ok(headSwapPrompt(secondDetails).includes(secondDetails));
assert.ok(!headSwapPrompt(secondDetails).includes(details),'Do not retain a previous reference identity');
for(const invalid of ['', 'short', 'x'.repeat(1201), 'valid description\u0000'])
  assert.throws(()=>headSwapPrompt(invalid),/deskripsi/);
for(const n of Object.values(graph))for(const v of Object.values(n.inputs))if(Array.isArray(v))assert.ok(graph[v[0]],'No dangling links');
for(const sourceOverride of [{canvasWidth:480},{modelFrames:124},{padLeft:0},{frames:undefined}])
  assert.throws(()=>alignedReviewGraph({...args,source:{...source,...sourceOverride}}),/Metadata/);
assert.throws(()=>alignedReviewGraph({...args,referenceDetails:''}),/deskripsi/);
assert.throws(()=>alignedReviewGraph({...args,imageName:'../secret'}),/aset/);
assert.throws(()=>alignedReviewGraph({...args,models:{...REVIEW_MODELS,head:''}}),/aset/);
// Exercise the actual production provider payload, including explicit graph rejection.
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=server.indexOf('async function createTask('),end=server.indexOf('const upload = multer(',begin);
let response={code:0,data:{taskId:'2113999999999999999',taskStatus:'RUNNING'}};
const calls=[],uploads=[];
const context={workflowGraphs:{minimaxH3Review:{reviewPrototype:true}},alignedReviewGraph,runningHubInstanceType,
  graphValidationError,explicitQueueMaxed,queueCapacityError,
  uploadToRunningHub:async(key,file)=>{uploads.push(file);return 'api/'+file.originalname;},
  rhJson:async(url,key,payload)=>{calls.push({url,payload});return response;}};
vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
const request={apiKey:'fixture-not-a-key',workflowId:'owner-workflow',workflowKey:'minimaxH3Review',mode:'plus',
  imageFile:{originalname:'reference.jpg'},videoFile:{originalname:'unprepared.mp4'},h3ReviewSource:source,referenceDetails:details};
await context.createTask(request);
assert.equal(uploads[1],source.file,'Upload the padded, aligned guide rather than raw source');
assert.equal(calls[0].payload.instanceType,'plus');
assert.equal(calls[0].payload.nodeInfoList.length,0);
assert.equal(calls[0].payload.retainSeconds,undefined);
assert.equal(JSON.parse(calls[0].payload.workflow)['6'].inputs.lora_name,REVIEW_MODELS.head);
response={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},
  node_errors:{6:{class_type:'LoraLoaderModelOnly',errors:[{message:'Value not in list: missing review LoRA'}]}}})};
await assert.rejects(context.createTask(request),isDefinitelyRejectedGraph);
const count=calls.length;await assert.rejects(context.createTask({...request,h3ReviewSource:null}),/Metadata/);
assert.equal(calls.length,count,'No paid create without prepared media');
// Real, non-person media tests the exact guide/frame geometry and soundtrack path.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'h3-aligned-test-'));
try{
  const file=path.join(dir,'test-pattern.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=180x320:r=30:d=1.25',
    '-f','lavfi','-i','sine=frequency=440:duration=1.25','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);
  const original=fs.readFileSync(file),prepared=await prepareAlignedReview({path:file},'plus');
  try{
    const data=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',prepared.file.path],{encoding:'utf8'}));
    const v=data.streams.find(s=>s.codec_type==='video');
    assert.deepEqual([v.width,v.height],[1088,1920]);
    assert.equal(Number(v.nb_frames),prepared.modelFrames);assert.equal(v.r_frame_rate,'24/1');
    assert.equal(prepared.frames,30);assert.equal(prepared.modelFrames,39);
    assert.ok(data.streams.some(s=>s.codec_type==='audio'));
    assert.deepEqual(fs.readFileSync(file),original,'Never mutate a user upload');
  }finally{await prepared.release();}
  assert.equal(fs.existsSync(prepared.file.path),false);
  const queue=createGenerationQueue({dir:path.join(dir,'queue')});
  const jobId='12345678-1234-4234-8234-123456789abc';
  await queue.stage({jobId,deviceId:'device',body:{workflow:'minimaxH3Review',mode:'plus',referenceDetails:details},
    image:{path:file,originalname:'test.jpg'},video:{path:file,originalname:'test.mp4'}});
  assert.equal(queue.read(jobId).body.referenceDetails,details,'Reference details survive durable async preflight');
  const restarted=createGenerationQueue({dir:path.join(dir,'queue')});
  assert.equal(restarted.read(jobId).body.referenceDetails,details);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: isolated H3 aligned-guide review, native-size sampling, correct head adapter routing, full guide padding, no post-resize claim, provider payload and durable reference details; GPU inference NOT run');
