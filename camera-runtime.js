// RunningHub R4 Camera Engine: two-upload source measurement plus conservative output QA.
// All expensive operations are child processes and never run on the Node event loop.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import axios from 'axios';
import { cameraDecision } from './experiments/motionfly-r4/camera_policy.mjs';

const exec=promisify(execFile);
const BASE=path.join(process.env.VANTA_DATA_DIR||'/data','camera-r15');
const SCRIPT=path.join(process.cwd(),'camera-engine','camera_motion.py');
const active=new Map();
const idOk=id=>/^\d{10,25}$/.test(String(id||''));
const folder=id=>{if(!idOk(id))throw Error('Invalid task ID');return path.join(BASE,String(id));};
const json=(file)=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=async(file,data)=>{const name=file+'.tmp-'+process.pid;await fs.promises.writeFile(name,JSON.stringify(data));await fs.promises.rename(name,file);};
async function python(args,timeout=150000){
  return exec('/usr/bin/python3',[SCRIPT,...args],{timeout,maxBuffer:1024*1024,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
}

// Normalize R15 motion video to 35FPS with optical interpolation BEFORE any paid job.
// VHS_LoadVideo force_rate=35 otherwise duplicates 30FPS input frames.
async function sourceFPS(filePath){
 const {stdout}=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate',
  '-of','default=noprint_wrappers=1:nokey=1',filePath],{timeout:25000});
 const match=String(stdout).trim().match(/^(\d+)(?:\/(\d+))?$/);
 if(!match)throw Error('FPS video tidak dapat dibaca.');
 const fps=Number(match[1])/Number(match[2]||1);
 if(!(fps>=8&&fps<=120))throw Error('FPS sumber harus antara 8 dan 120.');
 return fps;
}
export async function prepareMotionSource(file){
 const fps=await sourceFPS(file.path);
 if(Math.abs(fps-35)<.015)return {file,sourceFPS:fps,prepared:false,release:async()=>{}};
 const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'r15-motion-fps-'));
 const out=path.join(tmp,'driving35.mp4');
 try{
  await exec('/usr/bin/python3',[path.join(process.cwd(),'camera-engine','motion_timebase.py'),file.path,out],
    {timeout:180000,maxBuffer:4096,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'2'}});
  if(Math.abs(await sourceFPS(out)-35)>.015)throw Error('Video hasil bukan 35 FPS.');
  const size=(await fs.promises.stat(out)).size;
  if(size<5000||size>100*1024*1024)throw Error('Ukuran hasil sinkronisasi video tidak valid.');
  return {file:{...file,path:out,originalname:'r15-driving35.mp4',mimetype:'video/mp4',size},
   sourceFPS:fps,prepared:true,release:()=>fs.promises.rm(tmp,{recursive:true,force:true})};
 }catch(err){
  await fs.promises.rm(tmp,{recursive:true,force:true}).catch(()=>{});
  throw Error('Penyiapan gerakan 35 FPS gagal sebelum menggunakan kredit: '+err.message);
 }
}

export async function analyzeSource(input){
  const reportName=input.path+'.r4-report.json';
  try{
    await python(['analyze','--video',input.path,'--out',reportName],150000);
    const report=json(reportName);
    if(report?.schema!=='r4-camera-v1')throw Error('Invalid source camera report');
    return report;
  }finally{await fs.promises.rm(reportName,{force:true}).catch(()=>{});}
}
export async function saveSource(taskId,input,report){
  const dir=folder(taskId);
  await fs.promises.mkdir(dir,{recursive:true});
  await fs.promises.copyFile(input.path,path.join(dir,'source.mp4'));
  await write(path.join(dir,'source.json'),report);
  await write(path.join(dir,'qa.json'),{stage:'pending',sourceCamera:report.classification});
}
function urlOk(raw){
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!u.hostname.includes('.'))return false;
    if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))return false;
    return true;
 }catch{return false;}
}
async function fetchVideo(raw,dest){
 if(!urlOk(raw))throw Error('Unsafe RunningHub video URL');
 const response=await axios.get(raw,{responseType:'stream',timeout:120000,maxRedirects:3});
 let total=0;const MAX=450*1024*1024;
 const limiter=new Transform({transform(part,_encoding,done){
   total+=part.length;done(total>MAX?Error('Output video too large for Camera QA'):null,part);
 }});
 await pipeline(response.data,limiter,fs.createWriteStream(dest));
 if(total<5000)throw Error('Empty RunningHub video');
}
async function executeQa(id,url){
 const dir=folder(id),statusFile=path.join(dir,'qa.json');
 let details={stage:'processing',startedAt:Date.now(),reason:'CAMERA_CHECK_RUNNING'};
 await write(statusFile,details);
 let outputPath=path.join(dir,'raw-output.mp4');
 try{
   const source=json(path.join(dir,'source.json'));
   await fetchVideo(url,outputPath);
   const outReport=path.join(dir,'output.json');
   await python(['analyze','--video',outputPath,'--out',outReport],180000);
   const out=json(outReport);
   const decision=cameraDecision(source,out,{maxCorrectionPx:35,qualityRequired:.65});
   details={stage:'done',sourceCamera:source.classification,generatedCamera:out.classification,decision:decision.action,reason:decision.reason,corrected:false};
   // Do not warp the entire subject to compensate a background-camera error.
   // Wait for a validated output-person segmentation mask before allowing correction.
   if(decision.action==='candidate')details.reason='RAW_PRESERVED_NO_WHOLE_SUBJECT_WARP';
   await write(statusFile,details);
 }catch(error){
   details={stage:'done',sourceCamera:'UNKNOWN',decision:'hold',reason:'QA_UNAVAILABLE_RAW_PRESERVED',corrected:false,note:String(error.message||error).slice(0,180)};
   await write(statusFile,details);
 }finally{
   // Keep only the original driving and accepted corrected video for at most three days.
   await fs.promises.rm(outputPath,{force:true}).catch(()=>{});
 }
}
export function readCorrected(id){
 if(!idOk(id))return null;
 const video=path.join(folder(id),'corrected.mp4');
 try{const qa=json(path.join(folder(id),'qa.json'));if(qa.stage==='done'&&qa.corrected&&fs.statSync(video).size>1000)return video;}catch{}
 return null;
}
export async function cameraStatus(id,rawVideoUrl,accountId){
 if(!idOk(id))return null;
 let status;try{status=json(path.join(folder(id),'qa.json'));}catch{return null;}
 if(status.stage==='done'){
   const local=readCorrected(id);
   const url=local?'/api/camera-video/'+encodeURIComponent(id)+'?accountId='+encodeURIComponent(accountId):rawVideoUrl;
   return {state:'success',outputs:[{nodeId:'490',fileType:'video/mp4',fileUrl:url}],cameraQA:{
     sourceCamera:status.sourceCamera||'UNKNOWN',generatedCamera:status.generatedCamera||'UNKNOWN',
     decision:status.decision||'hold',reason:status.reason||'',corrected:!!local}};
 }
 if(!active.has(id)){
   const job=executeQa(id,rawVideoUrl).catch(err=>console.error('Camera R15 QA',id,err.message))
      .finally(()=>active.delete(id));
   active.set(id,job);
 }
 return {state:'running',message:'Memeriksa pergerakan kamera R4',cameraQA:{phase:'checking'}};
}
export async function pruneOldJobs(){
 try{
   await fs.promises.mkdir(BASE,{recursive:true});
   for(const x of await fs.promises.readdir(BASE,{withFileTypes:true})){
     if(!x.isDirectory()||!idOk(x.name)||active.has(x.name))continue;
     const dest=folder(x.name),info=await fs.promises.stat(dest);
     if(Date.now()-info.mtimeMs>3*24*60*60*1000)await fs.promises.rm(dest,{recursive:true,force:true});
   }
 }catch(err){console.warn('Camera R15 cleanup',err.message);}
}
