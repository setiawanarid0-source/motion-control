import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {createH3AppearanceModel} from '../h3-appearance-model.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {TURBO8_REVISION,TURBO8_ASSET,TURBO8_EDITOR_FILENAME,turbo8TemporalPlan,turbo8GraphForInputs,
  turbo8ExecutionPlan,turbo8SeedNodeInfo,turbo8EditorWorkflow} from '../h3-akatz-turbo8.js';

const template=JSON.parse(fs.readFileSync(new URL('../workflows/h3-akatz-turbo8-template.json',import.meta.url)));
const byId=new Map(template.nodes.map(n=>[String(n.id),n])),edges=new Map(template.links.map(l=>[l[0],l]));
const models={characterLoraFile:'api-lora-usa/55c5bb53f1104e3cd4fed7fbe5d522d7.safetensors',
  turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const source=(frames,hasAudio=true,w=1080,h=1936)=>({...h3PhotoPlan(w,h),inferenceProfile:'akatz-v1.5-native4-ref2v',
  fps:24,totalFrames:frames,hasAudio,seed:987654321});
const build=s=>turbo8GraphForInputs({...models,source:s,imageName:'photo.png',videoName:'video.mp4'});
const isLink=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string';
// Reference calculation reads the unmodified editor's expressions and edges.
function referenceMath(nodeId,frames,memo=new Map()){
  if(memo.has(nodeId))return memo.get(nodeId);
  const node=byId.get(String(nodeId));assert.equal(node.type,'MathExpression|pysssss');
  const context={max:Math.max,min:Math.min,ceil:Math.ceil,floor:Math.floor};
  for(const input of node.inputs||[]){
    if(input.link==null)continue;
    const edge=edges.get(input.link);
    context[input.name]=edge[1]===1000?(assert.equal(edge[2],1),frames):referenceMath(edge[1],frames,memo);
  }
  const result=new Function(...Object.keys(context),'return ('+node.widgets_values_named.expression+');')(...Object.values(context));
  memo.set(nodeId,result);return result;
}
function batchTools(graph,total){
  const memo=new Map();
  const input=v=>isLink(v)?output(v[0],v[1]):v;
  function output(id,port=0){
    const key=id+':'+port;if(memo.has(key))return memo.get(key);
    const n=graph[id];assert.ok(n,'Dangling API reference '+id);
    const a=n.inputs;let value;
    switch(n.class_type){
      case 'VHS_LoadVideo':value=total;break;
      case 'MiniMaxH3ReferenceToVideo':value=input(a.length);break;
      case 'SamplerCustomAdvanced':value=input(a.latent_image);break;
      case 'LTXVSeparateAVLatent':value=input(a.av_latent);break;
      case 'VAEDecode':value=input(a.samples);break;
      case 'ImageCrop':value=input(a.image);break;
      case 'ImageBatch':value=input(a.image1)+input(a.image2);break;
      case 'RepeatImageBatch':value=input(a.image)*input(a.amount);break;
      case 'ImageFromBatch':value=Math.min(input(a.length),Math.max(0,input(a.image)-input(a.batch_index)));break;
      case 'GetImageSize':assert.equal(port,2);value=input(a.image);break;
      case 'MathExpression|pysssss':{
        const vars=Object.fromEntries(Object.entries(a).filter(([k])=>k!=='expression').map(([k,v])=>[k,input(v)]));
        value=new Function('floor',...Object.keys(vars),'return ('+a.expression+');')(Math.floor,...Object.values(vars));
        if(port===0)value=Math.trunc(value);break;
      }
      default:throw Error('Unexpected class in frame-count path: '+n.class_type);
    }
    memo.set(key,value);return value;
  }
  return {input,output};
}
for(let frames=6;frames<=362;frames++){
  const s=source(frames),p=turbo8TemporalPlan(s),g=build(s);
  const expected=[referenceMath(321,frames)];
  if(frames>referenceMath(300,frames))expected.push(referenceMath(332,frames));
  if(frames>referenceMath(301,frames))expected.push(referenceMath(342,frames));
  assert.deepEqual(p.segments.map(s=>s.frames),expected);
  assert.equal(expected.reduce((a,b)=>a+b,0),frames);
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,expected.length);
  assert.ok(!Object.values(g).some(n=>['LazySwitchKJ','WidgetToString','easy compare'].includes(n.class_type)));
  for(const node of Object.values(g))for(const value of Object.values(node.inputs))if(isLink(value))assert.ok(g[value[0]]);
  const batches=batchTools(g,frames);
  assert.equal(batches.input(g['493'].inputs.images),frames,'Every source frame delivered once');
  assert.equal(batches.input(g['5108'].inputs['images or video_path']),3);
  assert.equal(batches.input(g['5104'].inputs.batch_index),Math.floor((frames-1)/2));
  assert.equal(batches.input(g['5105'].inputs.batch_index),frames-1);
  assert.equal(g['40'].inputs.sampler_name,'er_sde');assert.equal(g['41'].inputs.steps,8);
  assert.equal(g['41'].inputs.scheduler,'normal');assert.equal(g['6'].inputs.file_name,models.turboLoraFile);
  assert.equal(g['6'].inputs.strength_clip,0);assert.equal(g['87'].inputs.string_a,byId.get('87').widgets_values_named.string_a);
  for(const part of p.segments){
    assert.equal(g[part.seedNode].inputs.expression,String(byId.get(part.noiseNode).widgets_values_named.noise_seed));
    assert.deepEqual(g[part.noiseNode].inputs.noise_seed,[part.seedNode,0]);
  }
  assert.deepEqual(turbo8SeedNodeInfo(s).map(x=>x.nodeId),p.segments.map(x=>x.seedNode));
}
assert.deepEqual(turbo8TemporalPlan(source(361)).segments.map(s=>s.frames),[124,119,118]);
for(const [w,h] of [[1920,1080],[1080,1920],[1080,1080],[1080,1936]])for(const audio of [true,false]){
  const s=source(48,audio,w,h),g=build(s),plan=turbo8ExecutionPlan(s);
  assert.deepEqual(plan.output,[s.outputWidth,s.outputHeight]);assert.equal(plan.revision,TURBO8_REVISION);
  assert.equal(plan.visualAcceptance,'pending_owner_test');assert.equal(plan.postDecodeResize,false);
  for(const node of Object.values(g)){
    if(node.class_type==='ImageCrop')assert.deepEqual([node.inputs.width,node.inputs.height],[s.outputWidth,s.outputHeight]);
    if(!audio)assert.ok(!['VHS_LoadAudioUpload','MiniMaxH3AddGuide'].includes(node.class_type));
    if(node.class_type==='VHS_VideoCombine')assert.equal(!!node.inputs.audio,audio);
  }
  assert.equal(h3NodeClass('5108',plan),'CompressImages');assert.equal(h3NodeClass('1133',plan),null);
}
assert.equal(turbo8TemporalPlan(source(363)).segments.length,4);
assert.throws(()=>build(source(5)),/0,25/);
const editor=turbo8EditorWorkflow(models),editorNodes=new Map(editor.nodes.map(n=>[n.id,n]));
for(const edge of editor.links){
  const [id,from,out,to,slot]=edge;
  assert.ok(editorNodes.get(from)?.outputs[out]?.links.includes(id));
  assert.equal(editorNodes.get(to)?.inputs[slot]?.link,id);
}
assert.equal(editorNodes.get(6).type,'RHLoraLoader');
assert.equal(editorNodes.get(6).widgets_values_named.file_name,models.turboLoraFile);
assert.equal(editor.extra.vanta_export.source_revision,TURBO8_REVISION);
assert.equal(editorNodes.get(41).widgets_values_named.steps,8);
assert.ok(editorNodes.has(5108));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'turbo8-receipt-'));
try{
  let calls=0;
  const cache=createH3AppearanceModel({dir:tmp,registryFile:path.join(tmp,'receipts.json'),asset:TURBO8_ASSET,
    request:async()=>{calls++;throw Error('Web reuse must not upload or create a job');}});
  assert.equal(cache.cachedFile(),models.turboLoraFile);
  assert.equal(await cache.ensure('rhweb:'+'a'.repeat(64)),models.turboLoraFile);assert.equal(calls,0);
  assert.ok(!fs.readFileSync(path.join(tmp,'receipts.json'),'utf8').includes('rhweb:'));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const app=express();installAkatzEditorDownload({app,getModelFiles:()=>models,
  buildWorkflow:turbo8EditorWorkflow,filename:TURBO8_EDITOR_FILENAME});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub');
  assert.equal(r.status,200);assert.ok(r.headers.get('content-disposition').includes(TURBO8_EDITOR_FILENAME));
  assert.equal((await r.json()).extra.vanta_export.source_revision,TURBO8_REVISION);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('PASS: Turbo8 template parity across 357 durations; complete frame export; actual-output PNG indices; silent/audio and four ratios; typed unchanged seeds; RH receipt reuse; editor link/HTTP export. No GPU or provider inference.');
