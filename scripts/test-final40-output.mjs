import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {requiresFinal40,readFinal40,convertVideo40,probeVideo} from '../final-fps.js';

const run=promisify(execFile);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-final40-test-'));
try{
  assert.equal(requiresFinal40('Current Workflow'),true);
  assert.equal(requiresFinal40('MotionFly R4 · Full Controlled Test'),true);
  assert.equal(requiresFinal40('MotionFly R4 · Camera Engine (R15)'),false);
  assert.equal(requiresFinal40('MotionFly R4 · SAM3 Mask Diagnostic'),false);
  for(const fps of [30,35]){
    const original=path.join(tmp,'input-'+fps+'.mp4');
    const converted=path.join(tmp,'output-'+fps+'.mp4');
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i',`testsrc2=size=120x216:rate=${fps}:duration=1.0`,
      '-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=1.0',
      '-map','0:v:0','-map','1:a:0',
      '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',original],
    {timeout:45000});
    const before=await probeVideo(original),after=await convertVideo40(original,converted);
    assert.ok(Math.abs(before.fps-fps)<.01);
    assert.ok(Math.abs(after.fps-40)<.01);
    assert.ok(Math.abs(after.duration-before.duration)<.125,
      'Duration must not change for '+fps+'FPS input');
    const {stdout}=await run('ffprobe',['-v','error','-select_streams','a:0',
      '-show_entries','stream=codec_name','-of','default=nw=1:nk=1',converted]);
    assert.equal(stdout.trim(),'aac','Original sound must be preserved');
  }
  assert.equal(readFinal40('../invalid'),null,'Unsafe task IDs must be rejected');
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const graph=(file)=>JSON.parse(fs.readFileSync(new URL('../workflows/'+file,import.meta.url),'utf8'));
  const current=graph('current-api.json'),r4=graph('motionfly-r4-full-controlled-api.json'),
        r15=graph('r15-camera-adaptive-api.json');
  assert.deepEqual(current['490'].inputs.frame_rate,['239',0],
    'KOH driving/output generator timing must remain original');
  assert.deepEqual(r4['490'].inputs.frame_rate,['239',0],
    'R4 driving/output generator timing must remain original');
  assert.deepEqual(r15['490'].inputs.frame_rate,['239',0],'R15 unchanged');
  assert.equal(current['33'].inputs.force_rate,30);
  assert.equal(r4['33'].inputs.force_rate,35);
  assert.equal(r15['33'].inputs.force_rate,35);
  assert.ok(server.includes('ensureFinal40(taskId,video.fileUrl)'));
  assert.ok(server.includes("fileUrl:'/api/tasks/'+encodeURIComponent(taskId)+'/preview?accountId='+encodeURIComponent(accountId)"));
  assert.ok(server.includes("res.download(final40,'motion-'+req.params.taskId+'-40fps.mp4')"));
  assert.ok(server.includes('if(final40){res.setHeader'), 'History Preview must use final 40fps result');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(app.includes("result.videoUrl.replace('/preview?','/download?')"),
    'New-result Download must serve the same converted 40fps video, not an inline preview');
  console.log('PASS: KOH 30→40 and R4 35→40 CFR; original duration/audio preserved; R15 and both generation graphs unchanged');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
