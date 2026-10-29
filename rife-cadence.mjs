import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const analyzer=new URL('./scripts/rife_cadence.py',import.meta.url).pathname;

// A video labelled 60fps may contain repeated frames. The actual motion
// cadence, not a fixed "30fps" fallback, determines RIFE's source rate.
export async function prepareAdaptiveRifeVideo(file,probe,{maxUploadBytes=100*1024*1024}={}){
  if(!Number.isFinite(probe?.sourceFps)||probe.sourceFps<=0||probe.sourceFps>60)
    throw new Error('FPS asli video tidak dapat diproses RIFE.');
  if(probe.sourceFps<59.5)
    return {...probe,file,adaptive:false,async release(){}};
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vanta-rife-motion-'));
  const output=path.join(dir,'motion-anchors.mp4');
  try{
    let stdout;
    try{
      ({stdout}=await run('/usr/bin/python3',[analyzer,file.path,output,'--fps',String(probe.sourceFps)],
        {timeout:10*60*1000,maxBuffer:65536}));
    }catch(error){
      stdout=error.stdout||'';
      let report;
      try{report=JSON.parse(String(stdout).trim());}catch{}
      throw new Error(report?.reason||'Analisis gerakan tidak berhasil. Task belum dikirim ke RunningHub.');
    }
    let report;
    try{report=JSON.parse(String(stdout).trim());}catch{throw new Error('Laporan analisis FPS tidak valid.');}
    const fps=Number(report.metrics?.effectiveFps);
    const frames=Number(report.metrics?.anchorFrames);
    const original=Number(report.metrics?.duration);
    if(report.status!=='prepared'||!Number.isFinite(fps)||fps<8||fps>=59.5||
       !Number.isInteger(frames)||frames<12||!Number.isFinite(original)||original<=0)
      throw new Error('Pola frame tidak cukup konsisten untuk interpolasi yang aman.');
    const stat=await fs.promises.stat(output);
    if(stat.size>maxUploadBytes)
      throw new Error('Video anchor melebihi 100 MB. Perkecil durasi input sebelum memproses.');
    return {...probe,sourceFps:fps,adaptive:true,
      cadence:{duplicateRatio:report.metrics.duplicateRatio,anchorFrames:frames,
        sourceFrames:report.metrics.sourceFrames,effectiveFps:fps},
      file:{path:output,originalname:'vanta-motion-anchors.mp4',size:stat.size,mimetype:'video/mp4'},
      async release(){await fs.promises.rm(dir,{recursive:true,force:true});}};
  }catch(error){
    await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
