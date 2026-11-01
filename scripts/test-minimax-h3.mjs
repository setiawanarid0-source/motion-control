import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {H3_FPS,H3_MODELS,H3_PROMPT,H3_REVISION,H3_WINDOW_FRAMES,validateH3Probe,probeH3Input,
  prepareH3Input,prepareH3Reference,h3PhotoPlan,h3Segments,h3GraphForInputs,h3ExecutionPlan} from '../minimax-h3-motion.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
import {explicitQueueMaxed,queueCapacityError} from '../runninghub-capacity.js';
import {graphValidationError,isDefinitelyRejectedGraph} from '../runninghub-graph-validation.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../workflows/minimax-h3-motion-control.json',import.meta.url)));
assert.equal(manifest.revision,H3_REVISION);
const videoProbe=(duration=60,width=1080,height=1920)=>({streams:[
  {codec_type:'video',width,height,duration:String(duration)},
  {codec_type:'audio',duration:'65'}],format:{duration:'65'}});
const source={...validateH3Probe(videoProbe(),'plus'),...h3PhotoPlan(1080,1920),sceneCuts:[]};
assert.deepEqual([source.canvasWidth,source.canvasHeight,source.outputWidth,source.outputHeight],[1088,1920,1080,1920]);
assert.deepEqual([h3PhotoPlan(1920,1080).canvasWidth,h3PhotoPlan(1920,1080).canvasHeight],[1920,1088]);
assert.deepEqual([h3PhotoPlan(720,720).outputWidth,h3PhotoPlan(720,720).outputHeight],[1080,1080]);
for(const seconds of [0,.1,61,Infinity])assert.throws(()=>validateH3Probe(videoProbe(seconds),'plus'),/0,25–60/);
assert.throws(()=>validateH3Probe({streams:[]},'plus'),/dimensi/);
for(const mode of ['standard','lite','other'])assert.throws(()=>validateH3Probe(videoProbe(),mode),/Plus/);
for(const size of [[2049,3000],[3200,1080],[100,20]])assert.throws(()=>h3PhotoPlan(...size));
const rotation=videoProbe(1,1920,1080);rotation.streams[0].side_data_list=[{rotation:-90}];
assert.deepEqual([validateH3Probe(rotation).sourceWidth,validateH3Probe(rotation).sourceHeight],[1080,1920]);
// Coverage is exhaustive across all supported lengths, including one-frame cuts.
for(let frames=6;frames<=1440;frames++){
  const cuts=[1,2,Math.floor(frames/2)].filter(n=>n<frames),segments=h3Segments(frames,cuts);
  const actual=[];
  for(const seg of segments){
    assert.equal(seg.modelFrames%17,5);assert.ok(seg.modelFrames>=seg.inputFrames&&seg.modelFrames<=H3_WINDOW_FRAMES);
    assert.ok(seg.inputFrames<=H3_WINDOW_FRAMES);
    assert.equal(seg.loadStart+seg.contextFrames,seg.start);
    if(frames>H3_WINDOW_FRAMES){
      for(const cut of cuts)assert.ok(!(seg.start<cut&&seg.start+seg.length>cut));
      if(cuts.includes(seg.start))assert.equal(seg.contextFrames,0,'No continuity across a hard cut');
    }
    for(let j=0;j<seg.length;j++)actual.push(seg.start+j);
  }
  assert.deepEqual(actual,Array.from({length:frames},(_,i)=>i),'No loss, repetition, reordering or truncation');
}
const names={imageName:'api/current-photo.png',videoName:'api/motion-guide.mp4'};
const args={...names,source},before=JSON.stringify(manifest);
const graph=h3GraphForInputs(manifest,args);
const candidate=h3GraphForInputs(manifest,{...args,source:{...source,inferenceProfile:'no-training-adapter'}});
assert.ok(!candidate['5'],'Inference candidate must omit the training-only adapter');
assert.deepEqual(candidate['6'].inputs.model,['1',0]);
assert.deepEqual(candidate['7'].inputs.model,['6',0]);
const legacyWithoutAdapter=structuredClone(graph);
delete legacyWithoutAdapter['5'];legacyWithoutAdapter['6'].inputs.model=['1',0];
assert.deepEqual(candidate,legacyWithoutAdapter,'Controlled inference test changes only the training adapter branch');
assert.equal(h3ExecutionPlan({...source,inferenceProfile:'no-training-adapter'}).inferenceProfile,'no-training-adapter');
assert.throws(()=>h3GraphForInputs(manifest,{...args,source:{...source,inferenceProfile:'arbitrary'}}),/Profil inferensi/);
for(const cuts of [[],[60]]){
  const five={...source,totalFrames:120,sceneCuts:cuts};
  const g=h3GraphForInputs(manifest,{...names,source:five});
  assert.equal(h3Segments(120,cuts).length,1,'Never restart a five-second clip at 2.5 seconds, including a heuristic false cut');
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,1);
  assert.equal(g['1004'].inputs.length,124);
  assert.equal(g['1012'].inputs.length,120);
  assert.equal(h3ExecutionPlan(five).samplerCount,1);
}
assert.equal(JSON.stringify(manifest),before,'Shared manifest is immutable');
for(const n of Object.values(graph))for(const v of Object.values(n.inputs))if(Array.isArray(v))assert.ok(graph[v[0]],'No dangling links');
assert.deepEqual(graph['7'].inputs.model,['6',0]);
assert.equal(graph['5'].inputs.lora_name,H3_MODELS.adapter);
assert.equal(graph['6'].inputs.lora_name,H3_MODELS.turbo);
assert.equal(graph['7'].inputs.lora_name,H3_MODELS.motion);
assert.deepEqual(graph['41'].inputs.model,['8',0]);
assert.equal(graph['41'].inputs.steps,8);
assert.equal(graph['40'].inputs.sampler_name,'euler');
const disallowed=/Swap|SAM3|Director|Mask|Composite|Uncrop|Resize|ImageScale|Upscale|Refine|Stabili|Interpolate|ControlNet|Temporal/;
assert.ok(!Object.values(graph).some(n=>disallowed.test(n.class_type)),'No head edit, output resizer, refiner or unverified patch stack');
assert.ok(!JSON.stringify(graph).includes('character_swap'));
assert.match(H3_PROMPT,/motion_transfer:/);
assert.match(H3_PROMPT,/body proportions, clothing/);
assert.match(H3_PROMPT,/keep the camera stationary/);
assert.match(H3_PROMPT,/horizontal-to-vertical/);
assert.match(H3_PROMPT,/expression timing and intensity/);
assert.match(H3_PROMPT,/do not beautify, smooth skin/);
assert.deepEqual(graph['31'].inputs,{image:['30',0],left:0,top:0,right:8,bottom:0,feathering:0});
const segs=h3Segments(source.totalFrames,source.sceneCuts);
for(let i=0;i<segs.length;i++){
  const s=segs[i],b=1000+i*30;
  const cond=graph[b+4].inputs,load=graph[b].inputs;
  assert.equal(cond.width,1088);assert.equal(cond.height,1920);
  assert.deepEqual(cond['ref_images.ref_image_1'],['31',0]);
  assert.ok(!Object.keys(cond).some(k=>k.startsWith('ref_videos')),'Do not double-encode guide as native video');
  assert.equal(cond.prompt,H3_PROMPT);assert.equal(cond.length,s.modelFrames);
  assert.equal(load.skip_first_frames,s.loadStart);assert.equal(load.frame_load_cap,s.inputFrames);
  assert.equal(load.force_size,'Disabled');
  assert.deepEqual(graph[b+10].inputs.latent_image,[String(b+4),1],'Sample reference AV latent, not conditioning or guide');
  assert.deepEqual(graph[b+9].inputs.model,['8',0]);
  assert.equal(graph[b+12].inputs.batch_index,s.contextFrames);
  assert.equal(graph[b+12].inputs.length,s.length);
  assert.equal(graph[b+13].inputs.width,1080);assert.equal(graph[b+13].inputs.x,4);
  if(s.contextFrames){
    const prev=segs[i-1];
    assert.deepEqual(graph[b+6].inputs.image,[String(b-30+11),0]);
    assert.equal(graph[b+6].inputs.batch_index,prev.contextFrames+prev.length-1);
    assert.equal(graph[b+7].inputs.frame_idx,0,'Anchor exact matching overlap, not a future frame');
  }
}
// Interpret the actual built graph's frame operations. Check guide padding and
// export on short cuts/non-grid tails rather than just rechecking the planner.
for(const [frames,cuts] of [[6,[]],[107,[]],[121,[1,2,55]],[1440,[106,107,555]]]){
  const g=h3GraphForInputs(manifest,{...names,source:{...source,totalFrames:frames,sceneCuts:cuts}}),cache=new Map();
  const values=link=>{
    const id=String(link[0]);if(cache.has(id))return cache.get(id);
    const {class_type:t,inputs:n}=g[id];let v;
    if(t==='VHS_LoadVideo')v=Array.from({length:n.frame_load_cap},(_,i)=>n.skip_first_frames+i);
    else if(t==='ImageFromBatch')v=values(n.image).slice(n.batch_index,n.batch_index+n.length);
    else if(t==='RepeatImageBatch')v=Array.from({length:n.amount},()=>values(n.image)).flat();
    else if(t==='ImageBatch')v=[...values(n.image1),...values(n.image2)];
    else if(t==='ImageBatchMulti')v=Array.from({length:n.inputcount},(_,i)=>values(n['image_'+(i+1)])).flat();
    else if(t==='ImageCrop')v=values(n.image);
    else if(t==='VAEDecode'){
      const sampler=g[n.samples[0]],condition=g[sampler.inputs.latent_image[0]],b=Number(sampler.inputs.latent_image[0])-4;
      v=values(g[b+5].inputs.image);
      assert.equal(v.length,condition.inputs.length,'Every guide frame survives native Add Guide');
      const segment=h3Segments(frames,cuts).find(s=>s.loadStart===g[b].inputs.skip_first_frames);
      assert.ok(v.every(x=>x<segment.start+segment.length),'Padding must not leak a frame from next model window');
    }else throw Error('Unexpected frame operation '+t);
    cache.set(id,v);return v;
  };
  assert.deepEqual(values(g['490'].inputs.images),Array.from({length:frames},(_,i)=>i));
}
assert.deepEqual(graph['490'].inputs.audio,['50',0]);
assert.equal(graph['50'].inputs.duration,60,'Full original soundtrack, not first-segment audio');
const silent=h3GraphForInputs(manifest,{...args,source:{...source,hasAudio:false}});
assert.ok(!silent['50']);assert.ok(!('audio' in silent['490'].inputs));
for(const unsafe of ['../secret','/etc/passwd','https://example.com/video.mp4'])assert.throws(()=>h3GraphForInputs(manifest,{...args,videoName:unsafe}),/upload/);
for(const change of [{canvasWidth:512},{outputWidth:720},{padLeft:0},{totalFrames:1441},{hasAudio:undefined}])
  assert.throws(()=>h3GraphForInputs(manifest,{...args,source:{...source,...change}}));
const another=h3GraphForInputs(manifest,{...args,imageName:'api/other-photo.png'});
assert.equal(another['30'].inputs.image,'api/other-photo.png');
assert.equal(graph['30'].inputs.image,'api/current-photo.png','No cross-request identity mutation');

// Exercise the production provider boundary without credentials or paid jobs.
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=server.indexOf('async function createTask('),end=server.indexOf('const upload = multer(',begin);
const calls=[],uploads=[];let response={code:0,data:{taskId:'2113333333333333333',taskStatus:'RUNNING'}};
const context={workflowGraphs:{minimaxH3:manifest,current:{unchanged:true}},h3GraphForInputs,
  uploadToRunningHub:async(key,file)=>{uploads.push(file);return 'api/'+file.originalname;},
  runningHubInstanceType,explicitQueueMaxed,queueCapacityError,graphValidationError,
  rhJson:async(url,key,payload)=>{calls.push({url,payload});return response;}};
vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
const request={apiKey:'fixture-only',workflowId:'owner-workflow',workflowKey:'minimaxH3',mode:'plus',
  imageFile:{originalname:'original-photo.png'},videoFile:{originalname:'unprepared.mp4'},
  h3Source:{...source,file:{originalname:'motion-guide.mp4'}}};
await context.createTask(request);
assert.equal(uploads.length,2,'Only original photo and aligned guide, no 1080 source composite');
assert.equal(uploads[0],request.imageFile,'Original photo is not resized or re-encoded before upload');
assert.equal(calls[0].payload.instanceType,'plus');assert.equal(calls[0].payload.workflowId,'owner-workflow');
assert.equal(calls[0].payload.retainSeconds,undefined);assert.equal(calls[0].payload.nodeInfoList.length,0);
assert.equal(JSON.parse(calls[0].payload.workflow)['7'].inputs.lora_name,H3_MODELS.motion);
await context.createTask({...request,workflowKey:'current',h3Source:null});
assert.equal(calls[1].payload.retainSeconds,259200);
assert.equal(calls[1].payload.workflow,JSON.stringify({unchanged:true}));
const srgb={originalname:'reference-srgb.png'};
await context.createTask({...request,h3Source:{...request.h3Source,referenceFile:srgb}});
assert.equal(uploads.at(-2),srgb,'ICC-normalized reference, when present, must reach RunningHub');
let count=calls.length,uploaded=uploads.length;
await assert.rejects(context.createTask({...request,mode:'standard'}),/Plus/);
await assert.rejects(context.createTask({...request,h3Source:null}),/Metadata/);
assert.equal(calls.length,count);assert.equal(uploads.length,uploaded);
response={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},
  node_errors:{7:{class_type:'LoraLoaderModelOnly',errors:[{message:'Value not in list'}]}}})};
await assert.rejects(context.createTask(request),isDefinitelyRejectedGraph);
assert.equal(calls.length,count+1,'No alternate model, resolution or paid retry after rejection');
context.rhJson=async()=>{throw Error('transport timeout');};
await assert.rejects(context.createTask(request),e=>!isDefinitelyRejectedGraph(e)&&/timeout/.test(e.message));
assert.ok(!server.includes('minimaxH3Review'),'Head-only prototype is not a live workflow');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(html.includes('MiniMax H3 · Motion Control'));assert.ok(!html.includes('h3-review.html'));
assert.ok(!fs.existsSync(new URL('../public/h3-review.html',import.meta.url)));

// Real input media: photo ratio owns output, source timing owns frame count.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-h3-motion-check-'));
const ff=args=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1',...args],{timeout:60000});
const inspect=p=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',p],{encoding:'utf8'}));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try{
  const photo=path.join(dir,'photo.png'),video=path.join(dir,'source.mp4');
  ff(['-f','lavfi','-i','testsrc2=size=108x192','-frames:v','1','-threads','1',photo]);
  ff(['-f','lavfi','-i','testsrc2=size=192x320:rate=30:duration=1.3','-f','lavfi','-i',
    'sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
  const photoHash=hash(photo),videoHash=hash(video);
  const tagged=path.join(dir,'tagged.png'),normalized=path.join(dir,'normalized.png');
  execFileSync('python3',['-c',
    'from PIL import Image,ImageCms; import sys; im=Image.open(sys.argv[1]); im.save(sys.argv[2],icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())',photo,tagged]);
  const taggedHash=hash(tagged);
  const managed=await prepareH3Reference({path:tagged},normalized);
  assert.equal(managed.file.path,normalized);
  assert.equal(managed.color.convertedToSrgb,true);
  assert.equal(managed.color.resized,false);
  assert.deepEqual([managed.color.width,managed.color.height],[108,192]);
  assert.equal(hash(tagged),taggedHash,'ICC conversion must not overwrite the original upload');
  const probe=await probeH3Input({path:video},'plus');
  assert.ok(Math.abs(probe.duration-1.3)<.04,'Do not use longer audio/container duration');
  const prepared=await prepareH3Input({path:video},'plus',{path:photo});
  try{
    const tracks=inspect(prepared.file.path).streams,v=tracks.find(s=>s.codec_type==='video');
    assert.deepEqual([v.width,v.height],[1088,1920]);assert.equal(v.r_frame_rate,'24/1');
    assert.equal(Number(v.nb_frames),prepared.totalFrames);assert.ok(tracks.some(s=>s.codec_type==='audio'));
    assert.deepEqual([prepared.outputWidth,prepared.outputHeight],[1080,1920],'Photo ratio, not 192:320 guide ratio');
    assert.equal(prepared.referenceFile.path,photo,'An untagged RGB photo remains byte-for-byte original');
    assert.equal(prepared.referenceColor.convertedToSrgb,false);
    assert.equal(prepared.referenceColor.resized,false);
    assert.equal(hash(photo),photoHash);assert.equal(hash(video),videoHash,'Do not overwrite uploads');
  }finally{await prepared.release();}
  assert.ok(!fs.existsSync(prepared.file.path));
  const cuts=path.join(dir,'cuts.mp4');
  ff(['-f','lavfi','-i','color=red:s=160x288:r=24:d=0.5','-f','lavfi','-i',
    'color=blue:s=160x288:r=24:d=0.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]',cuts]);
  const cutSource=await prepareH3Input({path:cuts},'plus',{path:photo});
  try{assert.deepEqual(cutSource.sceneCuts,[12]);assert.equal(cutSource.hasAudio,false);
    assert.equal(h3Segments(cutSource.totalFrames,cutSource.sceneCuts).length,1,
      'A short guide cut remains in the guide without starting a new generative pass');
  }finally{await cutSource.release();}
  // Read actual MP4 rotation metadata, then ensure the prepared guide follows
  // the displayed source. Compare tiny thumbnails after removing only padding.
  const base=path.join(dir,'orientation.mp4');
  ff(['-f','lavfi','-i','testsrc2=size=192x108:rate=24:duration=0.5','-vf','drawbox=x=4:y=4:w=40:h=25:color=white:t=fill',base]);
  for(const degrees of [90,180]){
    const rotated=path.join(dir,'rotated-'+degrees+'.mp4');
    ff(['-i',base,'-c','copy','-metadata:s:v:0','rotate='+degrees,rotated]);
    const p=await prepareH3Input({path:rotated},'plus',{path:photo});
    try{
      const w=p.sourceWidth,h=p.sourceHeight;
      const factor=Math.min(p.outputWidth/w,p.outputHeight/h);
      const activeW=Math.floor(w*factor/2)*2,activeH=Math.floor(h*factor/2)*2;
      const crop=`crop=${activeW}:${activeH}:${Math.floor((p.canvasWidth-activeW)/2)}:${Math.floor((p.canvasHeight-activeH)/2)},`;
      const frame=(file,filter)=>ff(['-i',file,'-vf',filter+'scale=64:64:flags=lanczos','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
      const expected=frame(rotated,''),actual=frame(p.file.path,crop);
      const mae=actual.reduce((sum,n,i)=>sum+Math.abs(n-expected[i]),0)/actual.length;
      assert.ok(mae<5,`Displayed orientation must survive ${degrees} degrees (${mae})`);
    }finally{await p.release();}
  }
  const invalid=path.join(dir,'invalid.mp4');fs.writeFileSync(invalid,'bad-media');
  await assert.rejects(probeH3Input({path:invalid},'plus'),/video H3 tidak dapat dibaca/);
  await assert.rejects(prepareH3Input({path:video},'plus',{path:invalid}),/gambar H3 tidak dapat dibaca/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: H3 full-photo motion graph, native 1080 canvas, exhaustive timeline/cut/padding coverage, real audio/orientation, isolated inputs, and provider boundary. GPU/visual acceptance untested.');
