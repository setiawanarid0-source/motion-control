import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import vm from 'node:vm';
import express from 'express';
import {createMotionResultBucket,MOTION_VIDEO_RETENTION_MS} from '../motion-result-bucket.js';
import {createMotionResultArchive} from '../motion-result-archive.js';
import {createTaskRegistry} from '../task-registry.js';
import {createOriginalVideoDelivery,withExtractedOriginal,ORIGINAL_VIDEO_SOURCE} from '../original-video-delivery.js';

const fixture=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(4096,31)]);
const digest=createHash('sha256').update(fixture).digest('hex');
const id='2110000000000000777',accountId='fixture-account';
const url='https://files.example.test/existing-original.zip?signature=fixture';
test('Live result UI uses the private preview and download even for ZIP-only output',()=>{
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function selectTaskOutputs('),end=source.indexOf('function finishFailed(',start);
  const context={getDeviceId:()=> 'fixture-device'};
  vm.runInNewContext(source.slice(start,end)+'\nthis.select=selectTaskOutputs;',context);
  const zipOutput={fileType:'zip',fileUrl:url},backup={fileType:'mp4',fileUrl:'https://files.example.test/backup.mp4'};
  for(const outputs of [[zipOutput],[backup,zipOutput],[zipOutput,backup]]){
    const result=context.select(outputs,'video',id,accountId);
    assert.equal(result.videoUrl,`/api/tasks/${id}/preview?accountId=${accountId}&deviceId=fixture-device`);
    assert.equal(result.videoUrl.replace('/preview?','/download?'),
      `/api/tasks/${id}/download?accountId=${accountId}&deviceId=fixture-device`);
  }
});
function zip(dir,entries=[['final.mp4',fixture.toString('base64')]]){
  const target=path.join(dir,'fixture.zip');
  execFileSync('/usr/bin/python3',['-c',
    'import sys,json,zipfile,base64; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); [(z.writestr(n,base64.b64decode(b))) for n,b in json.loads(sys.argv[2])]; z.close()',
    target,JSON.stringify(entries)]);
  return fs.readFileSync(target);
}
function fixtureBucket(clock){
  const stored=new Map(),uploads=[];
  const client={async send(command){
    const {Key,Range}=command.input,record=stored.get(Key),name=command.constructor.name;
    if(name==='HeadObjectCommand'){
      if(record)return {ContentLength:record.length};
    }else if(name==='GetObjectCommand'){
      if(record){
        const range=Range?.match(/^bytes=(\d+)-(\d+)$/);
        const start=Number(range?.[1]||0),end=range?Number(range[2]):record.length-1;
        const data=record.subarray(start,end+1);
        return {Body:Readable.from([data]),ContentType:'video/mp4',ContentLength:data.length,
          ...(range?{ContentRange:`bytes ${start}-${end}/${record.length}`}:{})};
      }
    }else if(name==='ListObjectsV2Command')return {Contents:[...stored.keys()].map(Key=>({Key}))};
    else if(name==='DeleteObjectCommand'){stored.delete(Key);return {};}
    else throw Error('Unexpected storage operation');
    throw Object.assign(Error('missing'),{name:'NotFound',$metadata:{httpStatusCode:404}});
  }};
  const bucket=createMotionResultBucket({client,clock,
    request:async()=>{throw Error('Backup MP4 must not be downloaded for ZIP delivery');},
    uploader:async({params})=>{
      const chunks=[];for await(const chunk of params.Body)chunks.push(chunk);
      stored.set(params.Key,Buffer.concat(chunks));uploads.push(params);
    }});
  return {bucket,stored,uploads};
}

test('ZIP extraction preserves exact MP4 bytes, checks CRC and cleans temporary files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-zip-test-'));
  try{
    const data=zip(dir);let consumedFile;
    await withExtractedOriginal(url,receipt=>{
      consumedFile=receipt.file;
      assert.equal(receipt.bytes,fixture.length);assert.equal(receipt.sha256,digest);
      assert.deepEqual(fs.readFileSync(receipt.file),fixture);
    },{tmpRoot:dir,request:async()=>({data:Readable.from([data]),headers:{}})});
    assert.equal(fs.existsSync(consumedFile),false);
    for(const entries of [
      [['a.mp4',fixture.toString('base64')],['b.mp4',fixture.toString('base64')]],
      [['../escape.mp4',fixture.toString('base64')]],
      [['not-video.mp4',Buffer.alloc(2048).toString('base64')]]
    ]){
      const invalid=zip(dir,entries);
      await assert.rejects(withExtractedOriginal(url,()=>assert.fail('Invalid archive consumed'),
        {tmpRoot:dir,request:async()=>({data:Readable.from([invalid]),headers:{}})}),/diverifikasi/);
    }
    const broken=zip(dir);broken[45]^=0xff;
    await assert.rejects(withExtractedOriginal(url,()=>assert.fail('Corrupt archive consumed'),
      {tmpRoot:dir,request:async()=>({data:Readable.from([broken]),headers:{}})}),/diverifikasi/);
    assert.deepEqual(fs.readdirSync(dir),['fixture.zip']);
    await assert.rejects(withExtractedOriginal('https://127.0.0.1/private',()=>{}),/tidak valid/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Existing task upgrades old cached preview; preview and download serve identical original bytes and ranges',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-delivery-test-'));
  let now=Date.parse('2026-11-11T00:00:00Z'),lookups=0,downloads=0;
  const finishedAt=new Date(now-3600000).toISOString();
  const registry=createTaskRegistry({dir,encrypt:JSON.stringify,decrypt:JSON.parse,now:()=>now});
  registry.add({taskId:id,key:'fixture-credential',accountId,workflow:'MotionFly · 1080 HD + ZIP'});
  registry.update(id,{status:'success',finishedAt,resultUrl:'https://files.example.test/backup.mp4'});
  const {bucket,stored,uploads}=fixtureBucket(()=>now);
  const oldKey=bucket.key(registry.get(id));stored.set(oldKey,Buffer.from('OLD PREVIEW'));
  const archive=createMotionResultArchive({dir:path.join(dir,'local'),clock:()=>now});
  const data=zip(dir);
  const delivery=createOriginalVideoDelivery({registry,bucket,archive,clock:()=>now,
    outputs:async task=>{
      lookups++;assert.equal(task.taskId,id);assert.equal(task.accountId,accountId);
      return [{fileType:'mp4',fileUrl:task.resultUrl},{fileType:'zip',fileUrl:url,nodeId:''}];
    },extract:(url,consume)=>withExtractedOriginal(url,consume,{tmpRoot:dir,
      request:async()=>{downloads++;return {data:Readable.from([data]),headers:{}};}})});
  let server;
  try{
    assert.deepEqual(await Promise.all([delivery.ensure(id),delivery.ensure(id)]),[true,true]);
    const original=registry.get(id),originalKey=bucket.key(original);
    assert.notEqual(originalKey,oldKey);assert.equal(stored.get(oldKey).toString(),'OLD PREVIEW');
    assert.deepEqual(stored.get(originalKey),fixture);assert.equal(original.resultOriginalSHA256,digest);
    assert.equal(original.resultOriginalBytes,fixture.length);assert.equal(original.finishedAt,finishedAt);
    assert.equal(original.resultSource,ORIGINAL_VIDEO_SOURCE);
    assert.equal(downloads,1);assert.equal(lookups,1);assert.equal(uploads.length,1);
    assert.equal(uploads[0].Metadata.originalsha256,digest);
    // Restart, removed Pool entry, expired token: serving needs only the task archive.
    const restarted=createOriginalVideoDelivery({registry,bucket,archive,clock:()=>now,
      outputs:async()=>{throw Error('Expired provider token must not be used');}});
    assert.equal(await restarted.ensure(id),true);
    assert.deepEqual(await restarted.verify(id),{source:ORIGINAL_VIDEO_SOURCE,bytes:fixture.length,sha256:digest,verified:true});

    // Mount the actual two production handlers, with the same storage and
    // registry. Neither handler may silently fall back to the old MP4.
    const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
    const begin=source.indexOf('async function streamBucketVideo(');
    const end=source.indexOf('// Handle mobile upload interruptions',begin);
    const app=express();
    const context={app,taskRegistry:registry,bucketResults:bucket,motionResults:archive,
      originalDelivery:restarted,ORIGINAL_VIDEO_SOURCE,console,
      getPersistentAccounts:()=>({accounts:[]}),
      taskAccount:(_req,taskId,requested)=>taskId===id&&requested===accountId?{id:accountId}:null,
      readLegacyFinal40:()=>assert.fail('Old cached output must not win'),
      readCorrected:()=>assert.fail('Old corrected output must not win'),
      resolveTaskVideoUrl:()=>assert.fail('Old provider output must not win'),axios:{get:()=>assert.fail('No backup request')}};
    vm.runInNewContext(source.slice(begin,end),context);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/api/tasks/'+id;
    for(const action of ['preview','download']){
      const res=await fetch(base+'/'+action+'?accountId='+accountId);
      assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
      assert.match(res.headers.get('content-disposition'),action==='preview'?/^inline/:/^attachment/);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()),fixture);
      const partial=await fetch(base+'/'+action+'?accountId='+accountId,{headers:{Range:'bytes=0-31'}});
      assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),`bytes 0-31/${fixture.length}`);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()),fixture.subarray(0,32));
      assert.equal((await fetch(base+'/'+action+'?accountId=wrong-account')).status,404);
    }
    now=Date.parse(finishedAt)+MOTION_VIDEO_RETENTION_MS-1;
    assert.equal(await bucket.prune(),0);
    now++;assert.equal(await bucket.prune(),2,'Both archive versions expire at the original completion plus 72h');
    assert.equal(stored.size,0);
    await assert.rejects(restarted.ensure(id),/berakhir/);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('Missing or invalid ZIP remains retryable and never marks the backup as original',async()=>{
  const task={taskId:id,accountId,status:'success',workflow:'MotionFly · 1080 HD + ZIP',finishedAt:new Date().toISOString()};
  const registry={get:()=>task,update:(_id,patch)=>Object.assign(task,patch)};
  const bucket={ready:true,exists:async()=>false,mirror:()=>assert.fail('No invalid original upload')};
  let attempts=0;
  const delivery=createOriginalVideoDelivery({registry,bucket,archive:{},outputs:async()=>[],
    extract:async()=>{attempts++;throw Error('ZIP unavailable');}});
  await assert.rejects(delivery.ensure(id),/ZIP video asli belum tersedia/);
  assert.equal(task.resultSource,undefined);
  task.resultArchiveUrl=url;
  await assert.rejects(delivery.ensure(id),/ZIP unavailable/);
  await assert.rejects(delivery.ensure(id),/ZIP unavailable/);
  assert.equal(attempts,2);assert.equal(task.resultSource,undefined);
});

test('Local fallback keeps original bytes separately and expires at the original finish time',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-local-test-'));
  let now=Date.parse('2026-11-11T00:00:00Z');
  const task={taskId:id,finishedAt:new Date(now-3600000).toISOString()};
  try{
    const source=path.join(dir,'source.mp4');fs.writeFileSync(source,fixture);
    const archive=createMotionResultArchive({dir:path.join(dir,'results'),clock:()=>now});
    await archive.storeOriginal(task,source);
    assert.deepEqual(fs.readFileSync(archive.readOriginal(task)),fixture);
    now=Date.parse(task.finishedAt)+MOTION_VIDEO_RETENTION_MS;
    assert.equal(archive.readOriginal(task),null);now++;
    await archive.prune();assert.equal(fs.existsSync(path.join(dir,'results',id+'-original.mp4')),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
