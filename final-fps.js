// Post-render 40 FPS delivery for Current (KOH 1) and R4 Full only.
// Never changes the source motion, diffusion frames, audio timing, or R15 workflow.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import axios from 'axios';

const run=promisify(execFile);
const ROOT=path.join(process.env.VANTA_DATA_DIR||'/data','final-40fps');
const VALID_ID=/^\d{10,25}$/;
const DURATION_LIMIT=3*24*60*60*1000;
const MAX_INPUT=450*1024*1024;
const running=new Map();
const MAX_ATTEMPTS=2;
const RETRY_AFTER_MS=120000;
const statusFile=id=>path.join(ROOT,String(id),'status.json');
function loadStatus(id){
  try{
    const data=JSON.parse(fs.readFileSync(statusFile(id),'utf8'));
    return {attempts:Math.max(0,Number(data.attempts)||0),
      lastAttempt:Math.max(0,Number(data.lastAttempt)||0)};
  }catch{return {attempts:0,lastAttempt:0};}
}
function saveStatus(id,state){
  const file=statusFile(id),tmp=file+'.tmp-'+process.pid;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  try{
    fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});
    fs.renameSync(tmp,file);
  }finally{fs.rmSync(tmp,{force:true});}
}
const infoFile=id=>path.join(ROOT,String(id),'result.mp4');
const validId=id=>VALID_ID.test(String(id||''));
const validUrl=raw=>{
  try{
    const u=new URL(raw);
    return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&
      !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(u.hostname);
  }catch{return false;}
};
export function requiresFinal40(workflow){
  return workflow==='Current Workflow'||workflow==='MotionFly R4 · Full Controlled Test';
}
export function readFinal40(id){
  if(!validId(id))return null;
  const file=infoFile(id);
  try{return fs.statSync(file).size>1000?file:null;}catch{return null;}
}
export async function probeVideo(file){
  const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0',
    '-show_entries','stream=avg_frame_rate,duration','-of','json',file],
  {timeout:30000,maxBuffer:16384});
  const stream=JSON.parse(stdout).streams?.[0];
  const [n,d]=String(stream?.avg_frame_rate||'0/1').split('/').map(Number);
  const fps=n/d,duration=Number(stream?.duration);
  if(!Number.isFinite(fps)||fps<=0||!Number.isFinite(duration)||duration<=0)
    throw Error('Tidak dapat membaca durasi dan FPS video');
  return {fps,duration};
}
export async function convertVideo40(input,destination){
  const original=await probeVideo(input);
  if(!(original.duration>0&&original.duration<3600))throw Error('Durasi video tidak valid');
  await fs.promises.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const tmp=destination+'.tmp-'+process.pid+'-'+Date.now()+'.mp4';
  try{
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-threads','1','-filter_threads','1','-i',input,'-map','0:v:0','-map','0:a?',
      '-vf','fps=40','-c:v','libx264','-threads:v','1',
      '-preset','ultrafast','-crf','20','-pix_fmt','yuv420p',
      '-c:a','copy','-movflags','+faststart','-f','mp4',tmp],
    {timeout:4*60*1000,maxBuffer:65536});
    const output=await probeVideo(tmp);
    if(Math.abs(output.fps-40)>.01)throw Error('Video akhir bukan 40 FPS');
    if(Math.abs(output.duration-original.duration)>.125)
      throw Error('Durasi video akhir berubah melebihi toleransi');
    if((await fs.promises.stat(tmp)).size<1000)throw Error('Video akhir kosong');
    await fs.promises.rename(tmp,destination);
    return output;
  }finally{await fs.promises.rm(tmp,{force:true}).catch(()=>{});}
}
async function fetchOriginal(url,dest){
  if(!validUrl(url))throw Error('URL RunningHub tidak valid');
  const response=await axios.get(url,{responseType:'stream',timeout:120000,maxRedirects:3,
    validateStatus:code=>code===200});
  let received=0;
  const limit=new Transform({transform(chunk,encoding,done){
    received+=chunk.length;
    done(received>MAX_INPUT?Error('Video terlalu besar untuk konversi'):null,chunk);
  }});
  try{
    await pipeline(response.data,limit,fs.createWriteStream(dest,{mode:0o600}));
    if(received<1000)throw Error('Output video RunningHub kosong');
  }catch(error){await fs.promises.rm(dest,{force:true}).catch(()=>{});throw error;}
}
async function process40(taskId,url){
  const directory=path.join(ROOT,String(taskId));
  await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
  const original=path.join(directory,'input-'+process.pid+'.mp4');
  try{
    await fetchOriginal(url,original);
    await convertVideo40(original,infoFile(taskId));
  }finally{await fs.promises.rm(original,{force:true}).catch(()=>{});}
}
// RunningHub output is already finished here. Never mislabel a local conversion
// problem as a RunningHub task still generating, nor retry video conversion forever.
export function ensureFinal40(taskId,url){
  if(!validId(taskId))return {state:'failed'};
  const file=readFinal40(taskId);
  if(file)return {state:'ready',file};
  const previous=loadStatus(taskId);
  if(previous.attempts>=MAX_ATTEMPTS&&!running.has(taskId))return {state:'failed'};
  if(running.has(taskId)||running.size>=1)return {state:'processing'};
  if(previous.lastAttempt&&Date.now()-previous.lastAttempt<RETRY_AFTER_MS)
    return {state:'processing'};
  const attempts=previous.attempts+1;
  saveStatus(taskId,{attempts,lastAttempt:Date.now()});
  const job=process40(taskId,url).catch(error=>{
    // Log FFmpeg's actual error, not just the command that exited nonzero.
    const stderr=String(error.stderr||'').trim().slice(-700);
    console.error('Final 40fps conversion failed',taskId,'attempt',attempts,
      'code',error.code||error.signal||'unknown',
      'reason',stderr||String(error.message||error).slice(0,230));
  }).finally(()=>running.delete(taskId));
  running.set(taskId,job);
  return {state:'processing'};
}
export async function pruneFinal40(){
  await fs.promises.mkdir(ROOT,{recursive:true,mode:0o700});
  for(const name of await fs.promises.readdir(ROOT)){
    if(!validId(name)||running.has(name))continue;
    const folder=path.join(ROOT,name);
    try{
      const s=await fs.promises.stat(folder);
      if(s.isDirectory()&&Date.now()-s.mtimeMs>DURATION_LIMIT)
        await fs.promises.rm(folder,{recursive:true,force:true});
    }catch{}
  }
}
