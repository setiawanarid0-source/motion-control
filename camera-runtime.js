// RunningHub R4 Camera Engine: two-upload source measurement plus conservative output QA.
// All expensive operations are child processes and never run on the Node event loop.
import fs from 'node:fs';
import path from 'node:path';
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
   if(decision.action==='candidate' && decision.maxEstimatedCorrectionPx<=8){
     try{
       const temp=path.join(dir,'corrected-noaudio.mp4');
       const target=path.join(dir,'corrected.mp4');
       await python(['correct','--source-report',path.join(dir,'source.json'),'--output-report',outReport,'--video',outputPath,'--out',temp],180000);
       // Restore output audio; never add driving-video audio unless generated video already had it.
       await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',temp,'-i',outputPath,
         '-map','0:v:0','-map','1:a?','-c:v','libx264','-preset','veryfast','-crf','18','-c:a','copy',
         '-shortest','-movflags','+faststart',target],{timeout:240000,maxBuffer:1024*1024});
       // Verify the corrected video before offering it as the result.
       const afterName=path.join(dir,'after.json');
       await python(['analyze','--video',target,'--out',afterName],180000);
       const after=cameraDecision(source,json(afterName),{maxCorrectionPx:35});
       if(after.action==='pass' || (after.maxEstimatedCorrectionPx!=null &&
          after.maxEstimatedCorrectionPx<decision.maxEstimatedCorrectionPx && after.action!=='hold')){
         details.corrected=true;details.reason='SMALL_CORRECTION_VERIFIED';
       }else{
         details.reason='CORRECTION_UNVERIFIED_RAW_PRESERVED';
         await fs.promises.rm(target,{force:true});
       }
       await fs.promises.rm(temp,{force:true});
     }catch(err){details.reason='CORRECTION_FAILED_RAW_PRESERVED';details.note=String(err.message||err).slice(0,170);}
   }
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
