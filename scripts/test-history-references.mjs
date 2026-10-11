import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vanta-media-test-'));
process.env.VANTA_DATA_DIR=dir;
const {saveReference,stageReferences,commitReferences,discardReferences,referenceAvailability,referenceFile,pruneReferences}=await import('../history-references.js');
const id='2109000000000000001',legacyId='2109000000000000002';
try{
  const image=path.join(dir,'input.png'),video=path.join(dir,'input.mp4');
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=red:s=120x180:d=0.1',
    '-frames:v','1',image]);
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
    'testsrc2=size=120x180:rate=12:duration=0.6','-c:v','libx264','-pix_fmt','yuv420p',video]);
  await saveReference(id,'image',{path:image});
  await saveReference(id,'video',{path:video});
  assert.equal(referenceAvailability(id).image,true);
  assert.equal(referenceAvailability(id).video,true);
  assert.equal(referenceAvailability(id).legacy,false);
  assert.ok((await fs.promises.stat(referenceFile(id,'video'))).size>500);
  // Both media inputs must be staged and atomically linked before History can show them.
  const generatedTask='2109000000000000003';
  const staged=await stageReferences({path:image},{path:video});
  assert.equal(referenceAvailability(generatedTask).image,false);
  const committed=await commitReferences(staged,generatedTask);
  assert.equal(committed.image,true);
  assert.equal(committed.video,true);
  assert.equal(referenceAvailability(generatedTask).image,true);
  const unused=await stageReferences({path:image},{path:video});
  await discardReferences(unused);
  assert.equal(fs.existsSync(unused),false);
  await assert.rejects(stageReferences({path:'/not/a/real/image.png'},{path:video}),
    /Referensi gagal disimpan sebelum generate/);
    const legacyDir=path.join(dir,'camera-r15',legacyId);
  await fs.promises.mkdir(legacyDir,{recursive:true});
  await fs.promises.copyFile(video,path.join(legacyDir,'source.mp4'));
  assert.equal(referenceAvailability(legacyId).video,true);
  assert.equal(referenceAvailability(legacyId).legacy,true);
  assert.equal(referenceFile(legacyId,'image'),null);
  assert.equal(referenceFile('../invalid','video'),null);
  await pruneReferences();
  assert.equal(referenceAvailability(id).image,true);
  const old=new Date(Date.now()-4*86400000);
  const mediaDir=path.join(dir,'history-references',id);
  await fs.promises.utimes(mediaDir,old,old);
  await pruneReferences();
  assert.equal(referenceAvailability(id).image,false);
  console.log('PASS: automatic staged references, legacy recovery, expiration, and input path safety');
}finally{
  await fs.promises.rm(dir,{recursive:true,force:true});
}
