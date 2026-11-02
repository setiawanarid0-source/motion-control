// Temporary, private admission for one explicitly reviewed, fully clothed case.
// No account keys, uploads or result URLs are written to Git or public logs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {findValidationRejection} from './runninghub-graph-validation.js';

const DEVICE='h3-consistency-20261102';
const TRIALS=Object.freeze({
  'ffp-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa001',profile:'guide-dmad4-ffp'},
  'ffp-upload-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa002',profile:'guide-dmad4-ffp'},
  'ffp-anchor-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa003',profile:'guide-dmad4-ffp'},
  'character-regression5-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa004',profile:'guide-dmad4-character-caption',
    imageName:'h3-consistency-reference.png',imageType:'image/png',media:{
      image:'ad44678f62e2f0d9a5330caa0dd9bf06b63ddde5f481f39cb741f6214ba03636',
      video:'bb2d5ce87ea240bff1dbd3600e58681c00a2c89bee6630f574e6bec6f9e80fc1'}},
  'ffp-private5-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa005',profile:'guide-dmad4-ffp',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'1bb15f1d4d1dee8d7d28757b742f8764a0a18cc9725e603bcee938c4eb3f316a'}},
  'motion-private5-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa006',profile:'guide-dmad4-motion-anchor',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'1bb15f1d4d1dee8d7d28757b742f8764a0a18cc9725e603bcee938c4eb3f316a'}},
  'ffpfocus-private5-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa007',profile:'guide-dmad4-ffp-focus',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'1bb15f1d4d1dee8d7d28757b742f8764a0a18cc9725e603bcee938c4eb3f316a'}},
  'character-private5-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa008',profile:'guide-dmad4-character-caption',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'1bb15f1d4d1dee8d7d28757b742f8764a0a18cc9725e603bcee938c4eb3f316a'}},
  'character-private15-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa009',profile:'guide-dmad4-character-caption'},
  'native-pose-screen2-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa010',profile:'native-fun-pose4-caption',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'28ebc11903ee5b00bfa1ac0b9a0c3f74e2b9cb379682fa8c586bb2df4b078452'}},
  'native-pose-full15-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa011',profile:'native-fun-pose4-caption'},
  'native-pose8-screen2-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa012',profile:'native-fun-pose8-caption',media:{
    image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
    video:'28ebc11903ee5b00bfa1ac0b9a0c3f74e2b9cb379682fa8c586bb2df4b078452'}},
  'native-pose8-full15-v1':{jobId:'b3e714a1-f769-4aec-a919-447f953fa013',profile:'native-fun-pose8-caption'}
});
const MEDIA=Object.freeze({
  image:'c6faff7a25e0726babc5830ddd806b586656b39763909f53b33e2b20b27c90a4',
  video:'217f2e11a9da490d0fb7fb7fbf3aef49f24cb56618bc0eb74184e6ff9593ab50'
});
export function consistencyH3Profile(job){
  const trial=Object.values(TRIALS).find(t=>t.jobId===job?.jobId);
  return trial&&job.deviceId===DEVICE&&job.image?.originalname===(trial.imageName||'h3-consistency-reference.jpg')&&
    job.video?.originalname==='h3-consistency-driving.mp4'?trial.profile:null;
}
export function consistencyTrialAuthorized(token,hash,expires,now=Date.now()){
  if(!/^[a-f0-9]{64}$/.test(String(hash||''))||typeof token!=='string'||!/^\w{64}$/.test(token)||
    !Number.isFinite(Date.parse(expires))||now>=Date.parse(expires))return false;
  return timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(hash,'hex'));
}
export async function verifyConsistencyMedia({image,video,caseName='ffp-anchor-v1'}){
  const trial=TRIALS[caseName];
  if(!trial||!image?.path||!video?.path||image.mimetype!==(trial.imageType||'image/jpeg')||video.mimetype!=='video/mp4')
    throw Error('Berkas uji tidak sesuai.');
  for(const [name,file] of Object.entries({image,video})){
    const bytes=await fs.readFile(file.path);
    if(createHash('sha256').update(bytes).digest('hex')!==(trial.media||MEDIA)[name])throw Error('Checksum berkas uji tidak sesuai.');
  }
}
export async function stageConsistencyTrial({queue,rootDir,caseName,image,video,verify=verifyConsistencyMedia,
  checkpointDir=path.join(rootDir,'h3-benchmark-checkpoints')}){
  const trial=TRIALS[caseName];
  if(!trial||rootDir!=='/data')throw Error('Kasus uji tidak tersedia.');
  const old=queue.read(trial.jobId);
  if(old)return {jobId:trial.jobId,stage:old.stage,reused:true};
  await verify({image,video,caseName});
  await fs.mkdir(checkpointDir,{recursive:true,mode:0o700});
  try{await fs.writeFile(path.join(checkpointDir,trial.jobId+'.json'),
    JSON.stringify({jobId:trial.jobId,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')return {jobId:trial.jobId,stage:'checkpointed',reused:true};throw error;}
  return queue.stage({jobId:trial.jobId,deviceId:DEVICE,body:{workflow:'minimaxH3',mode:'plus',accountId:'auto'},
    image:{...image,originalname:trial.imageName||'h3-consistency-reference.jpg'},
    video:{...video,originalname:'h3-consistency-driving.mp4'}});
}
export function consistencyModelChoices(response){
  const rejected=findValidationRejection(response);
  if(!rejected)return null;
  const options=[];
  const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):
    value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
  for(const node of Object.values(rejected.node_errors||{})){
    if(!['LoraLoaderModelOnly','RHLoraLoader','CLIPLoader'].includes(node?.class_type))continue;
    for(const error of node.errors||[]){
      const names=strings(error.extra_info?.input_config);
      for(const name of names)
        if(typeof name==='string'&&name.length<240&&!name.includes('..')&&
          /^[A-Za-z0-9_./ ()-]+\.safetensors$/.test(name)&&
          (node.class_type==='CLIPLoader'?/qwen/i.test(name):/(?:minimax|h3).*(motion_transfer|character_swap|DMAD)/i.test(name)))options.push(name);
    }
  }
  return {type:rejected.error?.type,options:[...new Set(options)].slice(0,30),
    errors:Object.entries(rejected.node_errors||{}).slice(0,3).map(([id,node])=>({id,class:node.class_type,
      errors:(node.errors||[]).slice(0,5).map(e=>({type:String(e.type||'').slice(0,80),
        message:String(e.message||'').slice(0,160),details:String(e.details||'').slice(0,500)}))}))};
}
export function installConsistencyTrial({app,upload,queue,rootDir,getTask,cancelTask,diagnoseTask,hash,expires}){
  // Registered before owner login solely for this separate expiring credential.
  // With no deployment gate, these routes do not exist.
  if(!/^[a-f0-9]{64}$/.test(String(hash||''))||!Number.isFinite(Date.parse(expires)))return;
  const authorized=(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!consistencyTrialAuthorized(req.get('X-Vanta-H3-Trial'),hash,expires))return res.sendStatus(404);
    if(!Object.hasOwn(TRIALS,req.params.caseName))return res.sendStatus(404);
    next();
  };
  const route='/api/internal/h3-consistency/:caseName';
  app.post(route+'/cancel',authorized,async(req,res)=>{
    const job=queue.read(TRIALS[req.params.caseName].jobId);
    const task=job?.task?.taskId?getTask(String(job.task.taskId)):null;
    if(!consistencyH3Profile(job)||!task||task.video!=='h3-consistency-driving.mp4'||
      task.inputDiagnostics?.inferenceProfile!==consistencyH3Profile(job)||!cancelTask)return res.sendStatus(404);
    if(['success','failed'].includes(task.status))return res.json({taskId:task.taskId,status:task.status});
    try{res.json(await cancelTask(task.taskId));}catch{res.status(502).json({error:'Penghentian uji belum terkonfirmasi.'});}
  });
  app.post(route,authorized,upload.fields([{name:'referenceImage',maxCount:1},{name:'videoReference',maxCount:1}]),async(req,res)=>{
    const image=req.files?.referenceImage?.[0],video=req.files?.videoReference?.[0];
    try{res.json(await stageConsistencyTrial({queue,rootDir,caseName:req.params.caseName,image,video}));}
    catch(error){res.status(400).json({error:error.message});}
    finally{for(const file of [image,video])if(file?.path)await fs.rm(file.path,{force:true}).catch(()=>{});}
  });
  app.get(route,authorized,async(req,res)=>{
    const trial=TRIALS[req.params.caseName],job=queue.read(trial.jobId);
    const task=job?.task?.taskId?getTask(String(job.task.taskId)):null;
    let failure=null;
    if(task?.status==='failed'&&diagnoseTask)try{failure=await diagnoseTask(task.taskId);}catch{}
    res.json({jobId:trial.jobId,stage:job?.stage||'not_staged',error:job?.error||null,
      failure,
      task:task?{taskId:task.taskId,status:task.status,providerRuntimeSeconds:task.providerRuntimeSeconds??null,
        resultUrl:task.resultUrl||null,error:task.error||null}:null});
  });
}
