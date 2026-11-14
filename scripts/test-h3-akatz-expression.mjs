import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {turbo8GraphForInputs,turbo8TemporalPlan,turbo8ExecutionPlan,turbo8EditorForFrames,TURBO8_ASSET,TURBO8_EDITOR_FILENAME} from '../h3-akatz-turbo8.js';
import {parseAkatzExpressionOption,AKATZ_EXPRESSION_REVISION,AKATZ_EXPRESSION_FILENAME,AKATZ_EXPRESSION_SCHEMAS,akatzExpressionEditorSchemas} from '../h3-akatz-expression.js';
import {h3NodeClass} from '../runninghub-execution-trace.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {createGenerationQueue} from '../generation-queue.js';

const models={characterLoraFile:'api-lora-usa/00000000000000000000000000000000.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const build=s=>turbo8GraphForInputs({...models,source:s,imageName:'photo.png',videoName:'video.mp4'});
const baseSchemas=JSON.parse(fs.readFileSync(new URL('../workflows/runninghub-akatz-node-schemas.json',import.meta.url)));
const schemas={...baseSchemas,...akatzExpressionEditorSchemas()};
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1]);
const sha=g=>crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/akatz-expression-baselines.json',import.meta.url)));
assert.equal(fixture.sourceCommit,'4f09101deb2427e0510318ffb7c51edf92caf5a5');

// A deterministic motion signal makes a window-local reset distinguishable
// from the desired global frame-0 reference. No neural inference is simulated.
const motion=i=>Math.sin(i/13)+Math.cos(i/29)*0.37+(i%7===0?0.21:0);
function faceTimeline(graph,count,canvas){
  const cache=new Map(),value=v=>edge(v)?out(v[0],v[1]):v;
  function out(id,slot=0){
    const key=id+':'+slot;if(cache.has(key))return cache.get(key);
    const n=graph[id],a=n.inputs;let r;
    if(n.class_type==='LoadImage')r=[{frame:0,identity:'photo',expression:0.4}];
    else if(n.class_type==='VHS_LoadVideo'){
      const start=a.skip_first_frames||0,frames=Math.min(a.frame_load_cap||count,count-start);
      r=Array.from({length:frames},(_,i)=>({frame:start+i,identity:'video',expression:motion(start+i),
        canvas,faceBounds:[canvas[0]*(0.3+0.02*Math.sin((start+i)/17)),canvas[1]*0.2,canvas[0]*0.15,canvas[1]*0.12]}));
    }else if(n.class_type==='ImageFromBatch')r=value(a.image).slice(value(a.batch_index),value(a.batch_index)+value(a.length));
    else if(n.class_type==='RepeatImageBatch')r=Array.from({length:value(a.amount)},()=>value(a.image)).flat();
    else if(n.class_type==='ImageBatch')r=[...value(a.image1),...value(a.image2)];
    else if(n.class_type==='H3FaceTrackCrop'){
      const frames=value(a.images);
      r=slot===1?{frames}:frames.map(f=>({...f,canvas:[512,512]}));
    }
    else if(n.class_type==='LivePortraitCropper')r=slot===1?{appearance:value(a.source_image)[0]}:value(a.source_image);
    else if(n.class_type==='LivePortraitProcess'){
      const driving=value(a.driving_images),photo=value(a.crop_info).appearance;
      assert.equal(driving[0].frame,0,'Every LP call uses the original frame0, including later windows');
      assert.ok(driving.length<=125,'No entire long clip or per-frame source feature bank');
      r=driving.map(d=>({frame:d.frame,identity:photo.identity,expression:photo.expression+d.expression-driving[0].expression,canvas:[512,512]}));
    }else if(n.class_type==='H3FaceStitch'){
      // Interpret the registered stitch contract, not the neural model. A
      // detached v1 face clip fails the full-frame assertions below.
      const base=value(a.base_images),faces=value(a.refined_crops),tracked=value(a.transform).frames;
      assert.equal(faces.length,base.length);assert.equal(tracked.length,base.length);
      r=base.map((b,i)=>{
        assert.equal(faces[i].frame,b.frame);assert.equal(tracked[i].frame,b.frame);
        return {...faces[i],canvas:b.canvas,faceBounds:tracked[i].faceBounds,backgroundFrame:b.frame,frameAligned:true};
      });
    }else throw Error('Unexpected face timeline node '+n.class_type);
    cache.set(key,r);return r;
  }
  return value;
}

for(const test of fixture.cases){
  const source={...h3PhotoPlan(test.width,test.height),fps:24,totalFrames:test.frames,hasAudio:test.audio};
  const baseline=build(source),disabled=build({...source,akatzExpression:false});
  assert.equal(sha(baseline),test.sha256,'Legacy payload must remain byte-for-byte identical');
  assert.equal(sha(disabled),test.sha256,'Selecting the previous version must restore the exact baseline');
  const candidateSource={...source,akatzExpression:true},g=build(candidateSource),parts=turbo8TemporalPlan(source).segments;
  const canvas=[source.canvasWidth,source.canvasHeight];
  const input=faceTimeline(g,source.totalFrames,canvas),plan=turbo8ExecutionPlan(candidateSource);
  assert.equal(plan.revision,AKATZ_EXPRESSION_REVISION);assert.equal(plan.applicationMaxSeconds,null);
  assert.equal(plan.expressionControl.globalDrivingAnchorFrame,0);
  assert.equal(plan.expressionControl.gpuExecutionQualified,false);
  assert.equal(plan.expressionControl.hardPerFrameFacialControl,false);
  assert.deepEqual(plan.expressionControl.referenceVideoSize,canvas);
  assert.equal(plan.expressionControl.framingRestoration.detachedCropReference,false);
  assert.equal(Object.values(g).filter(n=>n.class_type==='LivePortraitCropper').length,1);
  assert.equal(Object.values(g).filter(n=>n.class_type==='LivePortraitProcess').length,parts.length);
  assert.equal(Object.values(g).filter(n=>n.class_type==='H3FaceStitch').length,parts.length);
  assert.equal(Object.values(g).filter(n=>n.class_type==='SamplerCustomAdvanced').length,parts.length);
  for(const [id,n] of Object.entries(baseline)){
    if(['TextGenerate','StringConcatenate','MiniMaxH3ReferenceToVideo'].includes(n.class_type))continue;
    assert.deepEqual(g[id],n,'Existing sampling/output/audio/guide/context node changed: '+id);
  }
  for(const s of parts){
    const reference=g[String(s.base+5)];
    assert.deepEqual(reference.inputs['ref_videos.ref_video_1'],baseline[String(s.base+5)].inputs['ref_videos.ref_video_1']);
    assert.deepEqual(reference.inputs['ref_images.ref_image_1'],['31',0]);
    let restored=reference.inputs['ref_videos.ref_video_2'];
    while(g[restored[0]].class_type==='ImageBatch')restored=g[restored[0]].inputs.image1;
    const stitch=g[restored[0]];assert.equal(stitch.class_type,'H3FaceStitch','Never send a detached face crop to H3 ref2');
    assert.deepEqual(stitch.inputs.base_images,g[String(s.base+3)].inputs.image1,'Restore on the exact unpadded driving window');
    assert.equal(stitch.inputs.transform[1],1);const tracker=g[stitch.inputs.transform[0]];
    assert.equal(tracker.class_type,'H3FaceTrackCrop');assert.deepEqual(tracker.inputs.images,stitch.inputs.base_images);
    assert.equal(stitch.inputs.paste_region,'face_ellipse');assert.equal(stitch.inputs.colour_match,0);
    assert.equal(stitch.inputs.undetected_frames,'fade_out');
    const face=input(reference.inputs['ref_videos.ref_video_2']);assert.equal(face.length,124);
    for(let j=0;j<face.length;j++){
      const expected=Math.min(s.loadStart+j,s.loadStart+s.inputFrames-1);
      assert.equal(face[j].frame,expected,'Face reference timestamp must match the original video, including overlap/padding');
      assert.equal(face[j].identity,'photo');
      assert.deepEqual(face[j].canvas,canvas,'Facial guidance must preserve full source canvas, not a 512 square');
      assert.equal(face[j].backgroundFrame,expected);assert.equal(face[j].frameAligned,true);
      assert.deepEqual(face[j].faceBounds,input(stitch.inputs.base_images)[Math.min(j,s.inputFrames-1)].faceBounds);
      assert.ok(Math.abs(face[j].expression-(0.4+motion(expected)-motion(0)))<1e-12,'Expression must not reset at a segment boundary');
    }
    assert.deepEqual(face.slice(s.contextFrames,s.contextFrames+s.frames).map(f=>f.frame),
      Array.from({length:s.frames},(_,i)=>s.start+i),'No added prefix, missing frame or padding may be delivered');
  }
  for(const [id,n] of Object.entries(g)){
    assert.equal(h3NodeClass(id,plan),n.class_type,'Live progress must recognize the candidate nodes');
    // Unchanged nodes are covered by the exact baseline snapshots and their
    // existing suites. Type-check every added node and modified H3 reference.
    if(baseline[id]&&n.class_type!=='MiniMaxH3ReferenceToVideo')continue;
    const schema=schemas[n.class_type];assert.ok(schema,'Registered schema required: '+n.class_type);
    if(!baseline[id]){
      const declaration=AKATZ_EXPRESSION_SCHEMAS[n.class_type];assert.ok(declaration);
      const fields={...declaration.input.required,...declaration.input.optional};
      for(const name of Object.keys(declaration.input.required))assert.ok(Object.hasOwn(n.inputs,name),'Required input '+n.class_type+'.'+name);
      for(const [name,v] of Object.entries(n.inputs)){
        assert.ok(fields[name],'Unregistered input '+n.class_type+'.'+name);if(edge(v))continue;
        const [type,config={}]=fields[name],choices=Array.isArray(type)?type:config.options;
        if(choices)assert.ok(choices.includes(v),'Unsupported option '+n.class_type+'.'+name);
        if(type==='BOOLEAN')assert.equal(typeof v,'boolean');
        if(type==='INT'||type==='FLOAT'){
          assert.ok(Number.isFinite(v));if(type==='INT')assert.ok(Number.isSafeInteger(v));
          assert.ok(v>=(config.min??-Infinity)&&v<=(config.max??Infinity),'Out-of-range '+n.class_type+'.'+name);
        }
      }
    }
    for(const [name,v] of Object.entries(n.inputs))if(edge(v)){
      const port=schema.inputs.find(p=>p.name===name);assert.ok(port,'Declared input required: '+n.class_type+'.'+name);
      const received=schemas[g[v[0]].class_type].outputs[v[1]].type;
      assert.ok(port.type==='*'||received==='*'||port.type===received||port.type.split(',').includes(received),
        'Type mismatch '+id+'.'+name+': '+received+' -> '+port.type);
    }
  }
  assert.equal(g['490'].inputs.frame_rate,24);assert.ok(g['5108']);
  assert.ok(!Object.values(g).some(n=>/RIFE|PerFrameDenoise|Upscale/.test(n.class_type)));
  // The delivered IMAGE path stops at decode; the conditioning stitch must
  // never be connected after decode, directly to MP4, ZIP or PNG outputs.
  const seen=new Set(),images=[...Object.values(g['490'].inputs),...Object.values(g['5108'].inputs)].filter(edge);
  while(images.length){
    const [id,slot]=images.pop();if(seen.has(id))continue;seen.add(id);
    const n=g[id];assert.notEqual(n.class_type,'H3FaceStitch','Stitch is conditioning-only, never output refinement');
    for(const v of Object.values(n.inputs))if(edge(v)&&schemas[g[v[0]].class_type]?.outputs[v[1]]?.type==='IMAGE')images.push(v);
  }
}
assert.equal(h3NodeClass('10048',{revision:'akatz-native-1080-turbo8-expression-v1',
  nodeClasses:{'10048':'LivePortraitProcess'}}),'LivePortraitProcess','Existing v1 task progress keeps its stored node map');
assert.equal(parseAkatzExpressionOption('minimaxH3Akatz',undefined),false);
assert.equal(parseAkatzExpressionOption('minimaxH3Akatz','true'),true);
assert.equal(parseAkatzExpressionOption('minimaxH3Akatz','false'),false);
assert.throws(()=>parseAkatzExpressionOption('current','true'));
assert.throws(()=>parseAkatzExpressionOption('minimaxH3Akatz','yes'));
assert.throws(()=>parseAkatzExpressionOption('minimaxH3Akatz',['true']));

for(const frames of [6,49,124,125,244,363,463,1464]){
  const e=turbo8EditorForFrames({...models,frames,akatzExpression:true});
  const nodes=new Map(e.nodes.map(n=>[n.id,n])),links=new Map(e.links.map(l=>[l[0],l]));
  assert.equal(nodes.size,e.nodes.length);assert.equal(e.extra.vanta_export.source_revision,AKATZ_EXPRESSION_REVISION);
  for(const l of e.links){
    assert.ok(nodes.get(l[1]).outputs[l[2]].links.includes(l[0]));assert.equal(nodes.get(l[3]).inputs[l[4]].link,l[0]);
  }
  for(const n of e.nodes.filter(n=>n.type==='MiniMaxH3ReferenceToVideo')){
    const input=n.inputs.find(p=>p.name==='ref_videos.ref_video_2');assert.ok(input?.link);
    assert.equal(input.type,'IMAGE');
  }
  for(const n of e.nodes.filter(n=>n.type==='LivePortraitProcess')){
    assert.equal(n.widgets_values_named.relative_motion_mode,'relative');
    const p=n.inputs.find(p=>p.name==='crop_info');assert.equal(nodes.get(links.get(p.link)[1]).type,'LivePortraitCropper');
  }
}

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-expression-option-'));
let server;
try{
  const photo=path.join(folder,'photo.png'),video=path.join(folder,'source.mp4');fs.writeFileSync(photo,'fixture');fs.writeFileSync(video,'fixture');
  const queue=createGenerationQueue({dir:folder}),id=crypto.randomUUID();
  await queue.stage({jobId:id,deviceId:'01234567890123456789012345678901',
    body:{workflow:'minimaxH3Akatz',mode:'plus',akatzExpression:'true'},
    image:{path:photo,originalname:'photo.png',mimetype:'image/png',size:7},video:{path:video,originalname:'video.mp4',mimetype:'video/mp4',size:7}});
  assert.equal(queue.read(id).body.akatzExpression,'true');
  assert.equal(createGenerationQueue({dir:folder}).read(id).body.akatzExpression,'true','The selected candidate survives queue restart');
  const app=express();
  installAkatzEditorDownload({app,getModelFiles:()=>models,
    buildWorkflow:(m,req)=>turbo8EditorForFrames({...m,frames:49,akatzExpression:parseAkatzExpressionOption('minimaxH3Akatz',req.query.akatzExpression)}),
    filename:req=>req.query.akatzExpression==='true'?AKATZ_EXPRESSION_FILENAME:TURBO8_EDITOR_FILENAME});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub';
  for(const enabled of [false,true]){
    const response=await fetch(base+'?akatzExpression='+enabled);assert.equal(response.status,200);
    assert.ok(response.headers.get('content-disposition').includes(enabled?AKATZ_EXPRESSION_FILENAME:TURBO8_EDITOR_FILENAME));
    const e=await response.json();assert.equal(e.nodes.some(n=>n.type==='LivePortraitProcess'),enabled);
  }
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  assert.match(html,/<option value="expression" selected>Uji mimik wajah/);
  assert.match(html,/<option value="baseline">Versi sebelumnya/);
  assert.match(js,/fd\.append\('akatzExpression',state\.akatzExpression\?'true':'false'\)/);
  assert.match(source,/if\(akatzExpression\)h3Source\.akatzExpression=true/);
  assert.match(source,/workflow:submittedWorkflow\.name/);
  console.log('PASS: 60 exact baselines; global frame0, full-frame facial references with matching tracker transforms, no output stitch, aligned overlap/padding, declared types, editor links, durable selection and HTTP exports. No GPU inference or visual qualification.');
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.rmSync(folder,{recursive:true,force:true});
}
