import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createH3AppearanceModel,validUploadedH3Lora,FFP_ASSET} from '../h3-appearance-model.js';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'h3-lora-upload-test-'));
try{
  const bytes=Buffer.from('test model bytes'),sha256=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
  const asset={url:FFP_ASSET.url,sha256,size:bytes.length};let downloads=0,uploads=0,calls=0;
  const name='api-lora-usa/'+md5+'.safetensors';
  assert.ok(validUploadedH3Lora(name));
  for(const x of ['../weights.safetensors','https://bad.test/model','api-lora-usa/../'+md5+'.safetensors'])assert.equal(validUploadedH3Lora(x),false);
  const http={get:async()=>{downloads++;return {data:Readable.from([bytes])};},
    put:async(url,stream,config)=>{uploads++;const chunks=[];for await(const x of stream)chunks.push(x);
      assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(config.maxRedirects,0);assert.equal(config.headers.Authorization,undefined);}};
  const request=async(route,key,body)=>{calls++;assert.equal(route,'/api/openapi/getLoraUploadUrl');
    assert.equal(key,'server-only');assert.equal(body.md5Hex,md5);
    return {code:0,data:{fileName:name,url:'https://rh-models.s3.us-west-2.amazonaws.com/model?signed=example'}};};
  const registryFile=path.join(dir,'receipts.json');
  const cache=createH3AppearanceModel({dir,request,http,asset,registryFile});
  assert.deepEqual(await Promise.all([cache.ensure('server-only'),cache.ensure('server-only')]),[name,name]);
  assert.equal(downloads,1);assert.equal(uploads,1);assert.equal(calls,1);
  const restarted=createH3AppearanceModel({dir,asset,registryFile,request:async()=>{throw Error('Receipt should survive deploy');}});
  assert.equal(await restarted.ensure('server-only'),name);
  assert.ok(!(await fs.readFile(registryFile,'utf8')).includes('server-only'));
  const bad=createH3AppearanceModel({dir:path.join(dir,'bad'),request:async()=>{throw Error('Corrupt weights must not be uploaded');},
    http:{get:async()=>({data:Readable.from([Buffer.from('changed')])})},asset});
  await assert.rejects(bad.ensure('server-only'),/Checksum/);
  assert.deepEqual((await fs.readdir(path.join(dir,'bad'))),[],'Failed downloads must not leave usable cache entries');
  const destination=createH3AppearanceModel({dir,asset,http,request:async()=>({code:0,data:{fileName:name,url:'https://untrusted.test/model'}})});
  await assert.rejects(destination.ensure('server-only'),/Host/);
  assert.equal(uploads,1,'Never PUT model bytes to an untrusted destination');
  console.log('PASS: checksum-pinned H3 weights, official authenticated upload, deduplication, verified MD5, no forwarded API credentials and upload-host guards');
}finally{await fs.rm(dir,{recursive:true,force:true});}
await import('./test-h3-model-transfer.mjs');
