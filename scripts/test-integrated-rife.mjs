import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {turbo8GraphForInputs,turbo8EditorWorkflow,turbo8ExecutionPlan,TURBO8_ASSET} from '../h3-akatz-turbo8.js';
import {withIntegratedRife60,withIntegratedRife60Editor,integratedRifePlan,INTEGRATED_RIFE_ID as id,RIFE60_EDITOR_FILENAME} from '../integrated-rife.js';

const read=p=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url)));
const models={characterLoraFile:'api-lora-usa/55c5bb53f1104e3cd4fed7fbe5d522d7.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const source=(frames,audio=true,w=1080,h=1920)=>({...h3PhotoPlan(w,h),inferenceProfile:'akatz-v1.5-native4-ref2v',
  fps:24,totalFrames:frames,hasAudio:audio});
const native=s=>turbo8GraphForInputs({...models,source:s,imageName:'photo.png',videoName:'video.mp4'});
const fly=compileMotionFlyHD(read('motionfly-hd-runninghub.json')),koh=read('current-api.json');
for(const original of [koh,fly,native(source(361)),native(source(6,false)),native(source(48,true,1920,1080))]){
  const before=JSON.stringify(original),g=withOriginalVideoArchive(withIntegratedRife60(original));
  assert.equal(JSON.stringify(original),before,'Source builders remain untouched');
  assert.equal(Object.values(g).filter(n=>n.class_type==='RIFEInterpolation').length,1);
  assert.deepEqual(g[id].inputs.images,original['490'].inputs.images);
  assert.deepEqual(g[id].inputs.source_fps,original['490'].inputs.frame_rate);
  assert.equal(g[id].inputs.target_fps,60);assert.equal(g[id].inputs.scale,1);
  assert.equal(g[id].inputs.model_name,'flownet.pkl');assert.equal(g[id].inputs.batch_size,2);
  for(const [key,node] of Object.entries(original)){
    const shared=node.class_type==='VHS_VideoCombine'&&JSON.stringify(node.inputs.images)===JSON.stringify(original['490'].inputs.images);
    if(shared){
      assert.deepEqual(g[key].inputs.images,[id,0]);assert.equal(g[key].inputs.frame_rate,60);
      for(const field of ['audio','format','pix_fmt','crf','trim_to_audio'])assert.deepEqual(g[key].inputs[field],node.inputs[field]);
    }else if(Number(key)<5100||Number(key)>5108)assert.deepEqual(g[key],node,'No generation/resolution/pose/sampler change at '+key);
  }
  for(const [key,node] of Object.entries(g))for(const value of Object.values(node.inputs))
    if(Array.isArray(value)&&typeof value[0]==='string'&&Number.isInteger(value[1]))assert.ok(g[value[0]],key+' missing upstream');
  if(g['5100'])for(const key of ['5100','5103','5104','5105'])assert.deepEqual(g[key].inputs.image,[id,0]);
  assert.deepEqual(withIntegratedRife60(g),g,'Repeated decoration cannot add another interpolation node');
}
// Quantized CFR duration remains within one 60-FPS frame, including short clips
// and the non-integer 24→60 / 40→60 ratios. No fixed 2x multiplier or metadata-only FPS.
for(const fps of [24,30,40,59.94])for(let n=6;n<=362;n++){
  const count=Math.floor(n/fps*60);
  assert.ok(n/fps-count/60<1/60+1e-10);
}
for(const frames of [6,49,98,124,125,196,202,243,244,361,362]){
  const s=source(frames),g=withIntegratedRife60(native(s)),plan=integratedRifePlan(turbo8ExecutionPlan(s));
  assert.equal(plan.outputFrames,Math.floor(frames/24*60));assert.equal(plan.fps,24);assert.equal(plan.outputFps,60);
  assert.equal(plan.nodeClasses[id],'RIFEInterpolation');assert.equal(plan.interpolation.singleTask,true);
  assert.equal(g['41'].inputs.steps,8);assert.equal(g['40'].inputs.sampler_name,'er_sde');
}
assert.throws(()=>withIntegratedRife60({}),/final/);
assert.throws(()=>withIntegratedRife60({...koh,[id]:{class_type:'Other'}}),/ID/);

const original=turbo8EditorWorkflow(models),editor=withIntegratedRife60Editor(original);
const nodes=new Map(editor.nodes.map(n=>[n.id,n])),links=new Map(editor.links.map(l=>[l[0],l]));
assert.equal(nodes.get(Number(id)).type,'RIFEInterpolation');
for(const link of editor.links){
  assert.equal(nodes.get(link[3]).inputs[link[4]].link,link[0]);
  assert.ok(nodes.get(link[1]).outputs[link[2]].links.includes(link[0]));
}
for(const node of editor.nodes){
  for(const input of node.inputs||[])if(input.link!=null)assert.ok(links.has(input.link));
  for(const output of node.outputs||[])for(const link of output.links||[])assert.ok(links.has(link));
}
for(const key of [490,493,5100,5103,5104,5105]){
  const node=nodes.get(key),input=node.inputs.find(i=>i.name==='images'||i.name==='image');
  assert.equal(links.get(input.link)[1],Number(id),'Export must use final interpolated batch: '+key);
  if(node.type==='VHS_VideoCombine'){
    assert.equal(node.widgets_values_named.frame_rate,60);assert.equal(node.widgets_values.frame_rate,60);
  }
}
assert.equal(original.nodes.find(n=>n.id===490).widgets_values.frame_rate,24);
assert.equal(editor.extra.vanta_export.output_fps,60);assert.equal(editor.extra.vanta_export.single_task,true);
const app=express();
installAkatzEditorDownload({app,getModelFiles:()=>models,buildWorkflow:m=>withIntegratedRife60Editor(turbo8EditorWorkflow(m)),filename:RIFE60_EDITOR_FILENAME});
const server=app.listen(0,'127.0.0.1');
try{
  await new Promise(resolve=>server.on('listening',resolve));
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/workflows/minimaxH3Akatz/runninghub');
  assert.equal(r.status,200);assert.ok(r.headers.get('content-disposition').includes(RIFE60_EDITOR_FILENAME));
  const data=await r.json();assert.equal(data.extra.vanta_export.output_fps,60);
  assert.equal(data.nodes.filter(n=>n.type==='RIFEInterpolation').length,1);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('PASS: opt-in RIFE graph/editor utility; actual FPS links; shared 60 FPS MP4/ZIP/PNG batch; source/audio/size preserved. Production workflow membership is checked by the token transport suite. No GPU execution.');
