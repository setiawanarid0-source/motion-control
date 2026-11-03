import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createH3AppearanceModel} from '../h3-appearance-model.js';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-model-transfer-'));
const bytes=Buffer.from('public-model-fixture'),md5=createHash('md5').update(bytes).digest('hex');
const asset={url:'https://huggingface.co/fixture/model',name:'fixture',size:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex')};
const usa='api-lora-usa/'+md5+'.safetensors',cn='api-lora-cn/'+md5+'.safetensors';
const reply=name=>({code:0,data:{fileName:name,url:'https://models.s3.us-west-2.amazonaws.com/'+name+'?signed=private'}});
let gets=0,puts=0;const metadata=[],progress=[];
const http={get:async()=>{gets++;return {data:Readable.from([bytes])};},
  put:async(_url,stream,options)=>{puts++;assert.equal(options.headers.Authorization,undefined);
    const chunks=[];for await(const b of stream)chunks.push(b);
    assert.deepEqual(Buffer.concat(chunks),bytes);options.onUploadProgress?.({loaded:bytes.length});}};
const request=async(route,key,body)=>{
  assert.equal(route,'/api/openapi/getLoraUploadUrl','Cache work must never call task creation');
  assert.equal(body.md5Hex,md5);metadata.push(key);return reply(usa);
};
try{
  const registryFile=path.join(root,'receipts.json');
  const first=createH3AppearanceModel({dir:path.join(root,'first'),registryFile,asset,http,request});
  await first.ensure('key-one',{onProgress:x=>progress.push(x)});
  assert.equal(gets,1);assert.equal(puts,1);
  for(const phase of ['checking_cache','downloading','verifying','uploading','waiting_confirmation','ready'])
    assert.ok(progress.some(x=>x.phase===phase),'Missing truthful transfer phase: '+phase);
  assert.ok(!JSON.stringify(progress).includes('private'));assert.ok(!JSON.stringify(progress).includes('key-one'));

  // A fresh deployment has no local model bytes. Another account must first
  // resolve exactly the successful uploaded path, then skip both GET and PUT.
  const peer=createH3AppearanceModel({dir:path.join(root,'empty-after-deploy'),registryFile,asset,request,
    http:{get:async()=>{throw Error('Cached model cannot be downloaded again');},
      put:async()=>{throw Error('Cached model cannot be uploaded again');}}});
  assert.equal(await peer.primeCached('key-two'),usa);assert.equal(metadata.at(-1),'key-two');
  assert.equal(await peer.ensure('key-two'),usa);
  assert.equal(gets,1);assert.equal(puts,1);
  assert.ok(!(await fs.readFile(registryFile,'utf8')).includes('key-two'));
  const restarted=createH3AppearanceModel({dir:root,registryFile,asset,
    request:async()=>{throw Error('Same-account receipt must survive restart');}});
  assert.equal(await restarted.ensure('key-two'),usa);

  // A different region/path is a miss; a cache-only warmup may not upload it.
  const regional=createH3AppearanceModel({dir:path.join(root,'region'),registryFile,asset,http,
    request:async()=>reply(cn)});
  assert.equal(await regional.primeCached('key-region'),null);assert.equal(puts,1);
  assert.equal(await regional.ensure('key-region'),cn);assert.equal(gets,2);assert.equal(puts,2);
  const changed=createH3AppearanceModel({dir:root,registryFile,asset:{...asset,sha256:'f'.repeat(64)},
    request:async()=>{throw Error('Another SHA cannot reuse these receipts');}});
  assert.equal(await changed.primeCached('key-three'),null);

  // Concurrent accounts resolving the same destination share one actual PUT.
  let sharedGets=0,sharedPuts=0;
  const concurrent=createH3AppearanceModel({dir:path.join(root,'concurrent'),asset,request,
    http:{get:async()=>{sharedGets++;return {data:Readable.from([bytes])};},
      put:async(_url,stream,options)=>{sharedPuts++;for await(const b of stream){}
        await new Promise(r=>setTimeout(r,15));options.onUploadProgress?.({loaded:bytes.length});}}});
  assert.deepEqual(await Promise.all([concurrent.ensure('concurrent-one'),concurrent.ensure('concurrent-two')]),[usa,usa]);
  assert.equal(sharedGets,1);assert.equal(sharedPuts,1);

  // Abort the entire transfer even if socket/progress activity continues.
  const stalled=createH3AppearanceModel({dir:path.join(root,'stalled'),asset,request,
    transferTimeouts:{downloadMs:1000,uploadMs:25},http:{get:http.get,
      put:async(_url,stream,options)=>{
        for await(const b of stream){}
        const tick=setInterval(()=>options.onUploadProgress?.({loaded:1}),3);
        try{await new Promise((resolve,reject)=>{
          if(options.signal.aborted)return reject(options.signal.reason);
          options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
        });}finally{clearInterval(tick);}
      }}});
  const started=Date.now();await assert.rejects(stalled.ensure('stalled-key'),e=>e.code==='MODEL_TRANSFER_TIMEOUT');
  assert.ok(Date.now()-started<1500);
  const noBody=createH3AppearanceModel({dir:path.join(root,'no-body'),asset,request,
    transferTimeouts:{downloadMs:25,uploadMs:1000},http:{get:async()=>({data:new Readable({read(){}})})}});
  await assert.rejects(noBody.ensure('no-body-key'),e=>e.code==='MODEL_TRANSFER_TIMEOUT');
  assert.deepEqual(await fs.readdir(path.join(root,'no-body')),[],'An aborted download leaves no usable model');

  // Execute the real UI renderer with actual byte counts, ACK wait and reset.
  const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const code=app.slice(app.indexOf('function stageDescription('),app.indexOf('function completedSubmission('));
  const element=()=>{const classes=new Set(),attrs={};return {textContent:'',style:{},hidden:false,attrs,
    classList:{remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x),contains:x=>classes.has(x)},
    setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],querySelector:()=>({textContent:''})};};
  const nodes=new Map(['#taskSection','#taskStatus','#taskId','#taskEstimate','#generateBtn','#taskProgressTrack','#taskProgressBar'].map(k=>[k,element()]));
  const context={$:s=>{assert.ok(nodes.has(s),s);return nodes.get(s);}};
  vm.createContext(context);vm.runInContext(code+'\nthis.render=showSubmissionStage;this.bar=modelProgressBar;',context);
  context.render({stage:'preparing_models',modelPreparation:{component:'accelerator',phase:'uploading',loaded:1048576,total:2097152}});
  assert.match(nodes.get('#taskStatus').textContent,/akselerator.*50%/);
  assert.equal(nodes.get('#taskEstimate').textContent,'1 / 2 MB');
  assert.equal(nodes.get('#taskProgressBar').style.width,'50%');
  assert.equal(nodes.get('#taskProgressTrack').attrs['aria-valuenow'],'50');
  context.render({stage:'preparing_models',modelPreparation:{component:'accelerator',phase:'waiting_confirmation',loaded:2,total:2}});
  assert.match(nodes.get('#taskStatus').textContent,/konfirmasi/);
  context.render({stage:'submitting'});
  assert.equal(nodes.get('#taskProgressTrack').classList.contains('indeterminate'),true);
  assert.equal(nodes.get('#taskProgressBar').style.width,'');
  context.bar(null,true);assert.equal(nodes.get('#taskProgressTrack').hidden,true);
  context.bar(null);assert.equal(nodes.get('#taskProgressTrack').hidden,false);
  console.log('PASS: authorized MD5/region cache reuse across accounts and restarts, one shared PUT, absolute transfer aborts, safe progress and real UI byte/ACK rendering; no inference');
}finally{await fs.rm(root,{recursive:true,force:true});}
