import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import express from 'express';
import {h3PhotoPlan,validateH3Probe,probeH3Input} from '../minimax-h3-motion.js';
import {prepareTurbo8Input} from '../h3-akatz-turbo8-adaptive.js';
import {turbo8TemporalPlan,turbo8GraphForInputs,turbo8SeedNodeInfo,turbo8EditorForFrames,turbo8ExecutionPlan,TURBO8_ASSET,TURBO8_LEGACY_REVISION,TURBO8_ADAPTIVE_REVISION,TURBO8_EDITOR_FILENAME} from '../h3-akatz-turbo8.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
const models={characterLoraFile:'api-lora-usa/55c5bb53f1104e3cd4fed7fbe5d522d7.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const source=(n,audio=true,w=1080,h=1920)=>({...h3PhotoPlan(w,h),fps:24,totalFrames:n,hasAudio:audio});
const build=s=>turbo8GraphForInputs({...models,source:s,imageName:'photo.png',videoName:'guide.mp4'});
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1]);

// Simulate timeline IDs through the actual graph. This checks trimming/join
// order and diagnostics, not the visual pixels produced by a neural sampler.
function timeline(g,n){
  const cache=new Map(),input=v=>edge(v)?output(v[0],v[1]):v;
  function output(id,slot=0){
    const key=id+':'+slot;if(cache.has(key))return cache.get(key);
    const node=g[id],a=node.inputs;let result;
    switch(node.class_type){
      case 'VHS_LoadVideo':{
        const start=a.skip_first_frames||0,len=a.frame_load_cap||n;
        result=Array.from({length:Math.min(len,n-start)},(_,i)=>start+i);break;
      }
      case 'ImageFromBatch':result=input(a.image).slice(input(a.batch_index),input(a.batch_index)+input(a.length));break;
      case 'RepeatImageBatch':result=Array.from({length:input(a.amount)},()=>input(a.image)).flat();break;
      case 'ImageBatch':result=[...input(a.image1),...input(a.image2)];break;
      case 'ImageCrop':result=input(a.image);break;
      case 'MiniMaxH3ReferenceToVideo':result=input(a['ref_videos.ref_video_1']).slice(0,a.length);break;
      case 'SamplerCustomAdvanced':result=input(a.latent_image);break;
      case 'LTXVSeparateAVLatent':result=input(a.av_latent);break;
      case 'VAEDecode':result=input(a.samples);break;
      case 'GetImageSize':assert.equal(slot,2);result=input(a.image).length;break;
      case 'MathExpression|pysssss':{
        const keys=Object.keys(a).filter(k=>k!=='expression');
        result=new Function('floor',...keys,'return '+a.expression)(Math.floor,...keys.map(k=>input(a[k])));break;
      }
      case 'RIFEInterpolation':{
        const frames=input(a.images),count=Math.floor(frames.length/a.source_fps*a.target_fps);
        result=Array.from({length:count},(_,i)=>Math.min(i/a.target_fps*a.source_fps,frames.length-1));break;
      }
      default:throw Error('Unexpected timeline class '+node.class_type);
    }
    cache.set(key,result);return result;
  }
  return {input,output};
}
const cases=new Set([6,49,361,362,363,384,480,720,1440,1441,1464,2401,7201,14401]);
for(let i=0;i<12;i++)for(const d of [-1,0,1])cases.add(124+119*i+d);
for(const n of cases)for(const audio of [true,false]){
  const s=source(n,audio),p=turbo8TemporalPlan(s),g=build(s);
  assert.equal(p.window,124);assert.equal(p.segments.reduce((a,b)=>a+b.frames,0),n);
  assert.equal(Object.values(g).filter(x=>x.class_type==='SamplerCustomAdvanced').length,p.segments.length);
  assert.deepEqual(Object.entries(g).filter(([,x])=>x.class_type==='MiniMaxH3AddGuide'&&x.inputs.image).map(([id])=>id),['1008'],
    'Only the first segment uses the edited image pose; continuation never resets it');
  assert.deepEqual(g['1010'].inputs.positive,['1008',0]);
  assert.deepEqual(g['1008'].inputs.image,['32',0]);assert.equal(!!g['1008'].inputs.audio,audio);
  if(!audio)assert.equal(g['1008'].inputs.audio_vae,undefined);
  let delivered=0;
  for(const [i,part] of p.segments.entries()){
    assert.equal(part.start,delivered);delivered+=part.frames;assert.ok(part.inputFrames<=124);
    assert.equal(part.contextFrames,i?5:0);
    if(n>362){
      const load=g[part.base];assert.equal(load.class_type,'VHS_LoadVideo');
      assert.equal(load.inputs.frame_load_cap,part.inputFrames);assert.equal(load.inputs.skip_first_frames,part.loadStart);
      if(i)assert.deepEqual(g[part.base+7].inputs.context_latent,[String(p.segments[i-1].base+11),0]);
    }
    if(i<p.segments.length-1)assert.equal(part.inputFrames,124,'Never relay a padded final latent into another window');
    assert.equal(g[part.seedNode].inputs.expression,String(part.seed));
    assert.deepEqual(g[part.noiseNode].inputs.noise_seed,[part.seedNode,0]);
    if(audio){
      assert.equal(g[part.base+4].inputs.start_time,part.loadStart/24);
      if(i)assert.equal(g[part.base+17].inputs.start_time,part.start/24);
    }
  }
  assert.equal(turbo8SeedNodeInfo(s).length,p.segments.length);
  for(const [id,node] of Object.entries(g))for(const v of Object.values(node.inputs))if(edge(v))assert.ok(g[v[0]],id+' dangling '+v[0]);
  if(audio)assert.equal(g['50'].inputs.duration,n/24);else assert.ok(!Object.values(g).some(x=>x.class_type==='VHS_LoadAudioUpload'));
  const frames=timeline(g,n).input(g['490'].inputs.images);
  assert.deepEqual(frames,Array.from({length:n},(_,i)=>i),'No missing, duplicated history, padding, reordered or black-tail timeline frames');
  const out=timeline(g,n),batch=out.input(g['490'].inputs.images);
  assert.equal(batch.length,n);assert.equal(g['490'].inputs.frame_rate,24);
  assert.equal(Object.values(g).filter(x=>x.class_type==='RIFEInterpolation').length,0);
  const pngs=out.input(g['5108'].inputs['images or video_path']);
  assert.deepEqual(pngs,[batch[0],batch[Math.floor((batch.length-1)/2)],batch.at(-1)]);
}
for(const n of [0,5,NaN,Infinity,2**53])assert.throws(()=>turbo8TemporalPlan(source(n)));
const legacy={revision:TURBO8_LEGACY_REVISION,nodeClasses:{760060:'RIFEInterpolation'}};
assert.equal(h3NodeClass('760060',legacy),'RIFEInterpolation','Old running jobs stay observable');
assert.equal(h3NodeClass('1011',{revision:TURBO8_ADAPTIVE_REVISION,nodeClasses:{1011:'SamplerCustomAdvanced'}}),
  'SamplerCustomAdvanced','Jobs from the previous adaptive revision stay observable');

for(const n of [49,363,482,720,1464]){
  const editor=turbo8EditorForFrames({...models,frames:n});
  const nodes=new Map(editor.nodes.map(x=>[x.id,x])),links=new Map(editor.links.map(x=>[x[0],x]));
  assert.equal(nodes.size,editor.nodes.length);
  for(const [name,from] of [['image',32],['vae',3]]){
    const input=nodes.get(1008).inputs.find(x=>x.name===name);
    assert.equal(links.get(input.link)[1],from,'Compiled editor retains the first-frame guide: '+name);
  }
  assert.equal(editor.extra.vanta_export.first_frame_guide.frameIndex,0);
  for(const l of editor.links){assert.ok(nodes.get(l[1]).outputs[l[2]].links.includes(l[0]));assert.equal(nodes.get(l[3]).inputs[l[4]].link,l[0]);}
  for(const node of editor.nodes){
    for(const input of node.inputs)if(input.link!=null)assert.ok(links.has(input.link));
    for(const output of node.outputs)for(const l of output.links||[])assert.ok(links.has(l));
    if(node.type==='VHS_LoadVideo'&&node.id!==1000)assert.equal(links.get(node.inputs.find(x=>x.name==='video').link)[1],200);
    if(node.type==='VHS_LoadAudioUpload')assert.equal(links.get(node.inputs.find(x=>x.name==='audio').link)[1],200);
  }
  assert.equal(editor.extra.vanta_export.preset_frames,n);
  assert.equal(editor.nodes.filter(x=>x.type==='RIFEInterpolation').length,0);
  for(const node of editor.nodes.filter(x=>x.type==='VHS_VideoCombine'))assert.equal(node.widgets_values_named.frame_rate,24);
  assert.equal(editor.nodes.filter(x=>x.type==='SamplerCustomAdvanced').length,turbo8TemporalPlan(source(n)).segments.length);
}
const probe={streams:[{codec_type:'video',width:96,height:64,duration:61}],format:{duration:61}};
assert.throws(()=>validateH3Probe(probe,'plus'),/60/,'Other H3 profiles retain their current limit');
assert.equal(validateH3Probe(probe,'plus',{maxSeconds:null}).totalFrames,1464);
assert.throws(()=>validateH3Probe(probe,'standard',{maxSeconds:null}),/Plus/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-adaptive-duration-'));
try{
  const video=path.join(dir,'long.mp4'),photo=path.join(dir,'photo.png');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=24',
    '-f','lavfi','-i','sine=frequency=330:sample_rate=16000','-t','61','-c:v','libx264','-preset','ultrafast',
    '-pix_fmt','yuv420p','-c:a','aac','-threads','2',video],{timeout:60000});
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=96x64','-frames:v','1','-threads','1',photo],{timeout:30000});
  const file={path:video,originalname:'long.mp4',mimetype:'video/mp4'};
  await assert.rejects(probeH3Input(file,'plus'),/60/);
  const prepared=await prepareTurbo8Input(file,'plus',{path:photo,originalname:'photo.png',mimetype:'image/png',size:fs.statSync(photo).size});
  try{
    assert.equal(prepared.totalFrames,1464);assert.equal(prepared.hasAudio,true);assert.deepEqual(prepared.driverCanvas,[96,64]);
    const plan=turbo8ExecutionPlan(prepared);
    assert.equal(plan.frames,1464);assert.equal(plan.fps,24);
    assert.equal(plan.interpolation,undefined);
    assert.ok(!Object.values(plan.nodeClasses).includes('RIFEInterpolation'));
    assert.ok(prepared.release);assert.equal(prepared.sceneCuts.length,0);
  }finally{await prepared.release();}
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const app=express();
installAkatzEditorDownload({app,getModelFiles:()=>models,buildWorkflow:(m,req)=>turbo8EditorForFrames({...m,frames:Number(req.query.frames)||360}),filename:TURBO8_EDITOR_FILENAME});
const server=app.listen(0,'127.0.0.1');
try{
  await new Promise(resolve=>server.on('listening',resolve));
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub?frames=1464');
  assert.equal(r.status,200);assert.ok(r.headers.get('content-disposition').includes(TURBO8_EDITOR_FILENAME));
  const g=await r.json();assert.equal(g.extra.vanta_export.preset_frames,1464);
  assert.equal(g.nodes.filter(n=>n.type==='RIFEInterpolation').length,0);
  for(const node of g.nodes.filter(n=>n.type==='VHS_VideoCombine'))assert.equal(node.widgets_values_named.frame_rate,24);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('PASS: adaptive Akatz native 24 FPS rollback; ordered complete timelines, raw context/audio, native PNGs and no RIFE; duration-matched editor wiring/HTTP; real 61s media preparation. No GPU inference.');
