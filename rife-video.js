import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
// RunningHub hosts a workflow that includes the target-FPS RIFEInterpolation node.
// Its public post ID is the workflow ID used by the RunningHub OpenAPI.
export const RIFE_WORKFLOW_ID='2032484067282784257';
export const RIFE_TARGET_FPS=60;

function parseRate(value){
  const [num,den]=String(value||'').split('/').map(Number);
  return Number.isFinite(num)&&Number.isFinite(den)&&den>0 ? num/den : NaN;
}

// Inspect actual video timestamps (rather than trusting a browser filename or UI).
// The target-FPS node interpolates from original frames without a 30fps downgrade.
export function validateRifeVideoProbe(probe){
  const stream=probe?.streams?.[0];
  if(!stream||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||
    stream.width<16||stream.height<16)
    throw new Error('Video tidak memiliki dimensi yang valid.');
  const preferred=parseRate(stream.avg_frame_rate);
  const fps=Number.isFinite(preferred)&&preferred>0?preferred:parseRate(stream.r_frame_rate);
  if(!Number.isFinite(fps)||fps<1||fps>=RIFE_TARGET_FPS)
    throw new Error('FPS video harus mulai dari 1 dan lebih rendah dari 60 FPS.');
  return {width:stream.width,height:stream.height,sourceFps:fps,targetFps:RIFE_TARGET_FPS};
}

// Do not mutate the shared graph: concurrent tasks can have different source FPS.
export function rifeGraphForSourceFps(base,sourceFps){
  if(!Number.isFinite(sourceFps)||sourceFps<1||sourceFps>=RIFE_TARGET_FPS)
    throw new Error('FPS video harus mulai dari 1 dan lebih rendah dari 60 FPS.');
  if(base?.['1']?.class_type!=='VHS_LoadVideo'||
     base?.['1']?.inputs?.force_rate!==0||
     base?.['2']?.class_type!=='RIFEInterpolation'||
     base?.['3']?.class_type!=='VHS_VideoCombine')
    throw new Error('Workflow RIFE target-FPS tidak valid.');
  return {
    ...base,
    '2':{
      ...base['2'],
      inputs:{...base['2'].inputs,source_fps:sourceFps,target_fps:RIFE_TARGET_FPS}
    }
  };
}

export async function verifyRifeInput(file){
  if(!file?.path)throw new Error('Video sumber wajib diisi.');
  try{
    const {stdout}=await execFileAsync('ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','stream=width,height,avg_frame_rate,r_frame_rate','-of','json',file.path],
      {timeout:15000,maxBuffer:65536});
    return validateRifeVideoProbe(JSON.parse(stdout));
  }catch(error){
    if(error.message?.startsWith('FPS video')||error.message?.startsWith('Video tidak memiliki'))
      throw error;
    throw new Error('File video tidak dapat dibaca. Gunakan MP4, MOV, atau WEBM dengan FPS kurang dari 60.');
  }
}
