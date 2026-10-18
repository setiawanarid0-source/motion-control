import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-safe-cleanup-'));
process.env.VANTA_DATA_DIR=dir;
const {pruneFinal40,readFinal40}=await import('../final-fps.js');
const taskId='2109000000000000987';
const folder=path.join(dir,'final-40fps',taskId);
try{
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'input-14.mp4'),Buffer.alloc(8000,1));
  fs.writeFileSync(path.join(folder,'result.mp4.tmp-14-1792299453914.mp4'),Buffer.alloc(8000,2));
  fs.writeFileSync(path.join(folder,'result.mp4'),Buffer.alloc(8000,3));
  fs.writeFileSync(path.join(folder,'status.json'),JSON.stringify({attempts:1,lastAttempt:0}));
  fs.writeFileSync(path.join(folder,'reference.jpg'),Buffer.alloc(2000,4));
  await pruneFinal40();
  assert.equal(fs.existsSync(path.join(folder,'input-14.mp4')),false,
    'Abandoned downloaded sources must be removed');
  assert.equal(fs.existsSync(path.join(folder,'result.mp4.tmp-14-1792299453914.mp4')),false,
    'Abandoned FFmpeg outputs must be removed');
  assert.equal(fs.existsSync(path.join(folder,'result.mp4')),true,
    'Completed video is user data and must never be removed during temp cleanup');
  assert.equal(readFinal40(taskId),path.join(folder,'result.mp4'));
  assert.equal(fs.existsSync(path.join(folder,'status.json')),true);
  assert.equal(fs.existsSync(path.join(folder,'reference.jpg')),true);
  const source=fs.readFileSync(new URL('../final-fps.js',import.meta.url),'utf8');
  assert.ok(source.includes("os.tmpdir()"),'Source inputs must use ephemeral scratch storage');
  assert.ok(source.includes('RESERVED_SPACE'),'Storage must be checked before writing a converted video');
  console.log('PASS: Railway temp cleanup preserves finished videos, task metadata, and references');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
