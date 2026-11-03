import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {AKATZ_CHECK_NODES,AKATZ_INVALID_IMAGE,AKATZ_NEGATIVE_NODE,akatzInspectionGraph,akatzInspectionSummary,installAkatzInspection} from '../h3-akatz-inspect.js';
import {H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';

assert.equal(H3_DEFAULT_PROFILE,'guide-dmad4-character-caption');
for(const check of [...AKATZ_CHECK_NODES,'models','negative-control']){
  const graph=akatzInspectionGraph(check);
  assert.equal(graph.guard.inputs.image,AKATZ_INVALID_IMAGE);
  assert.ok(!Object.values(graph).some(n=>/SamplerCustom|KSampler$|VideoCombine|SaveVideo|CreateVideo/.test(n.class_type)),
    'Schema checks must never contain a video generation/output path');
  const outputs=Object.entries(graph).filter(([,n])=>n.class_type==='PreviewImage');
  assert.equal(outputs.length,1);
  const seen=new Set();
  const walk=id=>{if(seen.has(id))return;seen.add(id);for(const v of Object.values(graph[id].inputs))
    if(Array.isArray(v)&&typeof v[0]==='string'&&graph[v[0]])walk(v[0]);};
  walk(outputs[0][0]);assert.ok(seen.has('guard'),'Every output requires a nonexistent image');
  if(check==='models')assert.ok(seen.has('adapter'),'Model-choice validation must reach the loader');
}
assert.throws(()=>akatzInspectionGraph('../../render'));
assert.equal(akatzInspectionGraph('negative-control').catalog.class_type,AKATZ_NEGATIVE_NODE);
const rejected={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},node_errors:{
  guard:{class_type:'LoadImage',errors:[{type:'custom_validation_failed'}]}}})};
assert.equal(akatzInspectionSummary(rejected,'SAM3_Detect').validatorRecognizesNode,true);
const missing={code:1,msg:JSON.stringify({result:false,error:{type:'missing_node_type',message:'H3RelayApplyEditMask'},node_errors:{}})};
assert.deepEqual(akatzInspectionSummary(missing,'H3RelayApplyEditMask').missingNodes,['H3RelayApplyEditMask']);
assert.equal(akatzInspectionSummary(missing,'H3RelayApplyEditMask').validatorRecognizesNode,false);
assert.equal(akatzInspectionSummary({code:421},'SAM3_Detect').status,'unconfirmed');
const choices={code:1,msg:JSON.stringify({result:false,error:{type:'prompt_outputs_failed_validation'},node_errors:{
  turbo:{class_type:'LoraLoaderModelOnly',errors:[{type:'value_not_in_list',details:"Value not in list: ['minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', '../private.safetensors']"}]}}})};
assert.deepEqual(akatzInspectionSummary(choices,'models').models,['minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors']);

const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'akatz-inspect-'));
const token='4'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
const taskId='2117176682029084674',task={taskId,workflow:'MiniMax H3 test',key:'server-secret-must-never-appear'};
let server,calls=0,cancelled=[];
const options={rootDir,taskId,hash,expires:new Date(Date.now()+60000).toISOString(),getTask:id=>id===taskId?task:null,
  probe:async(_task,graph)=>{
    calls++;assert.equal(graph.guard.inputs.image,AKATZ_INVALID_IMAGE);
    if(graph.catalog?.class_type==='EndLoop')return {code:0,data:{taskId:'2117000000000000007'}};
    return rejected;
  },cancelUnexpected:async(_task,id)=>cancelled.push(id)};
try{
  const start=async()=>{
    const app=express();installAkatzInspection({...options,app});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    return 'http://127.0.0.1:'+server.address().port+'/api/internal/h3-akatz-inspect/';
  };
  let url=await start();const headers={'X-Vanta-H3-Inspect':token};
  assert.equal((await fetch(url+'SAM3_Detect',{method:'POST'})).status,404);assert.equal(calls,0);
  assert.equal((await fetch(url+'arbitrary-node',{method:'POST',headers})).status,404);assert.equal(calls,0);
  const results=await Promise.all([1,2].map(()=>fetch(url+'SAM3_Detect',{method:'POST',headers}).then(r=>r.json())));
  assert.ok(results.every(r=>r.validatorRecognizesNode));assert.equal(calls,1);
  assert.ok(!JSON.stringify(results).includes(task.key));
  await new Promise(r=>server.close(r));url=await start();
  await fetch(url+'SAM3_Detect',{method:'POST',headers});assert.equal(calls,1,'Saved checks survive restarts without resubmission');
  const report=await (await fetch(url+'EndLoop',{method:'POST',headers})).json();
  assert.equal(report.cancelled,true);assert.deepEqual(cancelled,['2117000000000000007']);
  assert.equal(calls,2);
  console.log('PASS: no-sampler Akatz checks, mandatory missing-image dependency, expiring private auth, fixed node allowlist, no key disclosure, once-only requests and scoped cancellation');
}finally{if(server)await new Promise(r=>server.close(r));await fs.rm(rootDir,{recursive:true,force:true});}
