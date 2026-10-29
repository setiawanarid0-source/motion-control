import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createMotionResultArchive,MAX_RESULT_BYTES,RESERVED_FREE_BYTES,RESULT_RETENTION_MS} from '../motion-result-archive.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-account-result-'));
let clock=Date.now();
let calls=0;
const id='2110000000000000777',url='https://cdn.runninghub.ai/output-test.mp4';
const bytes=Buffer.alloc(14*1024,42);bytes.write('ftyp',4,'ascii');
const fetcher=async(_url,opts)=>{
  calls++;
  assert.equal(_url,url);
  assert.equal(opts.responseType,'stream');
  return {headers:{'content-length':String(bytes.length),'content-type':'video/mp4'},
    data:Readable.from([bytes.subarray(0,512),bytes.subarray(512)])};
};
try{
  const archive=createMotionResultArchive({dir,clock:()=>clock,request:fetcher});
  assert.equal(archive.read(id),null);
  const [a,b]=await Promise.all([archive.mirror(id,url),archive.mirror(id,url)]);
  assert.equal(a,b);assert.equal(calls,1,'Concurrent requests must only copy video once');
  assert.ok(fs.existsSync(a));
  assert.deepEqual(fs.readFileSync(a),bytes);
  assert.equal(archive.read(id),a);
  assert.equal(fs.statSync(a).mode&0o777,0o600);
  assert.equal(fs.readdirSync(dir).length,1,'No temporary files may remain');
  const newInstance=createMotionResultArchive({dir,clock:()=>clock,request:fetcher});
  assert.equal(newInstance.read(id),a,'Completed results survive restart / account deletion');
  assert.equal(await newInstance.mirror(id,url),a);
  assert.equal(calls,1,'Cached results should never need the retired provider credential');
  await assert.rejects(archive.mirror('malicious','https://cdn.runninghub.ai/test'),/Invalid task/);
  await assert.rejects(archive.mirror('2110000000000000778','https://127.0.0.1/result.mp4'),/Invalid task/);
  const invalid=createMotionResultArchive({dir,request:async()=>({
    headers:{'content-type':'text/html'},data:Readable.from([Buffer.alloc(2000)])})});
  await assert.rejects(invalid.mirror('2110000000000000778',url),/non-video/);
  assert.ok(!fs.readdirSync(dir).some(x=>x.includes('0778')),'Failed copies must not leave corrupt files');
  const tooLarge=createMotionResultArchive({dir,maxFileBytes:1024,
    request:async()=>({headers:{'content-length':'90000'},data:Readable.from([bytes])})});
  await assert.rejects(tooLarge.mirror('2110000000000000779',url),/melebihi ruang/);
  assert.equal(fs.readdirSync(dir).length,1);
  assert.equal(MAX_RESULT_BYTES,128*1024*1024);
  assert.equal(RESERVED_FREE_BYTES,48*1024*1024);
  clock+=RESULT_RETENTION_MS+1000;
  assert.equal(archive.read(id),null,'Expiry is based on archive retention, not account deletion');
  await archive.prune();
  assert.ok(!fs.existsSync(a),'Only TTL pruning/explicit history removal may erase video');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const scope=(start,end)=>server.slice(server.indexOf(start),server.indexOf(end,server.indexOf(start)));
const manual=scope("app.delete('/api/accounts/:id'","async function refreshPool(req)");
assert.ok(manual.includes('await ensureAccountResultsArchived(removing.id);'),
  'Manual account removal MUST archive completed results first');
assert.ok(manual.indexOf('await ensureAccountResultsArchived(removing.id);')<
  manual.indexOf('taskRegistry.retireAccount(removing);'));
assert.ok(!manual.includes('motionResults.remove('),'Account removal must never delete output');
const auto=scope('async function refreshPool(req)',"app.post('/api/accounts/refresh'");
assert.ok(auto.includes('await ensureAccountResultsArchived(entry.account.id)'));
const preview=scope("app.get('/api/tasks/:taskId/preview'","app.get('/api/tasks/:taskId/download'");
assert.ok(preview.includes('motionResults.read(req.params.taskId)'));
assert.ok(preview.indexOf('motionResults.read(req.params.taskId)')<
  preview.indexOf('resolveTaskVideoUrl('));
const download=scope("app.get('/api/tasks/:taskId/download'","// Handle mobile upload interruptions");
assert.ok(download.includes('motionResults.read(req.params.taskId)'));
assert.ok(download.indexOf('motionResults.read(req.params.taskId)')<
  download.indexOf('resolveTaskVideoUrl('));
assert.ok(server.includes("dir:path.join(DATA_DIR,'motion-results')"),'Archive must share existing persistent volume');
const client=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.ok(client.includes('await claimBrowserHistory();')&&client.includes('Akun belum dihapus: ada hasil lama'),
  'Browser-only History must be registered before removing original account credentials');
assert.ok(server.includes('autoRemovedCount=latest.length-next.length;'),
  'Refresh must report only accounts truly removed after archiving');
console.log('PASS: result media survives account deletion/restart, cache before remote, disk quota, safe cleanup and history TTL.');
