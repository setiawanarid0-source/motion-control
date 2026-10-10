// R15 paid-job safety: test motion FPS normalization without submitting a RunningHub task.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { prepareMotionSource } from '../camera-runtime.js';
const exec=promisify(execFile);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'r15-fps-test-'));
try{
 const video=path.join(dir,'30fps.mp4');
 await exec('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi',
   '-i','testsrc2=size=96x160:rate=30:duration=1.4','-c:v','libx264','-pix_fmt','yuv420p',video],{timeout:20000});
 const stat=await fs.stat(video);
 const converted=await prepareMotionSource({path:video,size:stat.size,originalname:'video.mp4',mimetype:'video/mp4'});
 try{
  assert.equal(converted.prepared,true);
  assert.equal(Math.round(converted.sourceFPS),30);
  const {stdout}=await exec('ffprobe',['-v','error','-select_streams','v:0',
    '-show_entries','stream=r_frame_rate,nb_frames','-of','json',converted.file.path],{timeout:20000});
  const s=JSON.parse(stdout).streams[0];
  assert.equal(s.r_frame_rate,'35/1');
  assert.equal(Number(s.nb_frames),49);
  const noChange=await prepareMotionSource(converted.file);
  assert.equal(noChange.prepared,false);
 }finally{await converted.release();}
 console.log('PASS: time-accurate R15 motion preconditioning: 30FPS to 35FPS, without repeated resampling.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
