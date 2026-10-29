import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
export const RIFE_WORKFLOW_ID='2032484067282784257'; // Historical reference only; not a billable API workflow ID.
export const RIFE_TARGET_FPS=60;
const FALLBACK_RATE=30;


function parseRate(value){
  const parts=String(value??'').trim().split('/');
  if(parts.length>2||!parts[0])return NaN;
  const numerator=Number(parts[0]);
  const denominator=parts.length===2?Number(parts[1]):1;
  return Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator>0
    ? numerator/denominator:NaN;
}
const positive=n=>Number.isFinite(n)&&n>0;
const validFps=fps=>Number.isFinite(fps)&&fps>=1&&fps<RIFE_TARGET_FPS;
function roundedRate(rate){return Math.round(rate*1000)/1000;}

// Trust actual frames and duration when container metadata contradicts nominal FPS.
// A value like 60/1 in r_frame_rate is often only a timestamp timebase guess.
export function validateRifeVideoProbe(probe){
  const stream=probe?.streams?.[0];
  if(!stream||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||
    stream.width<16||stream.height<16)
    throw new Error('Video tidak memiliki dimensi yang valid.');
  const avg=parseRate(stream.avg_frame_rate);
  const guessed=parseRate(stream.r_frame_rate);
  const duration=Number(stream.duration)||Number(probe?.format?.duration)||NaN;
  const frames=Number(stream.nb_read_frames)||Number(stream.nb_read_packets)||Number(stream.nb_frames)||NaN;
  const measured=positive(frames)&&positive(duration)?frames/duration:NaN;
  let fps=positive(avg)?avg:positive(measured)?measured:guessed;
  let method=positive(avg)?'average':positive(measured)?'frames_per_duration':'base';
  if(positive(measured)&&(!positive(avg)||Math.abs(measured-avg)>Math.max(0.65,avg*0.035))){
    fps=measured;method='frames_per_duration';
  }
  const canUseOriginal=validFps(fps);
  const variableTiming=canUseOriginal&&positive(guessed)&&
    Math.abs(guessed-fps)>Math.max(1,0.12*fps);
  // For invalid/60+ metadata, use a verified CFR stream at 30 FPS rather than
  // rejecting the video or misrepresenting its timebase to RIFE.
  const sourceFps=canUseOriginal?Math.min(59.999,roundedRate(fps)):FALLBACK_RATE;
  return {
    width:stream.width,height:stream.height,
    detectedFps:positive(fps)?roundedRate(fps):null,
    sourceFps,targetFps:RIFE_TARGET_FPS,
    needsNormalization:!canUseOriginal||variableTiming,
    reason:!canUseOriginal?'unreadable_or_target_fps':variableTiming?'variable_frame_rate':null,
    detectionMethod:method
  };
}
export function rifeGraphForSourceFps(base,sourceFps){
  if(!validFps(sourceFps))
    throw new Error('FPS sumber interpolasi tidak valid.');
  if(base?.['1']?.class_type!=='VHS_LoadVideo'||
     base?.['1']?.inputs?.force_rate!==0||
     base?.['2']?.class_type!=='RIFEInterpolation'||
     base?.['3']?.class_type!=='VHS_VideoCombine')
    throw new Error('Workflow RIFE target-FPS tidak valid.');
  return {...base,'2':{...base['2'],
    inputs:{...base['2'].inputs,source_fps:sourceFps,target_fps:RIFE_TARGET_FPS}}};
}
async function probeFile(filePath,extra=[]){
  const {stdout}=await execFileAsync('ffprobe',[
    '-v','error',...extra,'-select_streams','v:0',
    '-show_entries','stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,nb_read_packets,duration:format=duration',
    '-of','json',filePath
  ],{timeout:60000,maxBuffer:65536});
  return JSON.parse(stdout);
}
export async function verifyRifeInput(file){
  if(!file?.path)throw new Error('Video sumber wajib diisi.');
  let probe;
  try{probe=await probeFile(file.path);}
  catch{throw new Error('File video tidak dapat dibaca oleh FFprobe. Gunakan MP4, MOV, atau WEBM.');}
  let metadata=validateRifeVideoProbe(probe);
  // An inaccurate FPS header should not cause rejection; count actual video
  // packets if metadata are 60+, missing, or unclear. This does not decode/re-encode.
  if(metadata.needsNormalization&&metadata.reason==='unreadable_or_target_fps'){
    try{
      const counted=await probeFile(file.path,['-count_packets']);
      metadata=validateRifeVideoProbe(counted);
    }catch{/* A safe local CFR fallback is still available. */}
  }
  return metadata;
}
export async function prepareRifeSource(file){
  const source=await verifyRifeInput(file);
  if(!source.needsNormalization)
    return {...source,file,async release(){}};
  const folder=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vanta-rife-cfr-'));
  const destination=path.join(folder,'source-cfr.mp4');
  try{
    // 'fps' selects frames using source timestamps: playback duration remains
    // constant. No resolution resize/upscale is performed. Audio stays in sync.
    const framerate=String(source.sourceFps);
    await execFileAsync('ffmpeg',[
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',file.path,'-map','0:v:0','-map','0:a?',
      '-vf','fps='+framerate,
      '-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','128k','-movflags','+faststart',destination
    ],{timeout:12*60*1000,maxBuffer:65536});
    const stat=await fs.promises.stat(destination);
    if(stat.size<500)throw new Error('Normalisasi menghasilkan file kosong.');
    const measured=await verifyRifeInput({path:destination});
    if(Math.abs(measured.sourceFps-source.sourceFps)>0.25||
       measured.width!==source.width||measured.height!==source.height)
      throw new Error('FPS atau resolusi setelah normalisasi tidak sesuai.');
    return {...source,sourceFps:measured.sourceFps,
      file:{path:destination,mimetype:'video/mp4',originalname:'vanta-rife-source.mp4',size:stat.size},
      async release(){await fs.promises.rm(folder,{recursive:true,force:true});}
    };
  }catch(error){
    await fs.promises.rm(folder,{recursive:true,force:true}).catch(()=>{});
    throw new Error('Normalisasi FPS tanpa upscale gagal: '+String(error.message||error).slice(0,160));
  }
}
