import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {turbo8GraphForInputs,turbo8TemporalPlan,turbo8ExecutionPlan,turbo8EditorForFrames,TURBO8_ASSET,TURBO8_EDITOR_FILENAME} from '../h3-akatz-turbo8.js';
import {parseAkatzOptions,AKATZ_EXPRESSION_FILENAME,AKATZ_EXPRESSION_SCHEMAS,akatzExpressionEditorSchemas} from '../h3-akatz-expression.js';
import {AKATZ_FACE_CONTROL_REVISION,AKATZ_FACE_CONTROL_FILENAME,AKATZ_FACE_CONTROL_PATCH,AKATZ_FACE_CONTROL_SCHEMAS} from '../h3-akatz-face-control.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {createGenerationQueue} from '../generation-queue.js';

const models={characterLoraFile:'api-lora-usa/'+'0'.repeat(32)+'.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const build=source=>turbo8GraphForInputs({...models,source,imageName:'photo.png',videoName:'video.mp4'});
const sha=g=>crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex');
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);
const raw={...AKATZ_EXPRESSION_SCHEMAS,...AKATZ_FACE_CONTROL_SCHEMAS};
const schemas={...JSON.parse(fs.readFileSync(new URL('../workflows/runninghub-akatz-node-schemas.json',import.meta.url))),...akatzExpressionEditorSchemas()};
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const roll=i=>17+12*Math.sin(i/17);
const previous=fixture('akatz-expression-v2-baselines.json');
assert.equal(previous.sourceCommit,'b88af3e44e5e5ba55735435cb7f5ca274173d02f');

// Track frame identities and coordinate spaces through real graph edges. This
// is a timeline/geometry contract, not a simulation of neural video quality.
function timeline(graph,count,sourceCanvas){
  const cache=new Map(),value=v=>edge(v)?out(v[0],v[1]):v;
  function out(id,slot=0){
    const key=id+':'+slot;if(cache.has(key))return cache.get(key);
    const n=graph[id],a=n.inputs;let r;
    switch(n.class_type){
      case 'LoadImage':r=[{frame:0,identity:'photo',valid:true,space:'photo',roll:roll(0)}];break;
      case 'VHS_LoadVideo':r=Array.from({length:Math.min(a.frame_load_cap||count,count-a.skip_first_frames)},(_,i)=>{
        const frame=i+a.skip_first_frames;return {frame,valid:frame%67!==11,space:'source',canvas:sourceCanvas,roll:roll(frame)};});break;
      case 'ImageFromBatch':r=value(a.image).slice(a.batch_index,a.batch_index+a.length);break;
      case 'RepeatImageBatch':r=Array.from({length:a.amount},()=>value(a.image)).flat();break;
      case 'ImageBatch':r=[...value(a.image1),...value(a.image2)];break;
      case 'H3FaceTrackCrop':r=slot===1?value(a.images):value(a.images).map(f=>({...f,space:'h3_box'}));break;
      case 'LivePortraitCropper':{
        const photo=value(a.source_image)[0];
        r=slot===1?{photo:{...photo,roll:a.rotate?0:photo.roll},inverseRoll:a.rotate?photo.roll:0}:
          value(a.source_image).map(f=>({...f,space:'lp_canonical',roll:a.rotate?0:f.roll}));break;
      }
      case 'LivePortraitProcess':{
        const driving=value(a.driving_images),photo=value(a.crop_info).photo;
        assert.equal(driving[0].frame,0,'Every segment must anchor to the original canonical frame0');
        assert.ok(driving.length<=125);assert.equal(photo.identity,'photo');
        assert.ok(driving.every(f=>f.space==='lp_canonical'),'Driver and photo must share LP canonical alignment');
        r=driving.map(f=>({...f,identity:photo.identity,anchor:driving[0].frame,space:'lp_output',
          roll:photo.roll+f.roll-driving[0].roll,inverseRoll:value(a.crop_info).inverseRoll}));break;
      }
      case 'LivePortraitComposite':{
        assert.deepEqual(a.cropped_image,[a.liveportrait_out[0],0]);
        r=value(a.liveportrait_out).map(f=>({...f,space:'h3_box',roll:f.roll+f.inverseRoll}));break;
      }
      case 'Canny':r=value(a.image).map(f=>({...f,edges:true}));break;
      case 'ImageScale':assert.equal(a.upscale_method,'area');r=value(a.image).map(f=>f.valid?0.3:0);break;
      case 'ImageToMask':r=value(a.image);break;
      case 'ThresholdMask':r=value(a.mask).map(v=>v>a.value);break;
      case 'GetImageSize':r=[sourceCanvas[0],sourceCanvas[1],value(a.image).length][slot];break;
      case 'EmptyImage':r=Array.from({length:a.batch_size},()=>({canvas:[value(a.width),value(a.height)],black:true}));break;
      case 'ImageCompositeMasked':r=value(a.source).map((f,i)=>({...f,controlActive:value(a.mask)[i]}));break;
      case 'H3FaceStitch':{
        const base=value(a.base_images),faces=value(a.refined_crops),track=value(a.transform);
        assert.equal(base.length,faces.length);assert.equal(base.length,track.length);
        r=faces.map((f,i)=>{
          assert.equal(f.space,'h3_box','Inverse LP crop transform must precede the source-frame stitch');
          assert.equal(f.frame,track[i].frame);assert.ok(base[i].black);
          return {...f,canvas:base[i].canvas,background:'black',trackingFrame:track[i].frame};});break;
      }
      default:throw Error('Unexpected conditioning timeline node '+n.class_type);
    }
    cache.set(key,r);return r;
  }
  return value;
}

for(const t of previous.cases){
  const base={...h3PhotoPlan(t.width,t.height),fps:24,totalFrames:t.frames,hasAudio:t.audio};
  assert.equal(sha(build({...base,akatzExpression:true})),t.sha256,'Old v2 remains byte-identical');
  assert.equal(sha(build({...base,akatzExpression:true,akatzFaceControl:false})),t.sha256);
  const baseline=build(base),source={...base,akatzExpression:true,akatzFaceControl:true},g=build(source);
  const parts=turbo8TemporalPlan(source).segments,plan=turbo8ExecutionPlan(source);
  assert.equal(plan.revision,AKATZ_FACE_CONTROL_REVISION);assert.equal(plan.applicationMaxSeconds,null);
  assert.equal(plan.gpuExecutionQualified,false);assert.equal(plan.expressionControl.extraSemanticVideoReference,false);
  assert.equal(plan.expressionControl.photoFeatureExtractions,1);
  assert.equal(Object.values(g).filter(n=>n.class_type==='ModelPatchLoader').length,1);
  assert.equal(Object.values(g).filter(n=>n.class_type==='LivePortraitCropper').length,parts.length+1);
  assert.equal(Object.values(g).filter(n=>n.class_type==='MiniMaxH3FunControlNetApply').length,parts.length);
  const changedGuider=new Set(parts.map(s=>String(s.base+10)));
  for(const [id,n] of Object.entries(baseline)){
    if(['86','87'].includes(id))continue;
    if(changedGuider.has(id))assert.deepEqual({...g[id].inputs,model:n.inputs.model},n.inputs,'Only the CFG model edge may change');
    else assert.deepEqual(g[id],n,'Baseline sampling, guide, source references and delivery remain unchanged: '+id);
  }
  // Deliberately use dimensions unlike the photo's canvas to catch any use of
  // photo dimensions for the tracker-to-source inverse placement.
  const sourceCanvas=[736,1280],frames=timeline(g,source.totalFrames,sourceCanvas);
  const modelIds=new Set();let anchor;
  for(const s of parts){
    const guider=g[String(s.base+10)],apply=g[guider.inputs.model[0]];modelIds.add(guider.inputs.model[0]);
    assert.equal(apply.class_type,'MiniMaxH3FunControlNetApply');
    assert.deepEqual(apply.inputs.model,baseline[String(s.base+10)].inputs.model);
    assert.equal(g[apply.inputs.model_patch[0]].inputs.name,AKATZ_FACE_CONTROL_PATCH);
    assert.deepEqual(apply.inputs.vae,['3',0]);
    assert.equal(apply.inputs.strength,1);assert.equal(apply.inputs.start_percent,0);assert.equal(apply.inputs.end_percent,1);
    assert.ok(!('mask' in apply.inputs)&&!('source_video' in apply.inputs),'Do not mistake inpainting for spatial control masking');
    assert.ok(!g[String(s.base+5)].inputs['ref_videos.ref_video_2'],'No close-up semantic video reference');
    const control=frames(apply.inputs.control_video);assert.equal(control.length,124);
    for(let i=0;i<control.length;i++){
      const expected=Math.min(s.loadStart+i,s.loadStart+s.inputFrames-1),f=control[i];
      assert.equal(f.frame,expected);assert.equal(f.trackingFrame,expected);assert.equal(f.identity,'photo');
      assert.equal(f.anchor,0);assert.deepEqual(f.canvas,sourceCanvas);assert.equal(f.background,'black');
      assert.ok(Math.abs(f.roll-roll(expected))<1e-12,'Canonical driving alignment must preserve head roll, including later windows');
      assert.equal(f.controlActive,expected%67!==11,'Missing crop must produce zero control instead of a fabricated expression');
    }
    assert.deepEqual(control.slice(s.contextFrames,s.contextFrames+s.frames).map(f=>f.frame),
      Array.from({length:s.frames},(_,i)=>s.start+i),'No prefix/padding may shift delivered expression timing');
    let input=apply.inputs.control_video;
    if(g[input[0]].class_type==='ImageBatch')input=g[input[0]].inputs.image1;
    const stitch=g[input[0]],gate=g[stitch.inputs.refined_crops[0]],canny=g[gate.inputs.source[0]];
    assert.equal(stitch.class_type,'H3FaceStitch');assert.equal(stitch.inputs.feather,0);assert.equal(stitch.inputs.colour_match,0);
    const trim=g[canny.inputs.image[0]],composite=g[trim.inputs.image[0]],process=g[composite.inputs.liveportrait_out[0]];
    assert.equal(trim.inputs.batch_index,1);assert.equal(trim.inputs.length,s.inputFrames);
    assert.equal(composite.class_type,'LivePortraitComposite');assert.equal(process.class_type,'LivePortraitProcess');
    const prefix=g[process.inputs.driving_images[0]];
    anchor??=prefix.inputs.image1;assert.deepEqual(prefix.inputs.image1,anchor,'Canonical global anchor is shared by every window');
    assert.equal(process.inputs.lip_zero,false);assert.ok(!process.inputs.retargeting_info);
  }
  assert.equal(modelIds.size,parts.length,'Each CFG guider needs its own patched model and clip');
  for(const [id,n] of Object.entries(g)){
    assert.equal(h3NodeClass(id,plan),n.class_type,'Progress includes all actual candidate nodes');
    if(baseline[id])continue;
    const declaration=raw[n.class_type],fields={...declaration?.input.required,...declaration?.input.optional};
    assert.ok(declaration,'Every new class is declared in the real provider registry: '+n.class_type);
    for(const name of Object.keys(declaration.input.required))assert.ok(Object.hasOwn(n.inputs,name),n.class_type+'.'+name);
    for(const [name,v] of Object.entries(n.inputs)){
      assert.ok(fields[name],'Registered input '+n.class_type+'.'+name);
      if(edge(v)){
        const received=schemas[g[v[0]].class_type]?.outputs[v[1]]?.type,wanted=schemas[n.class_type].inputs.find(p=>p.name===name)?.type;
        assert.ok(received&&wanted&&(received===wanted||received==='*'||wanted==='*'||wanted.split(',').includes(received)),n.class_type+'.'+name+' '+received+' -> '+wanted);
      }else{
        const [type,config={}]=fields[name],choices=Array.isArray(type)?type:config.options;
        if(choices)assert.ok(choices.includes(v),n.class_type+'.'+name);
        if(type==='BOOLEAN')assert.equal(typeof v,'boolean');
        if(type==='INT'||type==='FLOAT'){
          assert.ok(Number.isFinite(v));if(type==='INT')assert.ok(Number.isSafeInteger(v));
          assert.ok(v>=(config.min??-Infinity)&&v<=(config.max??Infinity),n.class_type+'.'+name);
        }
      }
    }
  }
  const seen=new Set(),pending=[...Object.values(g['490'].inputs),...Object.values(g['5108'].inputs)].filter(edge);
  while(pending.length){const [id]=pending.pop();if(seen.has(id))continue;seen.add(id);
    const n=g[id];assert.ok(!['H3FaceStitch','LivePortraitComposite','Canny','ImageScale'].includes(n.class_type),'Face branch is conditioning only');
    for(const v of Object.values(n.inputs))if(edge(v)&&schemas[g[v[0]].class_type]?.outputs[v[1]]?.type==='IMAGE')pending.push(v);
  }
  assert.equal(g['490'].inputs.frame_rate,24);assert.ok(!Object.values(g).some(n=>/RIFE|Upscale|PerFrameDenoise/.test(n.class_type)));
}

for(const frames of [6,49,124,125,244,363,463,1464,2401]){
  const editor=turbo8EditorForFrames({...models,frames,akatzExpression:true,akatzFaceControl:true});
  const nodes=new Map(editor.nodes.map(n=>[n.id,n]));assert.equal(nodes.size,editor.nodes.length);
  assert.equal(editor.extra.vanta_export.source_revision,AKATZ_FACE_CONTROL_REVISION);
  for(const l of editor.links){assert.ok(nodes.get(l[1]).outputs[l[2]].links.includes(l[0]));assert.equal(nodes.get(l[3]).inputs[l[4]].link,l[0]);}
}
assert.deepEqual(parseAkatzOptions('minimaxH3Akatz'),{akatzExpression:false,akatzFaceControl:false});
for(const options of [{akatzFaceControl:'true'},{akatzExpression:'false',akatzFaceControl:'true'},
  {akatzExpression:'true',akatzFaceControl:'yes'},{akatzExpression:'true',akatzFaceControl:['true']}])
  assert.throws(()=>parseAkatzOptions('minimaxH3Akatz',options));
assert.throws(()=>parseAkatzOptions('current',{akatzFaceControl:'true'}));

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'akatz-face-control-'));let server;
try{
  const photo=path.join(folder,'photo.png'),video=path.join(folder,'video.mp4');fs.writeFileSync(photo,'fixture');fs.writeFileSync(video,'fixture');
  const queue=createGenerationQueue({dir:folder}),id=crypto.randomUUID();
  await queue.stage({jobId:id,deviceId:'01234567890123456789012345678901',body:{workflow:'minimaxH3Akatz',mode:'plus',akatzExpression:'true',akatzFaceControl:'true'},
    image:{path:photo,mimetype:'image/png'},video:{path:video,mimetype:'video/mp4'}});
  assert.equal(createGenerationQueue({dir:folder}).read(id).body.akatzFaceControl,'true','ControlNet selection survives queue restart');
  const app=express();installAkatzEditorDownload({app,getModelFiles:()=>models,
    buildWorkflow:(m,req)=>turbo8EditorForFrames({...m,frames:463,...parseAkatzOptions('minimaxH3Akatz',req.query)}),
    filename:req=>{const o=parseAkatzOptions('minimaxH3Akatz',req.query);return o.akatzFaceControl?AKATZ_FACE_CONTROL_FILENAME:o.akatzExpression?AKATZ_EXPRESSION_FILENAME:TURBO8_EDITOR_FILENAME;}});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  for(const [expr,control,file] of [['false','false',TURBO8_EDITOR_FILENAME],['true','false',AKATZ_EXPRESSION_FILENAME],['true','true',AKATZ_FACE_CONTROL_FILENAME]]){
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub?akatzExpression='+expr+'&akatzFaceControl='+control);
    assert.equal(response.status,200);assert.ok(response.headers.get('content-disposition').includes(file));
    const e=await response.json();assert.equal(e.nodes.some(n=>n.type==='MiniMaxH3FunControlNetApply'),control==='true');
  }
}finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});}

// Execute actual client handlers. Restored browser form values must override
// stale in-memory defaults for BOTH Generate and Download.
const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(html,/<option value="controlnet" selected>ControlNet wajah/);
const helper=js.slice(js.indexOf('function readAkatzMode(){'),js.indexOf("$('#akatzExpression')?.addEventListener"));
const generate=js.slice(js.indexOf('async function generate(){'),js.indexOf('\nfunction showTask('));
const download=js.slice(js.indexOf("document.querySelector('.akatz-editor-download')"),js.indexOf('\nfunction initDropzone('));
let listener,query,form,filename;const nodes=new Map();
const $=s=>{if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',querySelector:()=>null});return nodes.get(s);};
const link={href:'https://vanta.example/api/workflows/minimaxH3Akatz/runninghub',download:TURBO8_EDITOR_FILENAME,getAttribute:()=>null,setAttribute:()=>{},removeAttribute:()=>{}};
const state={workflow:'minimaxH3Akatz',mode:'plus',image:new Blob(['photo']),video:new Blob(['video']),accounts:[{canGenerate:true}]};
const context={state,$,FormData,Blob,URL,crypto,ACTIVE_UPLOAD_KEY:'fixture',location:{href:'https://vanta.example/'},
  localStorage:{setItem:()=>{}},showStartingTask:()=>{},startVisibleTimer:()=>{},toast:()=>{},
  uploadReferences:async fd=>{form=fd;return {jobId:'fixture'};},trackSubmission:()=>{},
  fetch:async url=>{query=new URL(url);return {ok:true,json:async()=>({nodes:[],links:[]})};},setTimeout:fn=>fn(),
  document:{querySelector:()=>({addEventListener:(_,fn)=>listener=fn}),body:{append:()=>{}},
    createElement:()=>({click(){filename=this.download;},remove:()=>{}})}};
vm.createContext(context);vm.runInContext(helper+generate+download,context);
for(const [mode,expr,control,file] of [['controlnet','true','true',AKATZ_FACE_CONTROL_FILENAME],['expression','true','false',AKATZ_EXPRESSION_FILENAME],['baseline','false','false',TURBO8_EDITOR_FILENAME]]){
  $('#akatzExpression').value=mode;state.submission=null;state.akatzExpression=false;state.akatzFaceControl=false;
  await context.generate();assert.equal(form.get('akatzExpression'),expr);assert.equal(form.get('akatzFaceControl'),control);
  state.akatzExpression=false;state.akatzFaceControl=false;
  await listener({preventDefault:()=>{},currentTarget:link});
  assert.equal(query.searchParams.get('akatzExpression'),expr);assert.equal(query.searchParams.get('akatzFaceControl'),control);assert.equal(filename,file);
}
console.log('PASS: 60 unchanged v2 payloads; registered native model patches per window; canonical/global-frame0 alignment and inverse warp; source-canvas face maps with invalid-frame gate; bounded duration, typed links, unchanged native delivery, durable options, editor exports, and real client Generate/Download. No GPU inference or visual qualification.');
