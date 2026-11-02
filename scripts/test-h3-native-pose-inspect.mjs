import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {nativePoseValidationGraph,poseValidationSummary,installNativePoseInspection,POSE_PROBE_MARKER} from '../h3-native-pose-inspect.js';

const graph=nativePoseValidationGraph();
assert.equal(graph['5'].inputs.name,POSE_PROBE_MARKER);
assert.ok(POSE_PROBE_MARKER.endsWith('.invalid'));
assert.deepEqual(graph['7'].inputs.control_video,['20',0],'Only drawn pose may reach Fun control');
assert.deepEqual(graph['9'].inputs.model,graph['11'].inputs.model,'The patched model reaches guider and scheduler');
assert.ok(!Object.values(graph).some(n=>n.class_type==='MiniMaxH3AddGuide'||n.class_type==='LoadImage'));
const ancestors=new Set();
function visit(id){if(ancestors.has(id))return;ancestors.add(id);for(const v of Object.values(graph[id].inputs))
  if(Array.isArray(v)&&typeof v[0]==='string'&&graph[v[0]])visit(v[0]);}
visit('490');assert.equal(ancestors.size,Object.keys(graph).length);
assert.ok(ancestors.has('5'),'The only output must require the deliberately invalid patch');
const checkpointGraph=nativePoseValidationGraph('checkpoint');
assert.equal(checkpointGraph['21'].inputs.name,POSE_PROBE_MARKER);
assert.equal(checkpointGraph['5'].inputs.name,'minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors');
assert.deepEqual(checkpointGraph['9'].inputs.model,['22',0]);
assert.deepEqual(checkpointGraph['11'].inputs.model,['22',0]);
assert.throws(()=>nativePoseValidationGraph('render'));
assert.equal(poseValidationSummary({code:0,data:{taskId:'2117000000000000001'}}).status,'unexpected_acceptance');
const reject={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},node_errors:{5:{
 class_type:'ModelPatchLoader',errors:[{type:'value_not_in_list',extra_info:{input_config:[['minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors','secret-value','../hidden.safetensors']]}}]}}})};
assert.deepEqual(poseValidationSummary(reject).nodes[0].models,['minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors']);
const detailReject=structuredClone(reject);const detail=JSON.parse(detailReject.msg);
detail.node_errors['5'].errors[0].extra_info={};
detail.node_errors['5'].errors[0].details="Value not in list: ['控制/minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors']";
detailReject.msg=JSON.stringify(detail);
assert.deepEqual(poseValidationSummary(detailReject).nodes[0].models,['控制/minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors']);
assert.equal(poseValidationSummary({code:500}).status,'unconfirmed');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'h3-pose-probe-')),token='8'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
const taskId='2117176682029084674',task={taskId,status:'success',workflow:'MiniMax H3 · Motion Control · 1080p',key:'must-never-leave-server',inputDiagnostics:{frames:361}};
let server,calls=0;
try{
 const image=path.join(dir,'reference.jpg');await fs.writeFile(image,'preview fixture');
 const app=express();
 const options={app,rootDir:dir,getTask:id=>id===taskId?task:null,getReference:(_id,kind)=>kind==='image'?image:null,
  taskId,hash,expires:new Date(Date.now()+60000).toISOString(),probe:async(_task,g)=>{
   calls++;assert.ok(g['5'].inputs.name===POSE_PROBE_MARKER||g['21']?.inputs.name===POSE_PROBE_MARKER);return reject;}};
 installNativePoseInspection(options);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/api/internal/h3-native-pose-inspect',headers={'X-Vanta-H3-Inspect':token};
 assert.equal((await fetch(url)).status,404);assert.equal(calls,0);
 const meta=await (await fetch(url,{headers})).text();assert.ok(!meta.includes(task.key));
 assert.equal((await fetch(url+'/source/keys',{headers})).status,404);
 assert.equal(await (await fetch(url+'/source/image',{headers})).text(),'preview fixture');
 const results=await Promise.all([1,2].map(()=>fetch(url+'/validate',{method:'POST',headers}).then(r=>r.json())));
 assert.ok(results.every(r=>r.status==='rejected_before_execution'));assert.equal(calls,1);
 const named=await (await fetch(url+'/validate-checkpoint',{method:'POST',headers})).json();
 assert.equal(named.status,'rejected_before_execution');assert.equal(calls,2);
 await fetch(url+'/validate-checkpoint',{method:'POST',headers});assert.equal(calls,2);
 // A new process with the same durable checkpoint must not send another request.
 await new Promise(r=>server.close(r));const app2=express();installNativePoseInspection({...options,app:app2});
 server=app2.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 await fetch('http://127.0.0.1:'+server.address().port+'/api/internal/h3-native-pose-inspect/validate',{method:'POST',headers});
 assert.equal(calls,2);
 const disabled=express();installNativePoseInspection({...options,app:disabled,hash:''});
 console.log('PASS: native pose-only validation graph, required invalid patch, private task scope, no credential leakage and durable once-only provider check');
}finally{if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
