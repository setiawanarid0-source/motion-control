import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
export const RIFE_TARGET_FPS=60;

// Detection only. Never generate a CFR/30 FPS intermediate video, drop frames,
// duplicate frames or re-encode the source before RunningHub interpolation.
function rate(value){
  const parts=String(value??'').trim().split('/');
  if(parts.length>2||!parts[0])return NaN;
  const n=Number(parts[0]),d=parts.length===2?Number(parts[1]):1;
  return Number.isFinite(n)&&Number.isFinite(d)&&d>0?n/d:NaN;
}
const positive=x=>Number.isFinite(x)&&x>0;
const validSourceFps=fps=>positive(fps)&&fps<RIFE_TARGET_FPS;

// This pure validator can also interpret counted frames when a container
// advertises an inaccurate nominal rate (e.g. header 60, real 30 FPS).
export function validateRifeVideoProbe(probe){
  const stream=probe?.streams?.[0];
  if(!stream||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||
    stream.width<16||stream.height<16)
    throw new Error('Video tidak memiliki dimensi yang valid.');
  const average=rate(stream.avg_frame_rate);
  const nominal=rate(stream.r_frame_rate);
  const duration=Number(stream.duration)||Number(probe?.format?.duration)||NaN;
  const countedFrames=Number(stream.nb_read_frames)||Number(stream.nb_read_packets)||
    Number(stream.nb_frames)||NaN;
  const measured=positive(countedFrames)&&positive(duration)?countedFrames/duration:NaN;
  let fps=positive(average)?average:positive(measured)?measured:nominal;
  let detectionMethod=positive(average)?'average':positive(measured)?'counted_frames':'nominal';
  if(positive(measured)&&(!positive(average)||
     Math.abs(measured-average)>Math.max(0.5,average*0.035))){
    fps=measured;detectionMethod='counted_frames';
  }
  if(!positive(fps))
    throw new Error('FPS sumber tidak dapat dibaca. Video asli tidak diubah atau dikonversi.');
  if(!validSourceFps(fps))
    throw new Error('Video terdeteksi '+Number(fps.toFixed(4))+' FPS. RIFE ini hanya menerima FPS sumber di bawah 60. Video asli tidak diubah.');
  return {width:stream.width,height:stream.height,sourceFps:fps,
    detectedFps:fps,targetFps:RIFE_TARGET_FPS,detectionMethod,
    variableFrameRate:positive(nominal)&&Math.abs(nominal-fps)>Math.max(1,fps*.12)};
}

export function rifeGraphForSourceFps(base,sourceFps){
  if(!validSourceFps(sourceFps))
    throw new Error('FPS asli untuk RIFE harus lebih besar dari 0 dan di bawah 60.');
  if(base?.['1']?.class_type!=='VHS_LoadVideo'||
     base?.['1']?.inputs?.force_rate!==0||
     base?.['2']?.class_type!=='RIFEInterpolation'||
     base?.['3']?.class_type!=='VHS_VideoCombine')
    throw new Error('Workflow RIFE target-FPS tidak valid.');
  return {...base,'2':{...base['2'],
    inputs:{...base['2'].inputs,source_fps:sourceFps,target_fps:RIFE_TARGET_FPS}}};
}
async function probeFile(filePath,countPackets=false){
  const {stdout}=await execFileAsync('ffprobe',[
    '-v','error',...(countPackets?['-count_packets']:[]),
    '-select_streams','v:0',
    '-show_entries','stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_packets,duration:format=duration',
    '-of','json',filePath
  ],{timeout:60000,maxBuffer:65536});
  return JSON.parse(stdout);
}
export async function verifyRifeInput(file){
  if(!file?.path)throw new Error('Video sumber wajib diisi.');
  let raw;
  try{raw=await probeFile(file.path);}
  catch{throw new Error('File sumber tidak dapat dibaca oleh FFprobe. Video tidak diubah.');}
  const stream=raw?.streams?.[0];
  const average=rate(stream?.avg_frame_rate),nominal=rate(stream?.r_frame_rate);
  // Count original encoded video packets if missing/contradictory FPS, including
  // 60+ nominal values. This is a read-only inspection, NOT transcoding.
  const shouldCount=!positive(average)||average>=RIFE_TARGET_FPS||
    !positive(nominal)||nominal>=RIFE_TARGET_FPS||
    (positive(average)&&positive(nominal)&&
      Math.abs(average-nominal)>Math.max(1,average*.12));
  if(shouldCount){
    try{raw=await probeFile(file.path,true);}
    catch{/* Preserve the original metadata, never manufacture FPS. */}
  }
  return validateRifeVideoProbe(raw);
}
