// One explicit, idempotent, clothed-fixture inference test. No public endpoint.
// Use the existing durable submission queue and paid-task retry protections.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import axios from 'axios';
const run=promisify(execFile);
export const SAFE_H3_JOB='b5c72ed0-7e57-4a48-a55b-4ecd3ab790f1';
export const SAFE_H3_TOKEN='safe-noadapter-20261101-v1';
export const SAFE_H3_TARA_JOB='15ab386b-05a0-4d19-aa3b-154d13852cb2';
export const SAFE_H3_TARA_TOKEN='safe-tara-20261101-v1';
export const SAFE_H3_KITCHEN_JOB='501a6a84-09b4-4f22-93cf-fa85df57d346';
export const SAFE_H3_KITCHEN_TOKEN='safe-kitchen-20261101-v1';
export const SAFE_H3_SOL_JOB='6683bcb0-b420-40c2-8b9b-1bf6d4a1f8cd';
export const SAFE_H3_SOL_TOKEN='safe-sol-focus-20261101-v1';
export const SAFE_H3_SOL2_JOB='39d4603c-ee05-4b9a-8662-2836726a0b64';
export const SAFE_H3_SOL2_TOKEN='safe-sol-focus-shifted-20261101-v1';
export const SAFE_H3_SOLFAST_JOB='f77cda62-19be-4c36-b509-3b3877ffbe13';
export const SAFE_H3_SOLFAST_TOKEN='safe-sol-focus-free-20261101-v1';
const TRIALS=[{jobId:SAFE_H3_JOB,token:SAFE_H3_TOKEN,profile:'no-training-adapter'},
  {jobId:SAFE_H3_TARA_JOB,token:SAFE_H3_TARA_TOKEN,profile:'tara-native'},
  {jobId:SAFE_H3_KITCHEN_JOB,token:SAFE_H3_KITCHEN_TOKEN,profile:'guide-kitchen'},
  {jobId:SAFE_H3_SOL_JOB,token:SAFE_H3_SOL_TOKEN,profile:'guide-sol-focus'},
  {jobId:SAFE_H3_SOL2_JOB,token:SAFE_H3_SOL2_TOKEN,profile:'guide-sol-focus'},
  {jobId:SAFE_H3_SOLFAST_JOB,token:SAFE_H3_SOLFAST_TOKEN,profile:'guide-sol-focus'}];
const DEVICE='h3-safe-benchmark-20261101-v1';
const ASSET='https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/examples/character_swap_v1.0_1.mp4';
const SHA='0bb85d33ff2d1dc69b015d77715888d0388903c8582e97cd0f6bd7253b85355d';
export function safeH3Profile(job){
  const trial=TRIALS.find(t=>t.jobId===job?.jobId);
  return trial&&job.deviceId===DEVICE&&
    job.image?.originalname==='H3-safe-reference.png'&&job.video?.originalname==='H3-safe-guide-5s.mp4'
    ?trial.profile:null;
}
// Coordinates refer only to the SHA-verified clothed fixture's reference pane.
// They are not reused for user uploads. A general detector is separate work.
export function safeH3FaceFocus(job){
  return safeH3Profile(job)==='guide-sol-focus'&&job.jobId!==SAFE_H3_SOLFAST_JOB?
    {x:192,y:224,width:160,height:192}:null;
}
export function safeH3Conditioning(job){
  return job?.jobId===SAFE_H3_SOLFAST_JOB&&safeH3Profile(job)==='guide-sol-focus'?'off':null;
}
export async function stageSafeH3Benchmark({queue,token=process.env.VANTA_H3_SAFE_BENCHMARK,
  download=async()=>Buffer.from((await axios.get(ASSET,{responseType:'arraybuffer',timeout:60000,
    maxContentLength:8*1024*1024,maxBodyLength:8*1024*1024})).data),execute=run}){
  const trial=TRIALS.find(t=>t.token===token);
  if(!trial)return null;
  const old=queue.read(trial.jobId);
  if(old)return {jobId:trial.jobId,stage:old.stage,reused:true};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-h3-safe-test-'));
  try{
    const data=await download();
    if(createHash('sha256').update(data).digest('hex')!==SHA)
      throw Error('Approved clothed benchmark source hash mismatch; no task submitted');
    const original=path.join(dir,'source.mp4'),image=path.join(dir,'reference.png'),video=path.join(dir,'guide.mp4');
    await fs.writeFile(original,data);
    // Isolate the reference and driving panes of the already-reviewed public
    // clothed demonstration. No private uploads or generated-output resizing.
    await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss','6','-i',original,
      '-vf','crop=544:928:816:72','-frames:v','1',image],{timeout:60000,maxBuffer:65536});
    await execute('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-ss','2.958333','-i',original,
      '-vf','crop=544:928:0:72','-t','5','-frames:v','120','-an','-c:v','libx264','-preset','fast',
      '-crf','16','-pix_fmt','yuv420p','-threads','2',video],{timeout:60000,maxBuffer:65536});
    return await queue.stage({jobId:trial.jobId,deviceId:DEVICE,
      body:{workflow:'minimaxH3',mode:'plus',accountId:'auto'},
      image:{path:image,originalname:'H3-safe-reference.png',mimetype:'image/png',size:(await fs.stat(image)).size},
      video:{path:video,originalname:'H3-safe-guide-5s.mp4',mimetype:'video/mp4',size:(await fs.stat(video)).size}});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export function safeH3Result(task,queue){
  const job=TRIALS.map(t=>queue.read(t.jobId)).find(j=>safeH3Profile(j)&&String(j.task?.taskId)===String(task?.taskId));
  if(!job)return null;
  return {taskId:String(task.taskId),status:task.status,providerRuntimeSeconds:task.providerRuntimeSeconds??null,
    submittedAt:task.submittedAt,finishedAt:task.finishedAt,resultUrl:task.resultUrl||null,
    inferenceProfile:safeH3Profile(job)};
}
export function resumeSafeH3Progress({queue,observe}){
  for(const trial of TRIALS){
    const job=queue.read(trial.jobId);
    if(safeH3Profile(job)&&job.stage==='accepted'&&job.task?.taskId)
      observe(job.task.taskId,job.task.netWssUrl);
  }
}
export async function stopSupersededSafeBenchmark({queue,registry,cancel,token}){
  if(token!==SAFE_H3_SOL2_TOKEN)return null;
  const job=queue.read(SAFE_H3_SOL_JOB);
  if(safeH3Profile(job)!=='guide-sol-focus'||job.stage!=='accepted')return null;
  const task=registry.get(String(job.task?.taskId||''));
  if(!task||String(task.taskId)!==String(job.task.taskId)||['success','failed'].includes(task.status)||task.video!=='H3-safe-guide-5s.mp4'||
    task.inputDiagnostics?.inferenceProfile!=='guide-sol-focus')return null;
  const response=await cancel(task.key,task.taskId);
  if(response?.code===0||response?.code==='0'){
    registry.update(task.taskId,{status:'failed',finishedAt:new Date().toISOString(),
      error:'Uji teknis dihentikan setelah koreksi urutan node.'});
  }
  return {taskId:task.taskId,providerCode:response?.code!==null&&response?.code!==undefined&&
    Number.isFinite(Number(response.code))?Number(response.code):null};
}
