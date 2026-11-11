import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';

const editor=JSON.parse(fs.readFileSync(new URL('../workflows/motionfly-hd-runninghub.json',import.meta.url),'utf8'));
const graph=compileMotionFlyHD(editor);
const nodes=new Map(editor.nodes.map(node=>[node.id,node]));
const links=new Map(editor.links.map(link=>[link[0],link]));
assert.equal(links.size,editor.links.length,'Editor links must be unique');
for(const link of editor.links){
  assert.equal(nodes.get(link[3])?.inputs[link[4]]?.link,link[0],'Editor input must agree with its link');
  assert.ok(nodes.get(link[1])?.outputs[link[2]]?.links?.includes(link[0]),'Editor output must retain its link');
}
assert.equal(graph['308'].inputs.keep_proportion,'total_pixels','The photo must set the aspect ratio without a portrait crop');
assert.equal(graph['308'].inputs.width,640);assert.equal(graph['308'].inputs.height,1120);
assert.equal(graph['308'].inputs.upscale_method,'nvidia_rtx_vsr');
assert.deepEqual(graph['89'].inputs.width,['308',1]);
assert.deepEqual(graph['89'].inputs.height,['308',2]);
assert.deepEqual(graph['418'].inputs.width,['89',1]);
assert.deepEqual(graph['418'].inputs.height,['89',2]);
assert.deepEqual(graph['497'].inputs.image,['30',0],'Final sizing must use the original photo, not the driver or rounded latent canvas');
assert.equal(graph['497'].inputs.keep_proportion,'total_pixels');
assert.deepEqual(graph['489'].inputs.width,['497',1]);
assert.deepEqual(graph['489'].inputs.height,['497',2]);
assert.equal(graph['489'].inputs.divisible_by,8,'RTX VSR and H.264 must retain an aligned output, including 1080 px');

// Exercise graph dependencies with the external ImageResizeKJv2 sizing contract:
// https://github.com/kijai/ComfyUI-KJNodes/blob/main/nodes/image_nodes.py
// This checks geometry and wiring only; it does not run a diffusion model.
function geometry(photo,driver){
  const seen=new Set(),cache=new Map();
  const value=input=>Array.isArray(input)?run(input[0])[input[1]]:input;
  function run(id){
    if(cache.has(id))return cache.get(id);
    assert.ok(!seen.has(id),'Sizing must not introduce a cycle');seen.add(id);
    const node=graph[id];assert.ok(node,'Sizing input must exist');
    let result;
    if(node.class_type==='LoadImage')result=[photo];
    else if(node.class_type==='VHS_LoadVideo')result=[driver];
    else if(node.class_type==='WanSCAILToVideo')result=[null,null,{width:value(node.inputs.width),height:value(node.inputs.height)}];
    else if(node.class_type==='KSampler')result=[value(node.inputs.latent_image)];
    else if(node.class_type==='VAEDecode')result=[value(node.inputs.samples)];
    else if(node.class_type==='ImageResizeKJv2'){
      const input=value(node.inputs.image),mode=node.inputs.keep_proportion;
      let width=value(node.inputs.width),height=value(node.inputs.height);
      if(mode==='total_pixels'){
        const pixels=width*height,aspect=input.width/input.height;
        width=Math.trunc(Math.sqrt(pixels*aspect));height=Math.trunc(Math.sqrt(pixels/aspect));
      }else assert.equal(mode,'crop');
      const divisible=node.inputs.divisible_by;
      if(divisible>1){width-=width%divisible;height-=height%divisible;}
      if(node.inputs.upscale_method==='nvidia_rtx_vsr'){
        width=Math.max(8,Math.round(width/8)*8);height=Math.max(8,Math.round(height/8)*8);
      }
      assert.ok(width>0&&height>0,'Every canvas must remain usable');
      result=[{width,height},width,height];
    }else throw Error('Unexpected sizing node '+node.class_type);
    seen.delete(id);cache.set(id,result);return result;
  }
  return {reference:run('308')[0],guide:run('89')[0],output:run('489')[0]};
}

for(const [width,height] of [[2048,1529],[1200,900],[900,1200],[1920,1080],[1080,1920],[1200,1200],[2520,1080]]){
  let previous;
  for(const [driverWidth,driverHeight] of [[1080,1920],[1920,1080],[1000,1000]]){
    const plan=geometry({width,height},{width:driverWidth,height:driverHeight});
    assert.deepEqual(plan.reference,plan.guide,'Reference, guide, SAM3 masks and latent must share one canvas');
    assert.ok(plan.reference.width*plan.reference.height<=640*1120,'Adaptive sizing must retain the sampling pixel budget');
    assert.ok(plan.output.width*plan.output.height<=1080*1920,'Adaptive HD must retain the final pixel budget');
    const expected=width/height,actual=plan.output.width/plan.output.height;
    assert.ok(Math.abs(actual/expected-1)<.01,'Output must follow the photo within encoder alignment');
    assert.equal(Math.sign(plan.output.width-plan.output.height),Math.sign(width-height),'Landscape, portrait and square orientation must be preserved');
    if(previous)assert.deepEqual(plan,previous,'Driver dimensions must not choose the output aspect');
    previous=plan;
  }
}
const landscape=geometry({width:2048,height:1529},{width:1072,height:1920});
assert.deepEqual(landscape.output,{width:1664,height:1240},'The reported landscape photo must no longer produce a portrait output');
assert.deepEqual(geometry({width:1080,height:1920},{width:1920,height:1080}).output,{width:1080,height:1920});

const preserved=structuredClone(graph);
for(const id of ['89','308','489','497'])delete preserved[id];
assert.equal(createHash('sha256').update(JSON.stringify(preserved)).digest('hex'),
  '21c0188f377a36cd3c9342f95f4532ee22425511d7fdc8b9a45ca77cfc9d1ee6',
  'Models, prompts, sampler, FPS, audio, preview and original-video ZIP must retain their existing recipe');
console.log('PASS: MotionFly follows photo aspect across landscape/portrait/square and different drivers; aligned masks/latents, bounded HD pixels, audio and ZIP preserved. Geometry only; no live inference.');
