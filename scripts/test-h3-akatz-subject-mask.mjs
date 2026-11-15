import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {turbo8GraphForInputs,turbo8TemporalPlan,turbo8ExecutionPlan,turbo8EditorForFrames,TURBO8_ASSET,TURBO8_EDITOR_FILENAME} from '../h3-akatz-turbo8.js';
import {parseAkatzOptions} from '../h3-akatz-expression.js';
import {AKATZ_SUBJECT_MASK_REVISION,AKATZ_SUBJECT_MASK_FILENAME,AKATZ_SUBJECT_MASK_SCHEMAS,akatzSubjectMaskEditorSchemas} from '../h3-akatz-subject-mask.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {createGenerationQueue} from '../generation-queue.js';

const models={characterLoraFile:'api-lora-usa/'+'0'.repeat(32)+'.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const build=source=>turbo8GraphForInputs({...models,source,imageName:'photo.png',videoName:'video.mp4'});
const sha=g=>crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex');
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const schemas={...JSON.parse(fs.readFileSync(new URL('../workflows/runninghub-akatz-node-schemas.json',import.meta.url))),...akatzSubjectMaskEditorSchemas()};
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const old=fixture('akatz-face-control-baselines.json');
assert.equal(old.sourceCommit,'30137fae3a0e9a05b266089f00d566378e44e12b');
for(const c of old.cases){
  const s={...h3PhotoPlan(c.width,c.height),fps:24,totalFrames:c.frames,hasAudio:c.audio,akatzExpression:true,akatzFaceControl:true};
  assert.equal(sha(build(s)),c.sha256,'Previous ControlNet graph must remain byte-identical');
}

// Follow the actual graph's frame slices, repeats and joins. In particular,
// full base windows can have a redundant padding frame that VAE must not see.
function frameResolver(g,count){
  const cache=new Map();
  const value=v=>{
    assert.ok(edge(v));const key=v.join(':');if(cache.has(key))return cache.get(key);
    const n=g[v[0]],a=n.inputs;let frames;
    if(n.class_type==='VHS_LoadVideo')frames=Array.from({length:Math.min(a.frame_load_cap||count,count-a.skip_first_frames)},(_,i)=>a.skip_first_frames+i);
    else if(n.class_type==='ImageFromBatch')frames=value(a.image).slice(a.batch_index,a.batch_index+a.length);
    else if(n.class_type==='ImageBatch')frames=[...value(a.image1),...value(a.image2)];
    else if(n.class_type==='RepeatImageBatch')frames=Array.from({length:a.amount},()=>value(a.image)).flat();
    else if(n.class_type==='ImageResizeKJv2')frames=value(a.image);
    else throw Error('Unexpected source frame node '+n.class_type);
    cache.set(key,frames);return frames;
  };
  return value;
}

for(const frames of [6,7,22,49,123,124,125,242,243,244,245,362,363,463,1464,2401])
for(const audio of [false,true])for(const [width,height] of [[1080,1920],[1920,1080],[1080,1080]]){
  const base={...h3PhotoPlan(width,height),fps:24,totalFrames:frames,hasAudio:audio};
  const original=build(base),source={...base,akatzSubjectMask:true},g=build(source),p=turbo8TemporalPlan(source);
  const plan=turbo8ExecutionPlan(source),value=frameResolver(g,frames);
  assert.equal(plan.revision,AKATZ_SUBJECT_MASK_REVISION);assert.equal(plan.applicationMaxSeconds,null);
  assert.equal(plan.samplerCount,p.segments.length);assert.equal(plan.subjectMask.postOutputRefinement,false);
  assert.equal(plan.subjectMask.hardPerFrameFacialControl,false);
  assert.ok(!plan.expressionControl);
  assert.equal(Object.values(g).filter(n=>n.class_type==='SAM3_VideoTrack').length,p.segments.length);
  assert.equal(Object.values(g).filter(n=>n.class_type==='LTXVConcatAVLatent').length,p.segments.length);
  assert.ok(!Object.values(g).some(n=>/LivePortrait|Canny|FunControlNet|RIFE|H3Relay/.test(n.class_type)));
  for(const s of p.segments){
    const sampler=g[s.base+11],ref=g[s.base+5];
    assert.deepEqual(ref,original[s.base+5],'Keep photo and raw RGB video reference paths intact');
    const av=g[sampler.inputs.latent_image[0]];
    assert.equal(av.class_type,'LTXVConcatAVLatent');assert.equal(av.inputs.audio_latent[1],1);
    const split=g[av.inputs.audio_latent[0]];assert.equal(split.class_type,'LTXVSeparateAVLatent');
    assert.deepEqual(split.inputs.av_latent,[String(s.base+5),1]);
    const setter=g[av.inputs.video_latent[0]];assert.equal(setter.class_type,'LTXVSetVideoLatentNoiseMasks');
    const encoded=g[setter.inputs.samples[0]];assert.equal(encoded.class_type,'VAEEncode');assert.deepEqual(encoded.inputs.vae,['3',0]);
    const canvas=g[encoded.inputs.pixels[0]];assert.equal(canvas.class_type,'ImageResizeKJv2');
    assert.equal(canvas.inputs.width,base.canvasWidth);assert.equal(canvas.inputs.height,base.canvasHeight);
    assert.equal(canvas.inputs.keep_proportion,'pad');assert.equal(canvas.inputs.upscale_method,'lanczos');
    const reduced=g[setter.inputs.masks[0]];assert.equal(reduced.class_type,'MVEx_MaskToLatentSpace');
    assert.equal(reduced.inputs.compression,'auto','Dynamic combo API selection is a flat key');
    assert.deepEqual(reduced.inputs.vae,encoded.inputs.vae);assert.equal(reduced.inputs.temporal_method,'max');
    assert.equal(reduced.inputs.spatial_method,'max');assert.equal(reduced.inputs.grow_temporal,0);
    const grow=g[reduced.inputs.masks[0]];assert.equal(grow.class_type,'GrowMask');assert.equal(grow.inputs.expand,64);
    const checked=g[grow.inputs.mask[0]];assert.equal(checked.class_type,'SAM3_ValidateMask');
    assert.equal(checked.inputs.max_ratio,1,'Full-canvas close-ups must be permitted');assert.ok(checked.inputs.min_ratio>0);
    const masks=g[checked.inputs.mask[0]],track=g[masks.inputs.track_data[0]];
    assert.equal(track.class_type,'SAM3_VideoTrack');assert.equal(track.inputs.max_objects,1);
    assert.deepEqual(track.inputs.images,encoded.inputs.pixels,'Mask and source VAE must see exactly the same canvas and frame batch');
    const actual=value(encoded.inputs.pixels);
    assert.equal(actual.length,124,'Every source VAE input must match target H3 length, including full windows');
    assert.deepEqual(actual.slice(0,s.inputFrames),Array.from({length:s.inputFrames},(_,i)=>s.loadStart+i));
    assert.ok(actual.slice(s.inputFrames).every(f=>f===s.loadStart+s.inputFrames-1),'Only the final source frame is repeated for padding');
  }
  // Exactly the sampler latent_image changes on pre-existing nodes. This
  // guards native output/audio/archive, raw history, first-frame guides, model,
  // prompt, seed and scheduler against accidental candidate-specific changes.
  for(const [id,node] of Object.entries(original)){
    const expected=structuredClone(g[id]);assert.ok(expected);
    if(node.class_type==='SamplerCustomAdvanced')expected.inputs.latent_image=node.inputs.latent_image;
    assert.deepEqual(expected,node,'Unrelated baseline node changed: '+id);
  }
  for(const [id,n] of Object.entries(g)){
    assert.equal(h3NodeClass(id,plan),n.class_type,'Progress metadata must identify actual new nodes');
    const schema=schemas[n.class_type];assert.ok(schema,'Missing schema '+n.class_type);
    for(const [key,v] of Object.entries(n.inputs))if(edge(v)){
      assert.ok(g[v[0]],'Dangling edge '+id+'.'+key);
      const output=schemas[g[v[0]].class_type]?.outputs[v[1]],input=schema.inputs.find(i=>i.name===key);
      assert.ok(output&&input,'Unknown port '+id+'.'+key);
      assert.ok(input.type==='*'||output.type==='*'||input.type===output.type||input.type.split(',').includes(output.type),'Type mismatch '+id+'.'+key);
    }
    const raw=AKATZ_SUBJECT_MASK_SCHEMAS[n.class_type];
    if(raw)for(const [key,spec] of Object.entries(raw.input.required||{})){
      assert.ok(Object.hasOwn(n.inputs,key),'Missing required input '+id+'.'+key);
      if(edge(n.inputs[key]))continue;
      const [type,c={}] =spec,v=n.inputs[key];
      const choices=Array.isArray(type)?type:type==='COMBO'?c.options:type==='COMFY_DYNAMICCOMBO_V3'?c.options.map(x=>x.key):null;
      if(choices?.length)assert.ok(choices.includes(v),'Invalid widget choice '+id+'.'+key);
      if(type==='INT')assert.ok(Number.isSafeInteger(v));
      if(typeof v==='number'){if(c.min!==undefined)assert.ok(v>=c.min);if(c.max!==undefined)assert.ok(v<=c.max);}
    }
  }
  assert.equal(g['490'].inputs.frame_rate,24);
}

for(const frames of [6,124,125,244,363,463,1464,2401]){
  const editor=turbo8EditorForFrames({...models,frames,akatzSubjectMask:true}),nodes=new Map(editor.nodes.map(n=>[n.id,n]));
  assert.equal(nodes.size,editor.nodes.length);assert.equal(editor.extra.vanta_export.source_revision,AKATZ_SUBJECT_MASK_REVISION);
  for(const l of editor.links){assert.ok(nodes.get(l[1]).outputs[l[2]].links.includes(l[0]));assert.equal(nodes.get(l[3]).inputs[l[4]].link,l[0]);}
  const reduce=editor.nodes.find(n=>n.type==='MVEx_MaskToLatentSpace');
  assert.equal(reduce.widgets_values_named.compression,'auto');
  assert.equal(reduce.widgets_values[akatzSubjectMaskEditorSchemas().MVEx_MaskToLatentSpace.widgetOrder.indexOf('compression')],'auto');
}
for(const options of [{akatzSubjectMask:'yes'},{akatzSubjectMask:['true']},{akatzSubjectMask:'true',akatzExpression:'true'},
  {akatzSubjectMask:'true',akatzExpression:'true',akatzFaceControl:'true'}])assert.throws(()=>parseAkatzOptions('minimaxH3Akatz',options));
assert.throws(()=>parseAkatzOptions('current',{akatzSubjectMask:'true'}));
assert.equal(parseAkatzOptions('minimaxH3Akatz',{akatzSubjectMask:'true'}).akatzSubjectMask,true);
assert.equal(parseAkatzOptions('minimaxH3Akatz').akatzSubjectMask,false,'Old requests remain baseline');

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-subject-mask-'));let server;
try{
  const photo=path.join(folder,'photo.png'),video=path.join(folder,'video.mp4');fs.writeFileSync(photo,'fixture');fs.writeFileSync(video,'fixture');
  const id=crypto.randomUUID(),queue=createGenerationQueue({dir:folder});
  await queue.stage({jobId:id,deviceId:'01234567890123456789012345678901',body:{workflow:'minimaxH3Akatz',mode:'plus',akatzSubjectMask:'true',akatzExpression:'false',akatzFaceControl:'false'},
    image:{path:photo,mimetype:'image/png'},video:{path:video,mimetype:'video/mp4'}});
  assert.equal(createGenerationQueue({dir:folder}).read(id).body.akatzSubjectMask,'true');
  const app=express();installAkatzEditorDownload({app,getModelFiles:()=>models,
    buildWorkflow:(m,req)=>turbo8EditorForFrames({...m,frames:463,...parseAkatzOptions('minimaxH3Akatz',req.query)}),
    filename:req=>parseAkatzOptions('minimaxH3Akatz',req.query).akatzSubjectMask?AKATZ_SUBJECT_MASK_FILENAME:TURBO8_EDITOR_FILENAME});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub?akatzSubjectMask=true');
  assert.equal(response.status,200);assert.ok(response.headers.get('content-disposition').includes(AKATZ_SUBJECT_MASK_FILENAME));
  assert.equal((await response.json()).extra.vanta_export.source_revision,AKATZ_SUBJECT_MASK_REVISION);
}finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});}

// Run the actual form handlers to catch restored-browser choices disagreeing
// with stale state. Generate and Download must carry the same selected mode.
const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(html,/<option value="baseline" selected>Versi dasar Akatz/);
assert.match(html,/<option value="mask">Mask subjek/);
const helper=js.slice(js.indexOf('function readAkatzMode(){'),js.indexOf("$('#akatzExpression')?.addEventListener"));
const generate=js.slice(js.indexOf('async function generate(){'),js.indexOf('\nfunction showTask('));
const download=js.slice(js.indexOf("document.querySelector('.akatz-editor-download')"),js.indexOf('\nfunction initDropzone('));
let listener,query,form,filename;const nodes=new Map();
const $=s=>{if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',querySelector:()=>null});return nodes.get(s);};
const link={href:'https://vanta.example/api/workflows/minimaxH3Akatz/runninghub?akatzSubjectMask=true',download:AKATZ_SUBJECT_MASK_FILENAME,getAttribute:()=>null,setAttribute:()=>{},removeAttribute:()=>{}};
const state={workflow:'minimaxH3Akatz',mode:'plus',image:new Blob(['photo']),video:new Blob(['video']),accounts:[{canGenerate:true}]};
const context={state,$,FormData,Blob,URL,crypto,ACTIVE_UPLOAD_KEY:'fixture',location:{href:'https://vanta.example/'},
  localStorage:{setItem:()=>{}},showStartingTask:()=>{},startVisibleTimer:()=>{},toast:()=>{},
  uploadReferences:async fd=>{form=fd;return {jobId:'fixture'};},trackSubmission:()=>{},
  fetch:async url=>{query=new URL(url);return {ok:true,json:async()=>({nodes:[],links:[]})};},setTimeout:fn=>fn(),
  document:{querySelector:()=>({addEventListener:(_,fn)=>listener=fn}),body:{append:()=>{}},
    createElement:()=>({click(){filename=this.download;},remove:()=>{}})}};
vm.createContext(context);vm.runInContext(helper+generate+download,context);
for(const [mode,enabled] of [['mask',true],['baseline',false],['expression',false],['controlnet',false]]){
  $('#akatzExpression').value=mode;state.submission=null;state.akatzSubjectMask=!enabled;
  await context.generate();assert.equal(form.get('akatzSubjectMask'),String(enabled));
  if(enabled){assert.equal(form.get('akatzExpression'),'false');assert.equal(form.get('akatzFaceControl'),'false');}
  state.akatzSubjectMask=!enabled;await listener({preventDefault:()=>{},currentTarget:link});
  assert.equal(query.searchParams.get('akatzSubjectMask'),String(enabled));
  if(enabled)assert.equal(filename,AKATZ_SUBJECT_MASK_FILENAME);
  if(mode==='baseline')assert.equal(filename,TURBO8_EDITOR_FILENAME);
}
console.log('PASS: 60 unchanged ControlNet payloads; H3 source/mask window and canvas alignment; correct native AV ports and schemas; unchanged model/reference/history/output paths; adaptive duration, editor, queue and real client mode transport. No GPU inference or visual qualification.');
