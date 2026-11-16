import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {REMAKE_REVISION,REMAKE_COMMIT,REMAKE_RECIPE,prepareRemakeInput,remakeTemporalPlan,remakeGraphForInputs,remakeExecutionPlan,remakeEditorForFrames,REMAKE_EDITOR_FILENAME} from '../h3-akatz-remake.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {parseAkatzOptions} from '../h3-akatz-options.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {createGenerationQueue} from '../generation-queue.js';

const pinned=JSON.parse(fs.readFileSync(new URL('../workflows/akatz-remake-source-recipe.json',import.meta.url)));
assert.equal(REMAKE_RECIPE.model,pinned.model);assert.equal(REMAKE_RECIPE.lora,pinned.lora);
assert.equal(REMAKE_RECIPE.loraSha256,pinned.lora_sha256);assert.equal(REMAKE_RECIPE.steps,pinned.steps);
assert.equal(REMAKE_RECIPE.sampler,pinned.sampler);assert.deepEqual(REMAKE_RECIPE.sigmas,pinned.sigmas);
assert.equal(REMAKE_RECIPE.keyframeUntil,pinned.keyframe_until);assert.equal(REMAKE_RECIPE.history,pinned.history_frames);
const schema=JSON.parse(fs.readFileSync(new URL('../workflows/runninghub-akatz-remake-schemas.json',import.meta.url))).nodes;
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1]);
let cases=0;
for(const [width,height] of [[1080,1920],[1920,1080],[1080,1080],[1143,2048]])
for(const frames of [6,22,49,123,124,125,230,231,360,362,463,482,2401])
for(const hasAudio of [true,false]){
  const source={...h3PhotoPlan(width,height),totalFrames:frames,fps:24,hasAudio,akatzRecipe:'remake'};
  const plan=remakeTemporalPlan(source),g=remakeGraphForInputs({imageName:'photo.png',videoName:'video.mp4',source});
  assert.equal(plan.segments.reduce((sum,s)=>sum+s.delivered,0),frames);
  assert.equal(g['1'].inputs.unet_name,REMAKE_RECIPE.model);
  assert.equal(g['6'].inputs.strength_model,0);assert.equal(g['6'].inputs.strength_clip,0);
  assert.equal(g['6'].inputs.Download_url,REMAKE_RECIPE.loraUrl);
  assert.deepEqual(g['7'].inputs.model,['6',0]);assert.deepEqual(g['7'].inputs.lora_name,['8',0]);
  assert.deepEqual(g['8'].inputs.value0,['9',0]);assert.equal(g['9'].inputs.value,g['6'].inputs.Lora_url_name);
  assert.equal(g['7'].class_type,'LoraLoaderBypassModelOnly');assert.equal(g['7'].inputs.strength_model,1);
  assert.equal(g['40'].inputs.sampler_name,'euler');
  assert.deepEqual(g['41'].inputs.sigmas.split(',').map(Number),REMAKE_RECIPE.sigmas);
  assert.equal(g['42'].inputs.value,Math.min(source.canvasWidth,source.canvasHeight));
  for(const [i,s] of plan.segments.entries()){
    assert.equal(s.start,i?plan.segments[i-1].end:0);
    assert.equal((s.modelFrames-5)%17,0);assert.ok(s.modelFrames<=124);
    assert.equal(s.loadStart,s.start-s.history);assert.equal(s.inputFrames,s.delivered+s.history);
    assert.equal(s.inputFrames+s.paddedTail,s.modelFrames);
    const b=s.base,cond=g[b+5],trim=g[b+11];
    assert.equal(cond.class_type,'RemakeConditioning');assert.equal(cond.inputs.pins,'');
    assert.deepEqual(cond.inputs.ref_1,['30',0]);assert.deepEqual(cond.inputs.short_edge,['42',0]);
    assert.deepEqual(cond.inputs.frames,[String(b+4),0]);assert.equal(g[b+4].inputs.value,s.modelFrames);
    assert.equal(trim.inputs.batch_index,s.history);assert.equal(trim.inputs.length,s.delivered);
    if(s.history){
      assert.equal(s.history,18);assert.equal(g[b+20].inputs.batch_index,plan.segments[i-1].delivered-18);
      assert.equal(g[b+21].inputs.length,17);assert.equal(g[b+22].inputs.batch_index,16);
      assert.equal(g[b+23].inputs.amount,5);assert.equal(g[b+26].inputs.amount,5);
      assert.equal(g[b+30].inputs.index,5);assert.equal(g[b+30].inputs.amount,s.latentFrames-5);
      assert.equal(g[b+34].inputs.amount,5);assert.equal(g[b+35].inputs.value,1);
      assert.equal(g[b+45].inputs.frame_idx,17);assert.deepEqual(g[b+43].inputs.audio_latent,[String(b+27),1]);
    }else assert.equal(g[b+45],undefined,'The character is an appearance reference; no automatic frame-zero guide');
    assert.equal(Boolean(cond.inputs.audio),hasAudio);
  }
  const seen=new Set(),visiting=new Set();
  function visit(id){
    if(seen.has(id))return;assert.ok(!visiting.has(id),'acyclic dependency graph');visiting.add(id);
    const n=g[id],d=schema[n.class_type];assert.ok(d,'Class declared in fresh RunningHub registry: '+n.class_type);
    for(const key of Object.keys(d.input.required||{}))assert.ok(Object.hasOwn(n.inputs,key),id+'.'+key);
    for(const [key,v] of Object.entries(n.inputs))if(edge(v)){
      const src=g[v[0]];assert.ok(src,id+'.'+key);assert.ok(v[1]<schema[src.class_type].output.length);
      visit(v[0]);
    }
    visiting.delete(id);seen.add(id);
  }
  for(const id of ['490','493','496','5108'])visit(id);
  assert.equal(seen.size,Object.keys(g).length,'Every generated node is used');
  assert.ok(!Object.values(g).some(n=>/RHLoraLoader|SAM3|ControlNet|LivePortrait|RIFE|MiniMaxH3ReferenceToVideo|RandomNoise|CFGGuider/.test(n.class_type)));
  assert.equal(g['490'].inputs.frame_rate,24);assert.equal(g['490'].inputs.trim_to_audio,false);
  assert.equal(Boolean(g['490'].inputs.audio),hasAudio);assert.equal(g['50']!==undefined,hasAudio);
  assert.deepEqual(g['5104'].inputs.image,g['490'].inputs.images);assert.equal(g['5104'].inputs.batch_index,Math.floor((frames-1)/2));
  assert.equal(g['5105'].inputs.batch_index,frames-1);
  const editor=remakeEditorForFrames({frames,width,height}),byId=new Map(editor.nodes.map(n=>[String(n.id),n]));
  const audioGraph=hasAudio?g:remakeGraphForInputs({imageName:'photo.png',videoName:'video.mp4',source:{...source,hasAudio:true}});
  for(const [id,n] of Object.entries(audioGraph)){
    const ui=byId.get(id);assert.equal(ui.type,n.class_type);
    for(const [key,v] of Object.entries(n.inputs)){
      if(edge(v)){
        const port=ui.inputs.find(x=>x.name===key),l=editor.links.find(x=>x[0]===port.link);
        assert.deepEqual(l.slice(1,3),[Number(v[0]),v[1]],id+'.'+key);
      }else if(!['image','video','audio'].includes(key))assert.deepEqual(ui.widgets_values_named[key],v,id+'.'+key);
    }
  }
  assert.equal(editor.extra.vanta_export.source_commit,REMAKE_COMMIT);
  const diagnostics=remakeExecutionPlan(source);
  assert.equal(diagnostics.revision,REMAKE_REVISION);assert.equal(diagnostics.applicationMaxSeconds,null);
  assert.equal(diagnostics.workBudget.providerHardLimitSeconds,null);assert.equal(diagnostics.gpuExecutionQualified,false);
  for(const [id,n] of Object.entries(g))assert.equal(h3NodeClass(id,diagnostics),n.class_type);
  cases++;
}

for(const akatzRecipe of ['remake','turbo8'])assert.equal(parseAkatzOptions('minimaxH3Akatz',{akatzRecipe}).akatzRecipe,akatzRecipe);
for(const akatzRecipe of ['mask-v3','',{},true,['remake']])assert.throws(()=>parseAkatzOptions('minimaxH3Akatz',{akatzRecipe}));
for(const flag of ['akatzExpression','akatzFaceControl','akatzSubjectMask'])assert.throws(()=>remakeGraphForInputs({imageName:'photo.png',videoName:'video.mp4',source:{...h3PhotoPlan(1080,1920),fps:24,totalFrames:49,hasAudio:true,[flag]:true}}),{code:'AKATZ_VARIANT_RETIRED'});

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-remake-queue-'));
try{
  // Real CPU media normalization: a 4:3 source must reach the exact photo
  // canvas, avoiding the older Remake helper's 16:9 fallback branch.
  const video=path.join(dir,'driving.mp4'),photo=path.join(dir,'reference.png');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=128x96:rate=24:duration=0.25','-c:v','libx264','-pix_fmt','yuv420p',video]);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','color=gray:size=128x96','-frames:v','1',photo]);
  const input=(p,mime)=>({path:p,originalname:path.basename(p),mimetype:mime,size:fs.statSync(p).size});
  const prepared=await prepareRemakeInput(input(video,'video/mp4'),'standard',input(photo,'image/png'));
  try{
    const tracks=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',prepared.file.path],{encoding:'utf8'})).streams;
    const stream=tracks.find(s=>s.codec_type==='video');
    assert.deepEqual(prepared.driverCanvas,[prepared.canvasWidth,prepared.canvasHeight]);
    assert.deepEqual([stream.width,stream.height],[1440,1088]);assert.equal(prepared.totalFrames,6);
    assert.equal(prepared.driverEncoding.crf,12);assert.equal(prepared.hasAudio,false);
    assert.doesNotThrow(()=>remakeGraphForInputs({imageName:'photo.png',videoName:'video.mp4',source:prepared}));
    assert.throws(()=>remakeTemporalPlan({...prepared,driverCanvas:[128,96]}),/belum sejajar/);
  }finally{await prepared.release();}
  const img=path.join(dir,'photo.png'),vid=path.join(dir,'video.mp4');fs.writeFileSync(img,'photo fixture');fs.writeFileSync(vid,'video fixture');
  const queue=createGenerationQueue({dir}),id=crypto.randomUUID(),deviceId='01234567890123456789012345678901';
  await queue.stage({jobId:id,deviceId,body:{workflow:'minimaxH3Akatz',akatzRecipe:'remake',mode:'plus'},image:{path:img,originalname:'photo.png',mimetype:'image/png',size:13},video:{path:vid,originalname:'video.mp4',mimetype:'video/mp4',size:13}});
  assert.equal(createGenerationQueue({dir}).read(id).body.akatzRecipe,'remake','Selected source recipe survives durable queue/restart');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const app=express();
installAkatzEditorDownload({app,getModelFiles:()=>({characterLoraFile:null,turboLoraFile:null}),
  requiresUploadedModels:req=>req.query.akatzRecipe!=='remake',validateRequest:req=>parseAkatzOptions('minimaxH3Akatz',req.query),
  buildWorkflow:()=>remakeEditorForFrames({frames:125}),filename:REMAKE_EDITOR_FILENAME});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
  const url=`http://127.0.0.1:${server.address().port}/api/workflows/minimaxH3Akatz/runninghub`;
  const source=await fetch(url+'?akatzRecipe=remake');assert.equal(source.status,200);
  assert.match(source.headers.get('content-disposition'),/VIGGLE_REMAKE_6STEP/);
  assert.equal((await source.json()).extra.vanta_export.source_revision,REMAKE_REVISION);
  assert.equal((await fetch(url+'?akatzRecipe=turbo8')).status,503,'Baseline still requires its real uploaded model receipts');
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(`PASS: ${cases} source-recipe graphs, aligned conditioning, exact18-frame history wiring, bounded adaptive duration, editor/API parity, retired guards, queue persistence and receipt-free source export; no GPU.`);
