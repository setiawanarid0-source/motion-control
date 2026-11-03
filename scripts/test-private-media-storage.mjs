import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {createPrivateMediaBucket,privateMediaKey,PRIVATE_MEDIA_RETENTION} from '../private-media-bucket.js';
import {createGenerationQueue} from '../generation-queue.js';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-private-media-'));
const previous=process.env.VANTA_DATA_DIR;process.env.VANTA_DATA_DIR=path.join(root,'vault');
const refs=await import('../history-references.js?object-storage-fixture');
let now=Date.now(),corruptHead=false,failCopy=false,corruptBody=false,failList=false;
const objects=new Map(),calls=[],removed=[];
const missing=()=>Object.assign(Error('missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
const client={async send(command){
  const p=command.input,type=command.constructor.name;calls.push({type,key:p.Key,prefix:p.Prefix});
  const item=objects.get(p.Key);
  if(type==='HeadObjectCommand'){
    if(!item)throw missing();return {ContentLength:item.size,Metadata:corruptHead?{}:item.metadata};
  }
  if(type==='PutObjectCommand'){
    const data=Buffer.from(p.Body);objects.set(p.Key,{data,size:data.length,metadata:p.Metadata||{}});return {};
  }
  if(type==='CopyObjectCommand'){
    if(failCopy)throw Error('simulated copy outage');
    const src=objects.get(p.CopySource.slice(p.CopySource.indexOf('/')+1));if(!src)throw missing();objects.set(p.Key,{...src});return {};
  }
  if(type==='GetObjectCommand'){
    if(!item)throw missing();let data=item.data||Buffer.alloc(item.size);
    if(corruptBody)data=Buffer.alloc(data.length,99);
    const range=p.Range?.match(/^bytes=(\d+)-(\d+)$/),start=range?Number(range[1]):0,end=range?Number(range[2]):data.length-1;
    return {Body:Readable.from([data.subarray(start,end+1)]),ContentType:p.Key.endsWith('.jpg')?'image/jpeg':'video/mp4',
      ContentLength:end-start+1,...(range?{ContentRange:`bytes ${start}-${end}/${data.length}`}:{})};
  }
  if(type==='ListObjectsV2Command'){
    if(failList)throw Error('simulated list outage');
    return {Contents:[...objects.keys()].filter(k=>k.startsWith(p.Prefix)).map(Key=>({Key})),IsTruncated:false};
  }
  if(type==='DeleteObjectCommand'){removed.push(p.Key);objects.delete(p.Key);return {};}
  throw Error('Unexpected S3 call '+type);
}};
const store=createPrivateMediaBucket({env:{VANTA_RESULTS_BUCKET_NAME:'fixture'},client,clock:()=>now,
  upload:({params:p})=>({abort:async()=>{},done:async()=>{
    let size=0;const chunks=[];
    for await(const chunk of p.Body){size+=chunk.length;if(size<=1024*1024)chunks.push(chunk);}
    objects.set(p.Key,{data:size<=1024*1024?Buffer.concat(chunks):null,size,metadata:p.Metadata});
  }})});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const file=async(src,name='source.mp4',mimetype='video/mp4')=>({path:src,originalname:name,mimetype,size:(await fs.stat(src)).size});
async function bytes(dir){let total=0;for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const child=path.join(dir,entry.name);total+=entry.isDirectory()?await bytes(child):(await fs.stat(child)).size;}return total;}
try{
  assert.deepEqual(await store.verifyAccess(),{checked:true,verifiedBytes:4096,copy:true,range:true});
  // More than a whole 256 MiB account volume can be acknowledged durably while
  // only small state JSON files are written to that volume.
  const sparse=path.join(root,'upload-80mb.bin');await fs.writeFile(sparse,'');await fs.truncate(sparse,80*1024*1024);
  const capacityDir=path.join(root,'capacity-vault'),capacity=createGenerationQueue({dir:capacityDir,mediaStore:store,startPaused:true});
  for(let i=0;i<4;i++)await capacity.stage({jobId:randomUUID(),deviceId:'owner',body:{workflow:'rife60'},video:await file(sparse)});
  assert.ok(await bytes(capacityDir)<65536,'320 MiB of queued inputs must not fill a 256 MiB vault');
  assert.ok(!JSON.stringify(capacity.latest('owner')).includes('motion-inputs/'),'Private object receipts are server-only');

  const input=path.join(root,'small.bin');await fs.writeFile(input,Buffer.alloc(4096,37));
  const dir=path.join(root,'durable-vault'),q=createGenerationQueue({dir,mediaStore:store,startPaused:true});
  const id=randomUUID(),ambiguous=randomUUID();
  await q.stage({jobId:id,deviceId:'owner',body:{workflow:'rife60'},video:await file(input)});
  await q.stage({jobId:ambiguous,deviceId:'owner',body:{workflow:'rife60'},video:await file(input)});
  q.update(ambiguous,{stage:'submitting'});await fs.rm(input);
  let submitted=0;
  const restarted=createGenerationQueue({dir,mediaStore:store,startPaused:true});
  restarted.setExecutor(async(job,progress)=>{
    submitted++;assert.equal(job.jobId,id);assert.ok(!job.video.path.startsWith(dir));
    assert.deepEqual(await fs.readFile(job.video.path),Buffer.alloc(4096,37));
    progress('submitting');restarted.update(job.jobId,{stage:'accepted',task:{taskId:'2118000000000000001'}});
  });
  await wait(10);assert.equal(submitted,0,'Startup migration gates queue execution');
  await restarted.recoverMedia();restarted.resume();
  for(let i=0;i<100&&!restarted.read(id).mediaReleased;i++)await wait(10);
  assert.equal(submitted,1);assert.equal(restarted.read(id).stage,'accepted');
  assert.equal(restarted.read(ambiguous).stage,'uncertain','An interrupted paid boundary must not be retried');
  assert.ok(restarted.read(id).mediaReleased);assert.ok(!objects.has(restarted.read(id).video.object.key));

  // Upgrade recovery frees abandoned terminal inputs without changing failure
  // times, source uploads or any result-video bytes.
  const legacyDir=path.join(root,'legacy-vault'),source=path.join(root,'legacy-source.bin');await fs.writeFile(source,Buffer.alloc(8192,4));
  const legacy=createGenerationQueue({dir:legacyDir,startPaused:true}),failed=randomUUID(),queued=randomUUID();
  for(const jobId of [failed,queued])await legacy.stage({jobId,deviceId:'owner',body:{workflow:'rife60'},video:await file(source)});
  legacy.update(failed,{stage:'error',error:'old refusal'});const time=legacy.read(failed).updatedAt;
  const abandoned=path.join(legacyDir,'generation-submissions',randomUUID());await fs.mkdir(abandoned);
  await fs.writeFile(path.join(abandoned,'driving.bin'),Buffer.alloc(1024));
  const oldTime=new Date(Date.now()-5*3600000);await fs.utimes(abandoned,oldTime,oldTime);
  const upgraded=createGenerationQueue({dir:legacyDir,mediaStore:store,startPaused:true});
  const recovered=await upgraded.recoverMedia();assert.equal(recovered.freedBytes,17408);
  await assert.rejects(fs.stat(abandoned),e=>e.code==='ENOENT');
  assert.equal(upgraded.read(failed).updatedAt,time);assert.equal(upgraded.read(failed).stage,'error');
  assert.ok(upgraded.read(queued).video.object);assert.ok(!upgraded.read(queued).video.path);
  assert.equal((await fs.stat(source)).size,8192,'The original test upload is not deleted by queue recovery');

  const image=path.join(root,'photo.png'),video=path.join(root,'driver.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=red:s=120x180','-frames:v','1',image]);
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=120x180:r=12:d=0.6','-c:v','libx264','-pix_fmt','yuv420p',video]);
  const task='2118000000000000011',migration='2118000000000000012';
  await refs.saveReference(migration,'image',{path:image});await refs.saveReference(migration,'video',{path:video});
  const legacyCamera=path.join(process.env.VANTA_DATA_DIR,'camera-r15',migration);await fs.mkdir(legacyCamera,{recursive:true});
  await fs.copyFile(video,path.join(legacyCamera,'source.mp4'));
  const oldPreview=refs.referenceFile(migration,'video');
  refs.configureReferenceMedia(store);
  failList=true;assert.deepEqual(await refs.resolvedReferenceAvailability(migration),{image:true,video:true,legacy:false});failList=false;
  const stage=await refs.stageReferences({path:image},{path:video});
  assert.equal(stage.storage,'bucket');assert.equal(stage.files.length,2);
  failCopy=true;await assert.rejects(refs.commitReferences(stage,task),/copy outage/);failCopy=false;
  assert.equal((await refs.resolvedReferenceAvailability(task)).video,false,'A partial pair must never be published');
  assert.deepEqual(await refs.commitReferences(stage,task),{image:true,video:true,legacy:false});
  assert.ok(stage.files.every(x=>!objects.has(x.key)),'Committed staging objects are released');
  const rifeStage=await refs.stageReferences(null,{path:video},{videoOnly:true});assert.equal(rifeStage.files.length,1);
  await refs.discardReferences(rifeStage);assert.ok(!objects.has(rifeStage.files[0].key));

  corruptHead=true;const denied=await refs.migrateReferences();corruptHead=false;
  assert.equal(denied.deferred,1);assert.ok((await fs.stat(oldPreview)).size>500,'Failed remote verification must preserve local History');
  const moved=await refs.migrateReferences();assert.equal(moved.migratedTasks,1);assert.ok(moved.movedBytes>500);
  await assert.rejects(fs.stat(oldPreview),e=>e.code==='ENOENT');
  refs.configureReferenceMedia(store); // simulate a restart with an empty index cache
  assert.deepEqual(await refs.resolvedReferenceAvailability(migration),{image:true,video:true,legacy:false});
  assert.ok((await fs.stat(path.join(legacyCamera,'source.mp4'))).size>500,'Migration does not remove unrelated legacy source media');
  const partial=await refs.openRemoteReference(migration,'video','bytes=0-31');
  assert.equal(partial.status,206);assert.equal(partial.contentLength,32);
  const chunks=[];for await(const chunk of partial.body)chunks.push(chunk);assert.equal(Buffer.concat(chunks).length,32);

  // Execute the real reference routes: keep account authorization ahead of S3
  // and preserve HTML5 byte-range playback after the migration.
  const src=await fs.readFile(new URL('../server.js',import.meta.url),'utf8'),routes=new Map();
  const begin=src.indexOf('function referenceAccess('),end=src.indexOf("app.get('/api/camera-video/",begin);
  const context={app:{get:(url,handler)=>routes.set(url,handler)},
    taskAccount:(_req,_id,account)=>account==='fixture-account'?{}:null,
    resolvedReferenceAvailability:refs.resolvedReferenceAvailability,openRemoteReference:refs.openRemoteReference,referenceFile:refs.referenceFile};
  vm.createContext(context);vm.runInContext(src.slice(begin,end),context);
  class Response extends Writable{
    constructor(){super();this.statusCode=200;this.headers={};this.chunks=[];}
    _write(chunk,_encoding,callback){this.chunks.push(chunk);callback();}
    status(value){this.statusCode=value;return this;}
    setHeader(k,v){this.headers[k.toLowerCase()]=v;}
    type(v){this.setHeader('Content-Type',v);return this;}
    json(value){this.end(JSON.stringify(value));return this;}
  }
  const handler=routes.get('/api/task-references/:taskId/:kind'),deniedResponse=new Response(),before=calls.length;
  await handler({params:{taskId:migration,kind:'video'},query:{accountId:'other'},headers:{}},deniedResponse);
  assert.equal(deniedResponse.statusCode,404);assert.equal(calls.length,before,'Rejected accounts cannot query private media');
  const response=new Response();const complete=new Promise(r=>response.once('finish',r));
  await handler({params:{taskId:migration,kind:'video'},query:{accountId:'fixture-account'},headers:{range:'bytes=2-15'}},response);await complete;
  assert.equal(response.statusCode,206);assert.equal(response.headers['content-length'],'14');
  assert.equal(response.headers['cache-control'],'private, no-store');assert.equal(response.headers['accept-ranges'],'bytes');
  assert.equal(Buffer.concat(response.chunks).length,14);

  const corruptDestination=path.join(root,'corrupt.bin'),receipt=upgraded.read(queued).video.object;
  corruptBody=true;await assert.rejects(store.download(receipt,corruptDestination),/checksum/);corruptBody=false;
  await assert.rejects(fs.stat(corruptDestination),e=>e.code==='ENOENT');
  const resultKey='motion-results/v1/2118000000000000999/'+now+'.mp4';objects.set(resultKey,{size:500,data:Buffer.alloc(500)});
  now+=PRIVATE_MEDIA_RETENTION+1000;await store.prune();
  assert.ok(objects.has(resultKey),'Input cleanup must never delete completed result objects');
  assert.ok(removed.every(k=>k.startsWith('motion-inputs/v1/')));
  assert.throws(()=>privateMediaKey('references','../other',now,'driving.mp4'));
  console.log('PASS: 320 MiB durable inputs outside a 256 MiB vault, restart/idempotency safety, terminal-input recovery, verified reference migration, failure rollback, private byte-range routes, checksum/expiry guards and untouched 72h results; no provider inference');
}finally{
  refs.configureReferenceMedia(null);if(previous===undefined)delete process.env.VANTA_DATA_DIR;else process.env.VANTA_DATA_DIR=previous;
  await fs.rm(root,{recursive:true,force:true});
}
