import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withRunningHubVideoOutputs,withRunningHubVideoOutputsEditor} from '../runninghub-video-output.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';
import {withIntegratedRife60} from '../integrated-rife.js';
import {runningHubWorkflowContent} from '../runninghub-workflow-content.js';

const read=file=>JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const graph=withIntegratedRife60(compileMotionFlyHD(read('workflows/motionfly-hd-runninghub.json')));
const before=structuredClone(graph),fixed=withOriginalVideoArchive(graph);
assert.deepEqual(graph,before,'Migration cannot mutate the inference recipe');
const changed=Object.keys(fixed).filter(id=>JSON.stringify(fixed[id])!==JSON.stringify(before[id]));
assert.deepEqual(changed,['493'],'MotionFly only changes the encoder feeding its ZIP');
assert.equal(fixed['493'].class_type,'VideoCombineV2');
assert.deepEqual(fixed['493'].inputs,before['493'].inputs,'Frames, audio, 60 FPS, CRF, color format and preview policy stay exact');
assert.deepEqual(fixed['494'],before['494']);assert.deepEqual(fixed['496'],before['496']);
assert.equal(withOriginalVideoArchive(fixed),fixed,'Already migrated graphs cannot add a second encoder or ZIP');
assert.deepEqual(withRunningHubVideoOutputs(fixed),fixed);

const registry=read('workflows/runninghub-web-node-schemas.json');
const declaration=registry.provenance.videoOutputCompatibility.nodes;
assert.deepEqual(declaration.VHS_VideoCombine.output,[]);
assert.deepEqual(declaration.VideoCombineV2.output,['VHS_FILENAMES']);
assert.deepEqual(declaration.VHS_VideoCombine.h264Fields,declaration.VideoCombineV2.h264Fields,
  'The inspected registry declares the same H.264 format controls');
const allowed=new Set([...declaration.VideoCombineV2.inputNames.required,...declaration.VideoCombineV2.inputNames.optional]);
for(const port of registry.nodes.VideoCombineV2.inputs)assert.ok(allowed.has(port.name),port.name);
const serialized=JSON.parse(runningHubWorkflowContent(fixed));
const nodes=new Map(serialized.nodes.map(n=>[n.id,n]));
for(const link of serialized.links){
  const source=nodes.get(link[1]),target=nodes.get(link[3]);
  assert.notEqual(source.type,'VHS_VideoCombine','No execution edge may reference the removed port');
  assert.ok(source.outputs[link[2]].links.includes(link[0]));
  assert.equal(target.inputs[link[4]].link,link[0]);
}
assert.deepEqual(nodes.get(490).outputs,[],'Unlinked original VHS save keeps its current zero-output contract');
assert.equal(nodes.get(493).type,'VideoCombineV2');
assert.deepEqual(nodes.get(493).widgets_values_named,
  Object.fromEntries(Object.entries(fixed['493'].inputs).filter(([,v])=>!Array.isArray(v))),
  'Native serializer retains every explicit scalar widget');

const originalEditor=read('workflows/motionfly-hd-runninghub.json');
const migrated=withRunningHubVideoOutputsEditor(originalEditor);
assert.deepEqual(originalEditor,read('workflows/motionfly-hd-runninghub.json'));
assert.deepEqual(migrated.links,originalEditor.links,'Editor migration keeps every link ID and slot');
for(const original of originalEditor.nodes){
  const node=migrated.nodes.find(n=>n.id===original.id);
  assert.deepEqual(node.inputs,original.inputs);
  assert.deepEqual(node.widgets_values,original.widgets_values);
  if(original.type!=='VHS_VideoCombine')assert.deepEqual(node,original);
  else if(originalEditor.links.some(l=>l[1]===original.id))assert.equal(node.type,'VideoCombineV2');
  else assert.deepEqual(node.outputs,[]);
}
assert.deepEqual(withRunningHubVideoOutputsEditor(migrated),migrated);
const invalid={'1':{class_type:'VHS_VideoCombine',inputs:{}},'2':{class_type:'VHS_SelectFilename',inputs:{filenames:['1',1]}}};
assert.throws(()=>withRunningHubVideoOutputs(invalid),{code:'RH_WEB_INVALID_GRAPH'});
console.log('PASS: removed-port migration preserves MotionFly frames/audio/60 FPS/encoding/ZIP, native prompt/editor links, registered ports, immutable recipes and idempotence');
