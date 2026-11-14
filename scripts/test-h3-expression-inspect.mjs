import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {EXPRESSION_CHECKS,EXPRESSION_GUARD,EXPRESSION_NEGATIVE,EXPRESSION_INSPECT_TASK,
  EXPRESSION_INSPECT_ROUTE,expressionInspectionGraph,assertExpressionInspectionGraph,
  expressionInspectionSummary,installExpressionInspection} from '../h3-expression-inspect.js';

const rejected=(node_errors,error={type:'prompt_outputs_failed_validation'})=>
  ({code:1,msg:JSON.stringify({result:false,error,node_errors})});
const guard={guard:{class_type:'LoadImage',errors:[{type:'custom_validation_failed'}]}};
const missing=name=>rejected({},{type:'missing_node_type',message:'Node missing: '+name});
const typed=(node,class_type,input)=>rejected({...guard,[node]:{class_type,
  errors:[{type:'return_type_mismatch',extra_info:{input_name:input}}]}});
const successFixture=graph=>{
  if(graph.catalog0?.class_type===EXPRESSION_NEGATIVE)return missing(EXPRESSION_NEGATIVE);
  if(graph.process?.inputs.crop_info?.[0]==='clip')return typed('process','LivePortraitProcess','crop_info');
  if(graph.conditioning?.inputs['ref_videos.ref_video_2']?.[0]==='clip')
    return typed('conditioning','MiniMaxH3ReferenceToVideo','ref_videos.ref_video_2');
  for(const field of ['relative_motion_mode','expression_friendly'])
    if(Array.isArray(graph.process?.inputs[field]))return typed('process','LivePortraitProcess',field);
  return rejected(guard);
};
for(const check of EXPRESSION_CHECKS){
  const graph=expressionInspectionGraph(check);
  assert.equal(assertExpressionInspectionGraph(graph,check),true);
  assert.equal(graph.guard.inputs.image,EXPRESSION_GUARD);
  assert.ok(!Object.values(graph).some(n=>/Sampler|Save|VideoCombine|Encode|Lora/.test(n.class_type)));
  const outputIds=Object.keys(graph).filter(id=>/^Preview/.test(graph[id].class_type));
  for(const output of outputIds){
    const visited=new Set();
    const visit=id=>{if(visited.has(id))return;visited.add(id);
      Object.values(graph[id].inputs).filter(Array.isArray).forEach(v=>{if(graph[v[0]])visit(v[0]);});};
    visit(output);assert.ok(visited.has('guard'),'Every possible output must fail on the missing image');
    if(check==='signature'&&output==='output')
      for(const id of ['pipeline','cropper','source_crop','process','conditioning'])assert.ok(visited.has(id));
  }
  const unsafe=structuredClone(graph);
  unsafe.bypass={class_type:'EmptyImage',inputs:{width:512,height:512,batch_size:1,color:0}};
  unsafe.output.inputs={images:['bypass',0]};
  assert.throws(()=>assertExpressionInspectionGraph(unsafe,check));
}
assert.throws(()=>expressionInspectionGraph('client-graph'));
assert.equal(expressionInspectionSummary(rejected(guard),'source-contract').status,'input_unconfirmed',
  'Ignored or unvalidated optional ports do not establish typed compatibility');
assert.equal(expressionInspectionSummary(rejected(guard),'friendly-contract').status,'input_unconfirmed');
assert.equal(expressionInspectionSummary(typed('process','LivePortraitProcess','other'),'source-contract').status,'schema_incompatible');
assert.equal(expressionInspectionSummary(missing('LivePortraitProcess'),'registration').status,'unsupported');
assert.equal(expressionInspectionSummary({code:0},'signature').status,'unconfirmed');
assert.equal(expressionInspectionSummary({code:421,msg:'SECRET_RAW_PROVIDER_RESPONSE'},'signature').status,'unconfirmed');
assert.equal(expressionInspectionSummary(rejected({}),'signature').status,'schema_incompatible',
  'A response without a positive missing-image guard rejection is not evidence');
assert.equal(expressionInspectionSummary(rejected({...guard,other:{class_type:'Other',errors:[]}}),'signature').status,'schema_incompatible');

const root=await fs.mkdtemp(path.join(os.tmpdir(),'vanta-expression-schema-'));
const secret='PRIVATE_ACCOUNT_FIXTURE_NEVER_DISPLAY';
const original={workflow:'MiniMax H3 Akatz',key:secret};
const servers=[];
async function build(name,{fixture=successFixture,owner=true,expired=false,source=original}={}){
  const app=express();app.use(express.urlencoded({extended:false}));
  const state={calls:0,cancelled:[],reports:[],resolved:0};
  installExpressionInspection({app,rootDir:path.join(root,name),
    now:()=>Date.parse(expired?'2026-11-18T00:00:00Z':'2026-11-14T12:00:00Z'),
    isOwner:()=>owner,getTask:id=>{assert.equal(id,EXPRESSION_INSPECT_TASK);return source;},
    resolveTask:async t=>{assert.equal(t,original);state.resolved++;return {task:{...t,key:'POOL_FIXTURE'}};},
    probe:async(t,g)=>{assert.equal(t.key,'POOL_FIXTURE');state.calls++;return fixture(g);},
    cancelUnexpected:async(t,id)=>{assert.equal(t.key,'POOL_FIXTURE');state.cancelled.push(id);},
    log:report=>state.reports.push(report)});
  const server=app.listen(0,'127.0.0.1');servers.push(server);
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  return {...state,state,request:async(method='GET',options={})=>{
    const response=await fetch(base+EXPRESSION_INSPECT_ROUTE,{method,redirect:'manual',headers:{
      'Content-Type':'application/x-www-form-urlencoded',Origin:options.origin??base},
      ...(method==='POST'?{body:options.body??''}:{})});
    return {status:response.status,headers:response.headers,body:await response.text()};
  }};
}
try{
  const denied=await build('denied',{owner:false});assert.equal((await denied.request('POST')).status,404);
  const expired=await build('expired',{expired:true});assert.equal((await expired.request()).status,404);
  assert.equal(denied.state.calls+expired.state.calls,0);
  const probe=await build('compatible');
  assert.equal((await probe.request('POST',{origin:'https://foreign.test'})).status,403);
  assert.equal((await probe.request('POST',{origin:''})).status,403);
  assert.equal((await probe.request('POST',{body:'graph=arbitrary'})).status,400);
  assert.equal(probe.state.calls,0);assert.match((await probe.request()).body,/not_checked/);
  const concurrent=await Promise.all([probe.request('POST'),probe.request('POST')]);
  assert.ok(concurrent.every(r=>r.status===303));assert.equal(probe.state.calls,EXPRESSION_CHECKS.length);
  assert.equal(probe.state.resolved,1);assert.equal(original.key,secret);
  const page=await probe.request();assert.match(page.body,/schema_recognized/);
  assert.match(page.body,/gpuExecutionQualified[^\n]*false/);assert.match(page.body,/visualQualified[^\n]*false/);
  assert.ok(!page.body.includes(secret)&&!page.body.includes('POOL_FIXTURE'));
  assert.equal(page.headers.get('cache-control'),'private, no-store');
  const restarted=await build('compatible',{fixture:()=>{throw Error('Must not execute again');}});
  await restarted.request('POST');assert.equal(restarted.state.calls,0);
  const unsupported=await build('unsupported',{fixture:g=>g.catalog0.class_type===EXPRESSION_NEGATIVE?
    missing(EXPRESSION_NEGATIVE):missing('LivePortraitProcess')});
  await unsupported.request('POST');assert.equal(unsupported.state.calls,2);
  assert.match((await unsupported.request()).body,/unsupported/);
  const ignored=await build('ignored-field',{fixture:g=>g.catalog0?.class_type===EXPRESSION_NEGATIVE?
    missing(EXPRESSION_NEGATIVE):rejected(guard)});
  await ignored.request('POST');assert.equal(ignored.state.calls,3);
  assert.match((await ignored.request()).body,/input_unconfirmed/);
  const timeout=await build('timeout',{fixture:()=>{throw Error(secret);}});
  await timeout.request('POST');assert.equal(timeout.state.calls,1);
  assert.ok(!(await timeout.request()).body.includes(secret));
  const accepted=await build('accepted',{fixture:()=>({data:{taskId:'2121484132689473999'}})});
  await accepted.request('POST');assert.equal(accepted.state.calls,1);
  assert.deepEqual(accepted.state.cancelled,['2121484132689473999']);
  const old=await build('same-task',{fixture:()=>({data:{taskId:EXPRESSION_INSPECT_TASK}})});
  await old.request('POST');assert.equal(old.state.calls,1);assert.deepEqual(old.state.cancelled,[]);
  const badId=await build('invalid-id',{fixture:()=>({data:{taskId:secret}})});
  await badId.request('POST');assert.deepEqual(badId.state.cancelled,[]);
  assert.ok(!(await badId.request()).body.includes(secret));
  const unavailable=await build('unavailable',{source:null});
  assert.equal((await unavailable.request('POST')).status,409);assert.equal(unavailable.state.calls,0);
  const serverSource=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.ok(serverSource.indexOf('app.use(ownerAuth.requireOwner);')<serverSource.indexOf('installExpressionInspection({'));
  console.log('PASS: expression guard on every output, fixed graph, strict typed controls, real HTTP owner/origin gates, durable once-only execution, fail-closed responses, cancellation scope and secret redaction');
}finally{
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  await fs.rm(root,{recursive:true,force:true});
}
