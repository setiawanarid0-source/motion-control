import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import {akatzEditorWorkflow,installAkatzEditorDownload,AKATZ_EDITOR_FILENAME} from '../h3-runninghub-export.js';
import {AKATZ_PROFILE,AKATZ_REVISION,AKATZ_ASSET,akatzGraphForInputs} from '../h3-akatz-motion.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {createH3AppearanceModel} from '../h3-appearance-model.js';

const models={characterLoraFile:'api-lora-usa/'+'a'.repeat(32)+'.safetensors',
  turboLoraFile:'api-lora-usa/'+'b'.repeat(32)+'.safetensors'};
const workflow=akatzEditorWorkflow(models),nodes=new Map(workflow.nodes.map(n=>[String(n.id),n]));
const linkById=new Map(workflow.links.map(l=>[l[0],l]));
assert.equal(linkById.size,workflow.links.length);
assert.equal(nodes.size,workflow.nodes.length);
for(const link of workflow.links){
  const [id,from,output,to,input,type]=link;
  assert.ok(nodes.get(String(from)).outputs[output].links.includes(id));
  assert.equal(nodes.get(String(to)).inputs[input].link,id);
  assert.equal(nodes.get(String(to)).inputs[input].type,type);
}
for(const node of nodes.values()){
  for(const input of node.inputs)if(input.link!==null)assert.ok(linkById.has(input.link));
  for(const output of node.outputs)for(const link of output.links)assert.ok(linkById.has(link));
}
function value(id,name){
  const node=nodes.get(String(id)),input=node.inputs.find(i=>i.name===name);
  if(input?.link!==null&&input?.link!==undefined){
    const link=linkById.get(input.link),from=nodes.get(String(link[1]));
    if(from.type==='PrimitiveString')return from.widgets_values[0];
    return [String(link[1]),link[2]];
  }
  return node.widgets_values_named[name];
}
const api=akatzGraphForInputs({...models,imageName:'UPLOAD_PHOTO_1080x1920.png',videoName:'UPLOAD_VIDEO_15_SECONDS.mp4',
  source:{...h3PhotoPlan(1080,1920),inferenceProfile:AKATZ_PROFILE,fps:24,totalFrames:360,hasAudio:true,seed:42}});
// Reconstruct every original API input through editor sockets/widget values.
// This catches filename tuples stored as values without real links, and altered
// frame slices, model inputs or raw-latent output indices in editor conversion.
for(const [id,original] of Object.entries(api)){
  assert.equal(nodes.get(id).type,original.class_type);
  for(const [name,expected] of Object.entries(original.inputs)){
    if(name==='lora_name'&&expected==='')continue;
    assert.deepEqual(value(id,name),expected,id+'.'+name);
  }
}
assert.equal(workflow.extra.vanta_export.source_revision,AKATZ_REVISION);
assert.equal(workflow.extra.vanta_export.visual_acceptance,'pending_owner_test');
assert.equal(workflow.extra.vanta_export.generation_executed,false);
assert.equal(nodes.get('200').outputs[0].links.length,11);
for(const node of nodes.values()){
  const field=node.type==='VHS_LoadAudioUpload'?'audio':node.type==='VHS_LoadVideo'&&node.id!==1000?'video':null;
  if(!field)continue;
  const input=node.inputs.find(i=>i.name===field);
  assert.ok(input.link,'Every filename consumer needs a real STRING connection');
  assert.equal(linkById.get(input.link)[1],200);
  assert.equal(typeof node.widgets_values_named[field],'string','A filename widget cannot contain a graph tuple');
  if(node.type==='VHS_LoadAudioUpload'){
    assert.deepEqual(node.widgets_values,['',
      value(node.id,'start_time'),value(node.id,'duration'),'image']);
    assert.equal(node.widgets_values.length,4,'VHS audio restores three input widgets plus its upload button');
  }
}
assert.equal(value(493,'save_output'),false);assert.equal(value(493,'no_preview'),false);
assert.equal(value(490,'save_output'),true);assert.equal(value(490,'no_preview'),false);
assert.equal(nodes.get('490').flags.collapsed,true);
assert.equal(nodes.get('490').widgets_values.videopreview.hidden,true);
assert.deepEqual(value(493,'images'),value(490,'images'));
assert.deepEqual(value(493,'audio'),value(490,'audio'));
for(const id of [490,493]){
  assert.equal(value(id,'frame_rate'),24);assert.equal(value(id,'crf'),12);
  assert.equal(value(id,'format'),'video/h264-mp4');
}
assert.deepEqual(value(494,'filenames'),['493',0]);assert.equal(value(494,'index'),-1);
assert.deepEqual(value(496,'images or video_path'),['494',0]);
assert.equal(value(496,'image_format'),'PNG');assert.equal(value(496,'password'),'');
assert.equal([...nodes.values()].filter(n=>n.type==='SamplerCustomAdvanced').length,4);
assert.equal([...nodes.values()].filter(n=>n.type==='MiniMaxH3MotionContext').length,3);
for(const node of nodes.values())if(node.type==='MiniMaxH3MotionContext')assert.equal(value(node.id,'context_length'),'5');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-editor-export-'));
let requests=0;
try{
  const registryFile=path.join(dir,'receipts.json');
  fs.writeFileSync(registryFile,JSON.stringify({good:{name:models.characterLoraFile,sha256:AKATZ_ASSET.sha256},
    wrong:{name:models.turboLoraFile,sha256:'wrong'}}));
  const cache=createH3AppearanceModel({dir,registryFile,asset:AKATZ_ASSET,request:()=>{requests++;throw Error('No provider request permitted');}});
  assert.equal(cache.cachedFile(),models.characterLoraFile);assert.equal(requests,0);
  let available=models;const app=express();
  // The production mount is after ownerAuth.requireOwner; this isolated server
  // tests attachment/error behavior without external services or a GPU render.
  installAkatzEditorDownload({app,getModelFiles:()=>available});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub';
    const response=await fetch(url);assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.ok(response.headers.get('content-disposition').includes(AKATZ_EDITOR_FILENAME));
    assert.deepEqual(await response.json(),workflow);
    available={};const missing=await fetch(url);assert.equal(missing.status,503);
    assert.equal(missing.headers.get('content-disposition'),null,'Never download an error as a workflow');
    assert.match((await missing.json()).error,/Receipt/);assert.equal(requests,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
const serverSource=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(serverSource.indexOf('installAkatzEditorDownload({app,')>serverSource.indexOf('app.use(ownerAuth.requireOwner)'));
const appSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=appSource.indexOf("document.querySelector('.akatz-editor-download')"),end=appSource.indexOf('\nfunction initDropzone(',begin);
assert.ok(begin>0&&end>begin);
let handler,saved=0,failed=false;const notices=[],urls=[],attributes=new Map();
const link={href:'/api/workflows/minimaxH3Akatz/runninghub',download:AKATZ_EDITOR_FILENAME,
  addEventListener:(name,fn)=>{assert.equal(name,'click');handler=fn;},
  getAttribute:key=>attributes.get(key),setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:key=>attributes.delete(key)};
const client={document:{querySelector:()=>link,body:{append:()=>{}},createElement:()=>({click(){saved++;},remove(){}})},
  fetch:async url=>{urls.push(url);return failed?{ok:false,json:async()=>({error:'Receipt belum tersedia'})}:{ok:true,json:async()=>workflow};},
  URL:{createObjectURL:()=>'/blob/fixture',revokeObjectURL:()=>{}},Blob,
  setTimeout:fn=>fn(),toast:(text,error)=>notices.push({text,error})};
vm.runInNewContext(appSource.slice(begin,end),client);
await handler({preventDefault(){},currentTarget:link});assert.equal(saved,1);
assert.equal(attributes.has('aria-busy'),false);
failed=true;await handler({preventDefault(){},currentTarget:link});
assert.equal(saved,1,'A rejected download must never save provider/error JSON as a workflow');
assert.ok(notices.at(-1).error);assert.match(notices.at(-1).text,/Receipt/);
assert.ok(urls.every(url=>url==='/api/workflows/minimaxH3Akatz/runninghub'),'Download cannot submit inference');
console.log('PASS: editor round-trip preserves all v8 inference inputs; 11 typed filename links; final MP4 ZIP/audio/backup; authenticated mount; read-only receipt and HTTP export; no provider calls or GPU render');
