import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import fs from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import {installFrameDiagnostics} from '../h3-frame-diagnostics.js';
import {selectFrameDiagnosticArchive,selectOriginalVideoArchive} from '../runninghub-output.js';
const frames={nodeId:'5108',fileType:'zip',fileUrl:'https://provider.example/frame.zip'};
const video={nodeId:'496',fileType:'zip',fileUrl:'https://provider.example/video.zip'};
for(const list of [[frames,video],[video,frames]]){
  assert.equal(selectOriginalVideoArchive(list),video);assert.equal(selectFrameDiagnosticArchive(list),frames);
}
assert.equal(selectOriginalVideoArchive([frames]),undefined);
const anonymousFrames={fileType:'zip',fileUrl:'https://provider.example/opaque.zip',filename:'VANTA_AKATZ_3_FRAME_PNG_001.zip'};
assert.equal(selectOriginalVideoArchive([anonymousFrames,video]),video);
assert.equal(selectFrameDiagnosticArchive([anonymousFrames]),anonymousFrames);
// Exercise the actual client output boundary, including ID-less named ZIPs.
const clientSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=clientSource.indexOf('function selectTaskOutputs('),end=clientSource.indexOf('function finishFailed(',start);
const context=vm.createContext({getDeviceId:()=> 'local-device'});
vm.runInContext(clientSource.slice(start,end)+'\nthis.select=selectTaskOutputs;',context);
for(const list of [[frames,video],[anonymousFrames,video]]){
  const selected=context.select(list,'video','2119999999999999999','owner');
  assert.match(selected.videoUrl,/\/preview\?accountId=owner/);
  assert.match(selected.frameZipUrl,/\/frames\?accountId=owner&deviceId=local-device/);
}
assert.equal(context.select([frames],'video','2119999999999999999','owner').videoUrl,null,
  'A PNG archive alone cannot become the video preview');
assert.throws(()=>selectOriginalVideoArchive([{fileType:'zip',fileUrl:'https://provider.example/a.zip'},
  {fileType:'zip',fileUrl:'https://provider.example/b.zip'}]),/beberapa ZIP/);
const id='2119999999999999999',now=Date.now();let queries=0,downloads=0;
const task={taskId:id,accountId:'owner',status:'success',finishedAt:new Date(now).toISOString()};
const registry={get:key=>key===id?task:null,update:(key,patch)=>{assert.equal(key,id);Object.assign(task,patch);}};
const app=express();
installFrameDiagnostics({app,registry,clock:()=>now,getAccount:(_req,key,account)=>key===id&&account==='owner'?{key:'private'}:null,
  getOutputs:async()=>{queries++;return [frames,video];},validUrl:url=>url.startsWith('https://provider.example/'),
  request:async url=>{downloads++;assert.equal(url,frames.fileUrl);return {headers:{},data:Readable.from([Buffer.from('ZIP-FRAME-BYTES')])};}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const url='http://127.0.0.1:'+server.address().port+'/api/tasks/'+id+'/frames?accountId=';
try{
  const denied=await fetch(url+'other');assert.equal(denied.status,404);assert.equal(queries,0);assert.equal(downloads,0);
  const r=await fetch(url+'owner');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');
  assert.ok(r.headers.get('content-disposition').includes('-3-frame-png.zip'));assert.equal(await r.text(),'ZIP-FRAME-BYTES');
  assert.equal(task.hasFrameDiagnostics,true);assert.equal(task.frameArchiveUrl,frames.fileUrl);
  await (await fetch(url+'owner')).arrayBuffer();assert.equal(queries,1,'Reuse only the matched task output');
  task.status='running';assert.equal((await fetch(url+'owner')).status,409);
  task.status='success';task.finishedAt=new Date(now-72*60*60*1000).toISOString();
  assert.equal((await fetch(url+'owner')).status,410);assert.equal(downloads,2);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('PASS: MP4 ZIP separated from three-PNG ZIP, shuffled and ID-less named outputs, ambiguous archives rejected; account-scoped streaming, cache and 72-hour expiry; no inference.');
