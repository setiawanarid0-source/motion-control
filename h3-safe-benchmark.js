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
const DEVICE='h3-safe-benchmark-20261101-v1';
const ASSET='https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/examples/character_swap_v1.0_1.mp4';
const SHA='0bb85d33ff2d1dc69b015d77715888d0388903c8582e97cd0f6bd7253b85355d';
export function safeH3Profile(job){
  return job?.jobId===SAFE_H3_JOB&&job.deviceId===DEVICE&&
    job.image?.originalname==='H3-safe-reference.png'&&job.video?.originalname==='H3-safe-guide-5s.mp4'
    ?'no-training-adapter':null;
}
export async function stageSafeH3Benchmark({queue,token=process.env.VANTA_H3_SAFE_BENCHMARK,
  download=async()=>Buffer.from((await axios.get(ASSET,{responseType:'arraybuffer',timeout:60000,
    maxContentLength:8*1024*1024,maxBodyLength:8*1024*1024})).data),execute=run}){
  if(token!==SAFE_H3_TOKEN)return null;
  const old=queue.read(SAFE_H3_JOB);
  if(old)return {jobId:SAFE_H3_JOB,stage:old.stage,reused:true};
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
    return await queue.stage({jobId:SAFE_H3_JOB,deviceId:DEVICE,
      body:{workflow:'minimaxH3',mode:'plus',accountId:'auto'},
      image:{path:image,originalname:'H3-safe-reference.png',mimetype:'image/png',size:(await fs.stat(image)).size},
      video:{path:video,originalname:'H3-safe-guide-5s.mp4',mimetype:'video/mp4',size:(await fs.stat(video)).size}});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export function safeH3Result(task,queue){
  const job=queue.read(SAFE_H3_JOB);
  if(!safeH3Profile(job)||String(job.task?.taskId)!==String(task?.taskId))return null;
  return {taskId:String(task.taskId),status:task.status,providerRuntimeSeconds:task.providerRuntimeSeconds??null,
    submittedAt:task.submittedAt,finishedAt:task.finishedAt,resultUrl:task.resultUrl||null,
    inferenceProfile:'no-training-adapter'};
}
