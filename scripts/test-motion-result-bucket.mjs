import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import {createMotionResultBucket,MOTION_VIDEO_RETENTION_MS,
  RESULT_BUCKET_PREFIX} from '../motion-result-bucket.js';

let now=Date.parse('2026-10-30T00:00:00.000Z');
const completed=new Date(now-60*60*1000).toISOString();
const id='2110000000000000777',url='https://files.runninghub.ai/rife-60.mp4';
const task={taskId:id,finishedAt:completed,status:'success',resultUrl:url};
const key=RESULT_BUCKET_PREFIX+id+'/'+(Date.parse(completed)+MOTION_VIDEO_RETENTION_MS)+'.mp4';
const stored=new Set();
const deleted=[];
const calls=[];
const client={
  async send(command){
    calls.push(command.constructor.name);
    const input=command.input;
    if(command.constructor.name==='HeadObjectCommand'){
      if(stored.has(input.Key))return {ContentLength:240000000};
      throw Object.assign(Error('missing'),{name:'NotFound',$metadata:{httpStatusCode:404}});
    }
    if(command.constructor.name==='GetObjectCommand'){
      if(!stored.has(input.Key))throw Object.assign(Error('missing'),{name:'NoSuchKey'});
      return {ContentType:'video/mp4',ContentLength:40,ContentRange:input.Range?'bytes 0-39/40':undefined,
        Body:Readable.from([Buffer.alloc(40)])};
    }
    if(command.constructor.name==='ListObjectsV2Command'){
      return {Contents:[...stored].map(Key=>({Key})),IsTruncated:false};
    }
    if(command.constructor.name==='DeleteObjectCommand'){
      stored.delete(input.Key);deleted.push(input.Key);return {};
    }
    throw Error('unexpected '+command.constructor.name);
  }
};
const env={VANTA_RESULTS_BUCKET_ENDPOINT:'https://bucket.example.test',
  VANTA_RESULTS_BUCKET_NAME:'vanta-motion-results-test',
  VANTA_RESULTS_BUCKET_REGION:'auto',
  VANTA_RESULTS_BUCKET_ACCESS_KEY_ID:'testkey',
  VANTA_RESULTS_BUCKET_SECRET_ACCESS_KEY:'testsecret'};
let uploads=0,downloads=0;
const request=async(theUrl,options)=>{
  downloads++;
  assert.equal(theUrl,url);assert.equal(options.responseType,'stream');
  // A 512MB provider output is valid. Multipart streaming—not /data volume—
  // handles it without an arbitrary 128MB cap or complete in-memory buffer.
  return {headers:{'content-length':String(512*1024*1024),'content-type':'video/mp4'},
    data:Readable.from([Buffer.alloc(8*1024)])};
};
const uploader=async ({params,partSize})=>{
  uploads++;
  assert.equal(params.Bucket,'vanta-motion-results-test');
  assert.equal(params.Key,key);
  assert.equal(params.ContentType,'video/mp4');
  assert.ok(partSize>=5*1024*1024);
  let consumed=0;for await(const chunk of params.Body)consumed+=chunk.length;
  assert.ok(consumed>1024);
  stored.add(key);
};
const archive=createMotionResultBucket({env,client,request,uploader,clock:()=>now});
assert.equal(archive.ready,true);
assert.equal(archive.key(task),key);
assert.equal(await archive.open(task),null);
const [one,two]=await Promise.all([archive.mirror(task),archive.mirror(task)]);
assert.equal(one,key);assert.equal(two,key);
assert.equal(uploads,1,'simultaneous attempts must not duplicate provider downloads');
assert.equal(downloads,1);
assert.equal(await archive.exists(task),true);
await archive.mirror(task);
assert.equal(uploads,1,'cached video must survive removed API key / restarts');
const partial=await archive.open(task,'bytes=0-39');
assert.equal(partial.status,206);
assert.equal(partial.contentRange,'bytes 0-39/40');
const full=await archive.open(task);
assert.equal(full.status,200);
const newInstance=createMotionResultBucket({env,client,request,uploader,clock:()=>now});
assert.equal(await newInstance.exists(task),true);
assert.equal(await newInstance.open(task)!=null,true);
assert.equal(newInstance.key({...task,finishedAt:new Date(now-MOTION_VIDEO_RETENTION_MS-1).toISOString()}),null);
assert.equal(await newInstance.open({...task,finishedAt:new Date(now-MOTION_VIDEO_RETENTION_MS-1).toISOString()}),null);
assert.equal(await archive.mirror({...task,taskId:'invalid'}).then(()=>false,()=>true),true);
await assert.rejects(archive.mirror({...task,taskId:'2110000000000000788',resultUrl:'https://127.0.0.1/private'}),/Invalid RunningHub/);
now=Date.parse(completed)+MOTION_VIDEO_RETENTION_MS-1;
assert.equal(await archive.prune(),0,'Video must remain through the full 72h');
assert.equal(await archive.exists(task),true);
now++;
assert.equal(archive.key(task),null,'Exactly 72h marks expiry');
assert.equal(await archive.prune(),1);
assert.deepEqual(deleted,[key]);
assert.equal(stored.has(key),false);
assert.equal(await archive.prune(),0,'Pruning is idempotent');
assert.ok(calls.includes('GetObjectCommand'));
assert.ok(calls.includes('ListObjectsV2Command'));

const src=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(src.includes("const bucketResults=createMotionResultBucket();"));
assert.ok(src.includes('bucketResults.mirror(task)'));
assert.ok(src.includes('await bucketResults.exists(task)'));
assert.ok(src.includes('if(await streamBucketVideo(req,res))return;'));
assert.ok(src.includes('if(await streamBucketVideo(req,res,{download:true}))return;'));
assert.ok(src.includes('5*60*1000).unref();'),'Automatic expiry sweeper must run every five minutes');
assert.ok(src.includes('taskRegistry.retireAccount(removing);'));
assert.ok(src.includes('scheduleAccountResultArchiving(removing.id);'));
assert.ok(!src.includes('await ensureAccountResultsArchived'),
  'Result archiving must run independently from account pool removal');
assert.ok(src.includes('void bucketResults.remove(archivedTask)'));
console.log('PASS: S3 multipart archive supports 512MB output with no 128MB cap, independent provider keys, 72h expiry and auto-deletion.');
