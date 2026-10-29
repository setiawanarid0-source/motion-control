import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
export const RIFE_WORKFLOW_ID='1942069598047072258';

// Check the actual source video BEFORE uploading or creating a billable task.
export function validateRifeVideoProbe(probe){
  const stream=probe?.streams?.[0];
  if(!stream||!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||stream.width<16||stream.height<16)
    throw new Error('Video tidak memiliki dimensi yang valid.');
  const [num,den]=String(stream.avg_frame_rate||'').split('/').map(Number);
  const fps=Number.isFinite(num)&&Number.isFinite(den)&&den>0?num/den:NaN;
  if(!Number.isFinite(fps)||Math.abs(fps-30)>0.1)
    throw new Error('RIFE 60 FPS saat ini hanya menerima video sumber 30 FPS (termasuk 29.97 FPS).');
  return {width:stream.width,height:stream.height,sourceFps:fps,targetFps:60};
}
export async function verifyRifeInput(file){
  if(!file?.path)throw new Error('Video sumber wajib diisi.');
  try{
    const {stdout}=await execFileAsync('ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','stream=width,height,avg_frame_rate','-of','json',file.path],
      {timeout:15000,maxBuffer:65536});
    return validateRifeVideoProbe(JSON.parse(stdout));
  }catch(error){
    if(error.message?.startsWith('RIFE 60 FPS')||error.message?.startsWith('Video tidak memiliki'))throw error;
    throw new Error('File video tidak dapat dibaca. Gunakan MP4, MOV, atau WEBM dengan frame rate 30 FPS.');
  }
}
