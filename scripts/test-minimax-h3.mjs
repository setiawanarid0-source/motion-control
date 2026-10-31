import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {H3_FPS,H3_LORA,H3_TASK,H3_PROMPT,validateH3Probe,probeH3Input,prepareH3Input,h3Segments,h3GraphForInputs} from '../minimax-h3.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
import {explicitQueueMaxed,queueCapacityError} from '../runninghub-capacity.js';
import {graphValidationError,isDefinitelyRejectedGraph} from '../runninghub-graph-validation.js';

const graph=JSON.parse(fs.readFileSync(new URL('../workflows/minimax-h3-character-swap-api.json',import.meta.url)));
const raw=JSON.stringify(graph);
const probe=(duration=60,width=1080,height=1920)=>({streams:[
  {codec_type:'video',width,height,duration:String(duration)},
  {codec_type:'audio',duration:'65'}],format:{duration:'65'}});
const source=validateH3Probe(probe());
assert.deepEqual([source.width,source.height,source.totalFrames,source.fps],[480,864,1440,24]);
const plus=validateH3Probe(probe(),'plus');
assert.deepEqual([plus.width,plus.height],[640,1152]);
assert.deepEqual([source.outputWidth,source.outputHeight],[1080,1920]);
assert.deepEqual([validateH3Probe(probe(5,1920,1080)).outputWidth,validateH3Probe(probe(5,1920,1080)).outputHeight],[1920,1080]);
assert.deepEqual([validateH3Probe(probe(5,1920,1080)).width,validateH3Probe(probe(5,1920,1080)).height],[864,480]);
const rotated=probe(5,1920,1080);rotated.streams[0].side_data_list=[{rotation:-90}];
assert.deepEqual([validateH3Probe(rotated).width,validateH3Probe(rotated).height],[480,864]);
for(const seconds of [0,.1,61,Infinity])assert.throws(()=>validateH3Probe(probe(seconds)),/0,25–60/);
assert.throws(()=>validateH3Probe({streams:[]}),/dimensi/);
assert.throws(()=>validateH3Probe(probe(),'lite'),/Standard atau Plus/);

// Check every possible supported duration, including non-multiples of 5s.
for(let frames=6;frames<=1440;frames++){
  const ranges=h3Segments(frames);
  let cursor=0;
  for(const segment of ranges){
    assert.equal(segment.start,cursor,'No gaps, repeated source frames or timeline reset');
    assert.ok(segment.length>=6&&segment.length<=120);
    cursor+=segment.length;
  }
  assert.equal(cursor,frames,'The whole source must be covered, including the final segment');
}
const names={imageName:'api/ref.jpg',videoName:'api/guide.mp4',sourceVideoName:'api/source-1080.mp4'};
const rendered=h3GraphForInputs(graph,{...names,source});
const timeline=JSON.parse(rendered['331'].inputs.timeline_data);
assert.equal(JSON.stringify(graph),raw,'Never mutate a shared workflow between accounts or requests');
assert.equal(timeline.video.videoFile,'api/guide.mp4');
assert.equal(timeline.global.refs[0].imageFile,'api/ref.jpg');
assert.equal(timeline.global.taskType,H3_TASK);
assert.equal(timeline.global.prompt,H3_PROMPT);
assert.equal(timeline.segments.length,12);
assert.equal(timeline.output.audioMode,'source');
assert.equal(timeline.output.continuityEnabled,true);
assert.equal(timeline.output.continuityKeepTail,false,'No H3 alignment/prefix frames may extend the final video');
assert.equal(timeline.output.maxExportFrames,1440);
assert.equal(timeline.output.exportMode,'all','One final video, not separate segment outputs');
assert.equal(rendered['5'].inputs.lora_name,H3_LORA);
assert.equal(rendered['5'].inputs.strength_model,1);
assert.deepEqual(rendered['331'].inputs.model,['5',0],'LoRA must be in the actual sampling model path');
assert.deepEqual(rendered['490'].inputs.images,['493',0]);
assert.deepEqual(rendered['493'].inputs.cropped_images,['331',0]);
assert.deepEqual(rendered['493'].inputs.original_images,['33',0],'Body and background come from the 1080p source');
assert.deepEqual(rendered['493'].inputs.cropped_masks,['492',0],'Never paste the entire generated frame');
assert.equal(rendered['493'].inputs.resize_method,'lanczos');
assert.equal(rendered['33'].inputs.video,'api/source-1080.mp4');
assert.equal(rendered['33'].inputs.frame_load_cap,1440);
assert.equal(rendered['331'].inputs.export_source_images,true);
assert.deepEqual(rendered['490'].inputs.audio,['33',2],'Use the actual source soundtrack');
assert.deepEqual(rendered['490'].inputs.frame_rate,['331',2]);
for(const node of Object.values(rendered))for(const input of Object.values(node.inputs)){
  if(Array.isArray(input)){assert.ok(rendered[input[0]],'Dangling graph link');assert.ok(Number.isInteger(input[1]));}
}
const single=h3GraphForInputs(graph,{...names,videoName:'b.mp4',source:validateH3Probe(probe(2.3))});
assert.equal(JSON.parse(single['331'].inputs.timeline_data).output.continuityEnabled,false);
assert.notEqual(single['331'].inputs.cache_name,rendered['331'].inputs.cache_name,'No cross-job segment cache reuse');
for(const unsafe of ['../secret','/etc/passwd','https://example.com/video.mp4'])
  assert.throws(()=>h3GraphForInputs(graph,{...names,videoName:unsafe,source}),/upload/);
assert.throws(()=>h3GraphForInputs(graph,{...names,sourceVideoName:'../secret',source}),/upload/);

// Never blend source camera/context from the preceding scene into a new shot.
const shots=h3Segments(1440,[121,122,555]);
assert.equal(shots.reduce((n,s)=>n+s.length,0),1440);
for(const cut of [121,122,555]){
  assert.equal(shots.find(s=>s.start===cut)?.continuityFromPrev,false);
  assert.ok(shots.every(s=>!(s.start<cut&&s.start+s.length>cut)));
}
const sceneGraph=h3GraphForInputs(graph,{...names,source:{...source,sceneCuts:[121,122,555]}});
const shotTimeline=JSON.parse(sceneGraph['331'].inputs.timeline_data);
assert.deepEqual(shotTimeline.global.refs,[{index:0,imageFile:names.imageName}]);
for(let i=0;i<shotTimeline.segments.length;i++){
  const seg=shotTimeline.segments[i],id=1000+i*30;
  assert.equal(sceneGraph[String(id)].inputs.batch_index,seg.start);
  assert.equal(sceneGraph[String(id)].inputs.length,seg.length);
  assert.deepEqual(sceneGraph[String(id+4)].inputs.image,['331',4]);
  assert.equal(sceneGraph[String(id+16)].inputs.operation,'subtract','Original hands remain in front of the head');
}
assert.match(H3_PROMPT,/Do not transfer the reference picture's body, outfit/);

// Run the actual production createTask function against a recording provider.
// No network calls, API keys or paid tasks are needed for this test.
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=server.indexOf('async function createTask(');
const create=server.slice(begin,server.indexOf('const upload = multer(',begin));
const calls=[],uploads=[];
let response={code:0,data:{taskId:'2113333333333333333',taskStatus:'RUNNING'}};
const context={workflowGraphs:{minimaxH3:graph,current:{unchanged:true}},h3GraphForInputs,
  uploadToRunningHub:async(key,file)=>{uploads.push({key,file});return 'api/'+file.originalname;},
  runningHubInstanceType,explicitQueueMaxed,queueCapacityError,graphValidationError,
  rhJson:async(url,key,payload)=>{calls.push({url,key,payload});return response;}};
vm.createContext(context);vm.runInContext(create+'\nthis.createTask=createTask;',context);
const args={apiKey:'fixture-not-a-real-key',workflowId:'owner-workflow',workflowKey:'minimaxH3',
  mode:'plus',imageFile:{originalname:'ref.jpg'},videoFile:{originalname:'guide.mp4'},
  h3Source:{...source,file:{originalname:'guide.mp4'},sourceFile:{originalname:'source-1080.mp4'}}};
const result=await context.createTask(args);
assert.equal(result.taskStatus,'RUNNING');
assert.equal(calls[0].payload.instanceType,'plus');
assert.equal(calls[0].payload.workflowId,'owner-workflow','Keep the existing owner-accessible workflow ID');
assert.equal(calls[0].payload.retainSeconds,undefined,'H3 must not reserve a 72-hour paid GPU instance');
assert.equal(calls[0].payload.nodeInfoList.length,0,'H3 must not override non-existent legacy image/video nodes');
assert.equal(JSON.parse(calls[0].payload.workflow)['5'].inputs.lora_name,H3_LORA);
assert.equal(uploads.length,3,'Upload the image, H3 guide and original 1080p video separately');
await context.createTask({...args,workflowKey:'current',h3Source:undefined});
assert.equal(calls[1].payload.workflow,JSON.stringify({unchanged:true}));
assert.equal(calls[1].payload.retainSeconds,259200,'Existing workflow behavior is unchanged');
assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload.nodeInfoList)).map(n=>n.nodeId),['30','33','331']);
response={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},
  node_errors:{331:{class_type:'MiniMaxH3Director',errors:[{message:'Required input missing'}]}}})};
await assert.rejects(context.createTask(args),isDefinitelyRejectedGraph,'Provider rejection must not turn into an unknown paid job');
const before=calls.length;
await assert.rejects(context.createTask({...args,h3Source:null}),/Metadata/);
assert.equal(calls.length,before,'Missing H3 metadata must not create a paid task');

// Probe real media with a different FPS and audio track, keeping the source bytes unchanged.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-h3-check-'));
try{
  const file=path.join(dir,'source.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=192x320:rate=30:duration=1.3',
    '-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file],{timeout:30000});
  const hash=()=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const original=hash();
  const real=await probeH3Input({path:file},'standard');
  assert.ok(Math.abs(real.duration-1.3)<.04,'Use video duration, not the longer audio track');
  assert.ok(Math.abs(real.totalFrames/H3_FPS-real.duration)<=1/H3_FPS);
  assert.equal(hash(),original,'Never compensate, crop, stretch or re-encode the H3 driving source');
  const prepared=await prepareH3Input({path:file},'standard');
  try{
    const media=p=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',p],{encoding:'utf8'}));
    const a=media(prepared.file.path),b=media(prepared.sourceFile.path);
    const guide=a.streams.find(s=>s.codec_type==='video'),hi=b.streams.find(s=>s.codec_type==='video');
    assert.equal(guide.r_frame_rate,'24/1');assert.equal(hi.r_frame_rate,'24/1');
    assert.equal(guide.nb_frames,hi.nb_frames,'Both video paths must be frame-for-frame aligned');
    assert.equal(Number(hi.nb_frames),prepared.totalFrames);
    assert.deepEqual([hi.width,hi.height],[1080,1800],'Preserve source aspect without cropping');
    assert.deepEqual([guide.width,guide.height],[prepared.width,prepared.height]);
    assert.ok(b.streams.some(s=>s.codec_type==='audio'));
    assert.ok(!a.streams.some(s=>s.codec_type==='audio'),'The guide cannot supply a generated soundtrack');
    assert.equal(hash(),original,'Prepare independent files, never overwrite the user upload');
  }finally{await prepared.release();}
  assert.equal(fs.existsSync(prepared.file.path),false);

  const cutsFile=path.join(dir,'cuts.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=red:s=160x288:r=24:d=0.5',
    '-f','lavfi','-i','color=blue:s=160x288:r=24:d=0.5','-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]',cutsFile],{timeout:30000});
  const cutsPrepared=await prepareH3Input({path:cutsFile},'standard');
  try{assert.deepEqual(cutsPrepared.sceneCuts,[12]);
    assert.equal(h3Segments(cutsPrepared.totalFrames,cutsPrepared.sceneCuts)[1].continuityFromPrev,false);
  }finally{await cutsPrepared.release();}
  // Preserve the displayed orientation, including real MP4 rotation matrices.
  const baseFile=path.join(dir,'orientation.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
    'testsrc2=size=192x108:rate=24:duration=0.5','-vf','drawbox=x=4:y=4:w=40:h=25:color=white:t=fill',baseFile]);
  const modern=String(execFileSync('ffmpeg',['-hide_banner','-h','full'],{maxBuffer:4*1024*1024})).includes('-display_rotation');
  const firstFrame=p=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',p,
    '-vf','scale=64:64:flags=lanczos','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  for(const degrees of [90,180]){
    const rotatedFile=path.join(dir,'rotated-'+degrees+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error',
      ...(modern?['-display_rotation',String(degrees)]:[]),'-i',baseFile,'-c','copy',
      ...(!modern?['-metadata:s:v:0','rotate='+degrees]:[]),rotatedFile]);
    const rotatedPrepared=await prepareH3Input({path:rotatedFile},'standard');
    try{
      const expected=firstFrame(rotatedFile),actual=firstFrame(rotatedPrepared.sourceFile.path);
      const mae=actual.reduce((sum,n,i)=>sum+Math.abs(n-expected[i]),0)/actual.length;
      assert.ok(mae<5,`H3 must not introduce a ${degrees}° orientation error (${mae})`);
    }finally{await rotatedPrepared.release();}
  }
  const invalid=path.join(dir,'invalid.mp4');fs.writeFileSync(invalid,'bad-media');
  await assert.rejects(probeH3Input({path:invalid},'standard'),/tidak dapat dibaca/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: H3 face/hair masked 1080p source composite, scene resets, aligned real media, full timeline, original audio, isolated inputs and provider payload');
