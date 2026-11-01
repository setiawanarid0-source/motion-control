// Explicit fifteen-second clothed trial; never select a private user upload.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import axios from 'axios';
import {findValidationRejection} from './runninghub-graph-validation.js';
const run=promisify(execFile);
export const LONG_H3_JOB='a7bbd9f5-6d77-4df7-b7ac-fbdc8cc18015';
export const LONG_H3_TOKEN='safe-dmad15-large-20261101-v1';
const DEVICE='h3-safe-long-benchmark-20261101-v1';
const IMAGE='H3-safe-reference-large.png',VIDEO='H3-safe-guide-15s.mp4';
export const LONG_H3_ASSETS=Object.freeze([
  {name:'portrait.jpg',url:'https://upload.wikimedia.org/wikipedia/commons/2/2c/Samantha_Cristoforetti_official_portrait.jpg',
    sha:'7018a5a3dc37452bf7532436cb5924af4516fce32f1ff0c4bd7e649b7834e345'},
  {name:'motion-demo.mp4',url:'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/examples/character_swap_v1.0_1.mp4',
    sha:'0bb85d33ff2d1dc69b015d77715888d0388903c8582e97cd0f6bd7253b85355d'}
]);
export function longH3Profile(job){
  return job?.jobId===LONG_H3_JOB&&job.deviceId===DEVICE&&job.image?.originalname===IMAGE&&job.video?.originalname===VIDEO?
    'guide-dmad4-focus':null;
}
export function longH3ModelChoices(response){
  const rejected=findValidationRejection(response);
  if(!rejected)return null;
  const options=[];
  for(const node of Object.values(rejected.node_errors||{})){
    if(node?.class_type!=='LoraLoaderModelOnly')continue;
    for(const error of node.errors||[]){
      const names=error.extra_info?.input_config?.[0];
      if(Array.isArray(names))for(const name of names)
        if(typeof name==='string'&&name.length<240&&!name.includes('..')&&
          /^[A-Za-z0-9_./ ()-]+\.safetensors$/.test(name)&&/minimax.*dmad.*4step/i.test(name))options.push(name);
    }
  }
  return {type:rejected.error?.type,dmad4Options:[...new Set(options)].slice(0,12)};
}
export function longH3Result(task,queue){
  const job=queue.read(LONG_H3_JOB);
  if(!longH3Profile(job)||String(job.task?.taskId)!==String(task?.taskId))return null;
  return {taskId:String(task.taskId),status:task.status,providerRuntimeSeconds:task.providerRuntimeSeconds??null,
    submittedAt:task.submittedAt,finishedAt:task.finishedAt,resultUrl:task.resultUrl||null,
    inferenceProfile:longH3Profile(job)};
}
export async function stageLongH3Benchmark({queue,checkpointDir,
  download=async asset=>Buffer.from((await axios.get(asset.url,{responseType:'arraybuffer',timeout:60000,
    headers:{'User-Agent':'VantaTechnicalBenchmark/1.0 (non-commercial local workflow test)'},
    maxContentLength:20*1024*1024,maxBodyLength:20*1024*1024})).data),execute=run}){
  const old=queue.read(LONG_H3_JOB);
  if(old)return {jobId:LONG_H3_JOB,stage:old.stage,reused:true};
  // Keep the once-only guard beyond the queue's three-day retention. A crash,
  // failed download, rejection or later redeploy cannot create a paid repeat.
  await fs.mkdir(checkpointDir,{recursive:true,mode:0o700});
  try{await fs.writeFile(path.join(checkpointDir,LONG_H3_JOB+'.json'),
    JSON.stringify({jobId:LONG_H3_JOB,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')return {jobId:LONG_H3_JOB,stage:'checkpointed',reused:true};throw error;}
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-long-safe-'));
  try{
    for(const asset of LONG_H3_ASSETS){
      const data=await download(asset);
      if(createHash('sha256').update(data).digest('hex')!==asset.sha)throw Error('Approved long fixture hash mismatch');
      await fs.writeFile(path.join(dir,asset.name),data);
    }
    const image=path.join(dir,IMAGE),guide=path.join(dir,'guide-5s.mp4'),video=path.join(dir,VIDEO);
    // NASA/Robert Markowitz public-domain portrait, inspected fully clothed.
    // Native-pixel crop, no resize: the padded H3 reference is 4.608MP,
    // comparable to the 4.588MP total reference pixels in the slow user task.
    await execute(process.env.VANTA_MEDIA_PYTHON||'python3',['-c',
      'from PIL import Image; import sys; im=Image.open(sys.argv[1]); assert im.size==(3200,4000); im.crop((800,100,2400,2950)).save(sys.argv[2])',
      path.join(dir,'portrait.jpg'),image],{timeout:60000,maxBuffer:65536});
    await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss','2.958333',
      '-i',path.join(dir,'motion-demo.mp4'),'-vf','crop=544:928:0:72','-t','5','-frames:v','120','-an',
      '-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-threads','2',guide],{timeout:60000,maxBuffer:65536});
    await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-stream_loop','2','-i',guide,
      '-t','15','-c','copy',video],{timeout:60000,maxBuffer:65536});
    return await queue.stage({jobId:LONG_H3_JOB,deviceId:DEVICE,
      body:{workflow:'minimaxH3',mode:'plus',accountId:'auto'},
      image:{path:image,originalname:IMAGE,mimetype:'image/png',size:(await fs.stat(image)).size},
      video:{path:video,originalname:VIDEO,mimetype:'video/mp4',size:(await fs.stat(video)).size}});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export async function runLongH3Deployment({rootDir,token,stage=stageLongH3Benchmark,...args}){
  if(rootDir!=='/data'||token!==LONG_H3_TOKEN)return null;
  return stage({...args,checkpointDir:path.join(rootDir,'h3-benchmark-checkpoints')});
}
