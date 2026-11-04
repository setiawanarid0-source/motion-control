import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CONTEXT_INSPECT_ROUTE,CONTEXT_NODE,CONTEXT_GUARD,CONTEXT_NEGATIVE,
  contextInspectionGraph,contextInspectionSummary,installH3ContextInspection} from '../h3-context-inspect.js';

for(const check of ['negative-control','registration','signature']){
  const g=contextInspectionGraph(check);
  assert.equal(g.guard.inputs.image,CONTEXT_GUARD);
  assert.ok(!Object.values(g).some(n=>/Sampler|Save|VideoCombine|TextGenerate|RHLora|LoraLoader/.test(n.class_type)),
    'No sampling, model uploads, model adapter loads or video output in compatibility inspection');
  const outputs=Object.keys(g).filter(id=>/^Preview/.test(g[id].class_type));
  assert.equal(outputs.length,1);
  const reachable=new Set();
  const visit=id=>{if(reachable.has(id))return;reachable.add(id);
    for(const input of Object.values(g[id].inputs))if(Array.isArray(input)&&g[input[0]])visit(input[0]);};
  outputs.forEach(visit);
  assert.ok(reachable.has('guard'),'The only output must depend on the invalid image');
  if(check==='signature'){
    for(const id of ['context','model','clip','conditioning','guider'])assert.ok(reachable.has(id));
    assert.equal(g.context.inputs.context_length,124);
    assert.equal(g.context.inputs.context_overlap,39);
  }
}
assert.throws(()=>contextInspectionGraph('arbitrary'));
const rejected=(error,node_errors={})=>({code:1,msg:JSON.stringify({result:false,error,node_errors})});
const missing=name=>rejected({type:'missing_node_type',message:'Node missing: '+name});
const guarded=rejected({type:'prompt_outputs_failed_validation'},{
  guard:{class_type:'LoadImage',errors:[{type:'custom_validation_failed'}]}
});
assert.equal(contextInspectionSummary(missing(CONTEXT_NODE),'registration').status,'unsupported');
assert.equal(contextInspectionSummary(missing(CONTEXT_NEGATIVE),'negative-control').status,'negative_control_passed');
assert.equal(contextInspectionSummary(guarded,'registration').status,'registered');
assert.equal(contextInspectionSummary(guarded,'signature').status,'schema_recognized');
assert.equal(contextInspectionSummary({code:421},'registration').status,'unconfirmed');
assert.equal(contextInspectionSummary(rejected({type:'prompt_outputs_failed_validation'},{
  guard:{class_type:'LoadImage',errors:[{type:'custom_validation_failed'}]},
  context:{class_type:CONTEXT_NODE,errors:[{type:'value_not_in_list'}]}
}),'signature').status,'schema_incompatible');

const root=await fs.mkdtemp(path.join(os.tmpdir(),'context-inspect-'));
const taskId='2117861200645943298',secret='must-never-appear-on-the-page';
const task={workflow:'MiniMax H3 Akatz',key:secret};
let calls=0,cancellations=[];
const build=(name,{probe,owner=true,now=()=>Date.parse('2026-11-04T07:00:00Z')}={})=>{
  const handlers={};
  const app={get:(p,h)=>handlers['GET '+p]=h,post:(p,h)=>handlers['POST '+p]=h};
  installH3ContextInspection({app,rootDir:path.join(root,name),taskId,getTask:()=>task,
    isOwner:()=>owner,now,probe:async(t,g)=>{calls++;assert.equal(t.key,secret);return probe(g);},
    cancelUnexpected:async(t,id)=>{assert.equal(t.key,secret);cancellations.push(id);}});
  return async(method,{origin='https://vanta.test'}={})=>{
    const req={get:n=>n==='origin'?origin:n==='host'?'vanta.test':undefined};
    const res={statusCode:200,body:null,set(){return this;},type(){return this;},
      status(v){this.statusCode=v;return this;},sendStatus(v){this.statusCode=v;return this;},
      send(v){this.body=v;return this;},redirect(code,url){this.statusCode=code;this.body=url;return this;}};
    await handlers[method+' '+CONTEXT_INSPECT_ROUTE](req,res);return res;
  };
};
try{
  const denied=build('denied',{owner:false,probe:()=>{throw Error('Never');}});
  assert.equal((await denied('POST')).statusCode,404);assert.equal(calls,0);
  const expired=build('expired',{now:()=>Date.parse('2026-11-06T00:00:00Z'),probe:()=>{throw Error('Never');}});
  assert.equal((await expired('GET')).statusCode,404);assert.equal(calls,0);
  const unsupportedProbe=g=>g.catalog?.class_type===CONTEXT_NEGATIVE?missing(CONTEXT_NEGATIVE):missing(CONTEXT_NODE);
  const inspect=build('unsupported',{probe:unsupportedProbe});
  assert.equal((await inspect('POST',{origin:'https://foreign.test'})).statusCode,403);
  assert.equal((await inspect('POST',{origin:''})).statusCode,403);assert.equal(calls,0);
  assert.match((await inspect('GET')).body,/not_checked/);
  const responses=await Promise.all([inspect('POST'),inspect('POST')]);
  assert.ok(responses.every(r=>r.statusCode===303));assert.equal(calls,2,'Negative control and registration only, once each');
  const page=(await inspect('GET')).body;assert.match(page,/unsupported/);assert.ok(!page.includes(secret));
  const restarted=build('unsupported',{probe:()=>{throw Error('A saved result must not probe again');}});
  await restarted('POST');assert.equal(calls,2);
  const compatible=build('supported',{probe:g=>g.catalog?.class_type===CONTEXT_NEGATIVE?missing(CONTEXT_NEGATIVE):guarded});
  await compatible('POST');assert.equal(calls,5);
  const supported=(await compatible('GET')).body;
  assert.match(supported,/schema_recognized/);
  assert.match(supported,/gpuExecutionQualified[^\n]*false/);
  assert.ok(!supported.includes(secret));
  const uncertain=build('uncertain',{probe:()=>({code:421})});
  await uncertain('POST');assert.equal(calls,6,'An uncertain negative control halts the sequence');
  const accepted=build('unexpected',{probe:()=>({code:0,data:{taskId:'2118000000000000009'}})});
  await accepted('POST');assert.equal(calls,7);assert.deepEqual(cancellations,['2118000000000000009']);
  const same=build('same-source',{probe:()=>({code:0,data:{taskId}})});
  await same('POST');assert.equal(calls,8);assert.equal(cancellations.length,1,'Never cancel the source task');
  const server=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.ok(server.indexOf('app.use(ownerAuth.requireOwner);')<server.indexOf('installH3ContextInspection({'));
  console.log('PASS: fixed no-sampler checks, mandatory invalid-image output dependency, owner/origin/expiry gates, negative control, durable once-only requests, schema gate and no secret disclosure');
}finally{await fs.rm(root,{recursive:true,force:true});}

