import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';

const read=p=>JSON.parse(fs.readFileSync(new URL('../workflows/'+p,import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../workflows/motionfly-hd-runninghub.json',import.meta.url));
assert.equal(createHash('sha256').update(source).digest('hex'),
  '77aaf68ba641159c1bce3cebb85e3a77e480be3a012879d311717592fcf02a30',
  'The reviewed adaptive MotionFly editor workflow must retain its validated revision');
const editor=JSON.parse(source),motionfly=compileMotionFlyHD(editor),current=read('current-api.json');
for(const [name,graph] of Object.entries({motionfly,current})){
  for(const [id,node] of Object.entries(graph))for(const [field,value] of Object.entries(node.inputs||{})){
    if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))
      assert.ok(graph[value[0]],name+' broken reference '+id+'.'+field+'->'+value[0]);
  }
  assert.equal(graph['30'].class_type,'LoadImage');
  assert.equal(graph['33'].class_type,'VHS_LoadVideo');
  assert.deepEqual(Object.keys(graph).filter(id=>graph[id].class_type==='LoadImage'),['30']);
  assert.deepEqual(Object.keys(graph).filter(id=>graph[id].class_type==='VHS_LoadVideo'),['33']);
  assert.equal(graph['33'].inputs.frame_load_cap,0,name+' must not truncate input');
  assert.deepEqual(graph['239'].inputs.video_info,['33',3]);
  assert.deepEqual(graph['418'].inputs.length,['239',1]);
  assert.deepEqual(graph['418'].inputs.pose_video_mask,['104',0]);
  assert.deepEqual(graph['418'].inputs.reference_image_mask,['104',1]);
  assert.deepEqual(graph['490'].inputs.frame_rate,['239',0]);
  assert.deepEqual(graph['490'].inputs.audio,['33',2]);
  assert.deepEqual(graph['490'].inputs.images,['489',0]);
  assert.equal(graph['490'].inputs.save_output,true);
}
assert.equal(current['489'].inputs.width,1080);assert.equal(current['489'].inputs.height,1920);
assert.deepEqual(motionfly['489'].inputs.width,['497',1]);assert.deepEqual(motionfly['489'].inputs.height,['497',2]);
assert.equal(current['33'].inputs.force_rate,40,'KOH (1) rate must remain unchanged');
assert.equal(motionfly['33'].inputs.force_rate,24,'Use the supplied workflow rate without the old R4 conversion');
assert.equal(motionfly['33'].inputs.force_size,'Disabled');
assert.equal(motionfly['331'].inputs.seed,50);
assert.equal(motionfly['331'].inputs.steps,6);assert.equal(motionfly['331'].inputs.cfg,1);
assert.equal(motionfly['331'].inputs.sampler_name,'euler');assert.equal(motionfly['331'].inputs.scheduler,'simple');
assert.equal(motionfly['331'].inputs.denoise,1);
assert.deepEqual(motionfly['89'].inputs.width,['308',1]);assert.deepEqual(motionfly['89'].inputs.height,['308',2]);
assert.equal(motionfly['89'].inputs.keep_proportion,'pad');
assert.equal(motionfly['308'].inputs.keep_proportion,'total_pixels');
for(const id of ['308','489']){
  assert.equal(motionfly[id].inputs.upscale_method,'nvidia_rtx_vsr');
  assert.equal(motionfly[id].inputs.device,'gpu');
}
assert.equal(motionfly['308'].inputs.divisible_by,16);assert.equal(motionfly['489'].inputs.divisible_by,8);
assert.deepEqual(motionfly['308'].inputs.image,['30',0]);
assert.deepEqual(motionfly['418'].inputs.reference_image,['308',0]);
assert.equal(motionfly['418'].inputs.replacement_mode,false);
assert.equal(motionfly['417'].inputs.context_length,101);assert.equal(motionfly['417'].inputs.context_overlap,32);
for(const id of ['490','493']){
  assert.equal(motionfly[id].inputs.crf,14);
  assert.deepEqual(motionfly[id].inputs.audio,['33',2]);
  assert.deepEqual(motionfly[id].inputs.frame_rate,['239',0]);
  assert.deepEqual(motionfly[id].inputs.images,['489',0]);
}
assert.equal(motionfly['493'].inputs.save_output,false);
assert.equal(motionfly['494'].class_type,'VHS_SelectFilename');
assert.equal(motionfly['494'].inputs.index,-1);
assert.deepEqual(motionfly['494'].inputs.filenames,['493',0]);
assert.equal(motionfly['496'].class_type,'CompressImages');
assert.deepEqual(motionfly['496'].inputs['images or video_path'],['494',0]);
assert.equal(motionfly['496'].inputs.filename_prefix,'MotionFly_1080HD_ZIP_R2');
assert.ok(!motionfly['500']&&!motionfly['501'],'Masks must be computed from this run, without old History dependencies');
assert.ok(!Object.values(motionfly).some(node=>['SetNode','GetNode','ComfySwitchNode','Note'].includes(node.class_type)));
for(const [id,node] of Object.entries(motionfly)){
  const original=editor.nodes.find(n=>String(n.id)===id);
  assert.equal(node.class_type,original.type,'No replacement node may be invented');
  if(node.class_type==='CLIPTextEncode')assert.equal(node.inputs.text,original.widgets_values[0],'Keep supplied prompts');
}
const broken=structuredClone(editor);broken.nodes=broken.nodes.filter(n=>String(n.id)!=='30');
assert.throws(()=>compileMotionFlyHD(broken),/input tidak tersedia/,'Missing photo must fail before a task is submitted');
console.log('PASS: adaptive MotionFly reference/HD sizing; complete SAM3 generation, original 24 FPS, HD/audio/preview/ZIP connected; KOH (1) unchanged.');
