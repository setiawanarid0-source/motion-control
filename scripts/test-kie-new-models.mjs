import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import axios from 'axios';
import {KIE_MODELS,buildKieInput,createKieStudio} from '../kie-studio.js';

const contracts=JSON.parse(fs.readFileSync(new URL('./fixtures/kie-seedream55-gpt26.json',import.meta.url))).contracts;
const ids=['seedream55','flare26','sunburst26','economy26'];
const models=ids.map(id=>KIE_MODELS.find(m=>m.id===id));
assert.ok(models.every(Boolean));
for(const model of models)for(const mode of ['create','edit']){
  const schema=contracts.find(c=>c.schema.model.includes(model[mode]))?.schema;
  assert.ok(schema,'Model ID must exist in the captured official KIE contract: '+model[mode]);
  assert.equal(model.promptMinLength||1,schema.prompt.minLength);
  assert.equal(model.promptMaxLength,schema.prompt.maxLength);
  const ratios=mode==='edit'&&model.editAspectRatios?model.editAspectRatios:model.aspectRatios;
  assert.deepEqual(ratios,schema.aspectRatios);
  for(const aspect of ratios)for(const resolution of model.resolutions.length?model.resolutions:['1K']){
    const input=buildKieInput(model,mode,{prompt:'A natural product photograph',aspect,resolution,
      urls:mode==='edit'?['https://example.com/a.png','https://example.com/b.png']:[]});
    assert.ok(Object.keys(input).every(key=>schema.properties.includes(key)),'Never invent provider parameters');
    assert.ok(schema.required.every(key=>Object.hasOwn(input,key)),'All required inputs must be present');
    if(model.resolution)assert.ok(schema[model.resolution].enum.includes(input[model.resolution]));
    if(mode==='edit')assert.equal(input[model.images].length,2);
    assert.equal(input.output_format,'png');
  }
  assert.throws(()=>buildKieInput(model,mode,{prompt:'x'.repeat(model.promptMaxLength+1),aspect:'1:1',resolution:'1K',
    urls:mode==='edit'?['https://example.com/a.png']:[]}),/Prompt/);
}
const seed=models[0],economy=models[3];
assert.throws(()=>buildKieInput(seed,'create',{prompt:'test',aspect:'1:1',resolution:'1K'}),/Prompt/);
assert.throws(()=>buildKieInput(seed,'create',{prompt:'Valid prompt',aspect:'auto',resolution:'2K'}),/Aspect ratio/);
assert.throws(()=>buildKieInput(seed,'create',{prompt:'Valid prompt',aspect:'1:1',resolution:'4K'}),/Resolusi/);
assert.throws(()=>buildKieInput(economy,'create',{prompt:'Valid prompt',aspect:'3:4',resolution:'1K'}),/Aspect ratio/);
assert.throws(()=>buildKieInput(economy,'create',{prompt:'Valid prompt',aspect:'1:1',resolution:'4K'}),/1K/);

// Exercise the real HTTP service with an isolated synthetic vault. Every Axios
// call is intercepted before networking, including reference upload and polling.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-kie-models-'));
const root=path.join(dir,'kie-studio');fs.mkdirSync(root);
const encrypt=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const decrypt=value=>JSON.parse(Buffer.from(value,'base64').toString());
const secret='fixture-key-for-new-model-tests';
fs.writeFileSync(path.join(root,'accounts.enc'),encrypt({accounts:[{
  id:'fixture-account',name:'Account 01',key:secret,state:'ready',credits:50,fingerprint:'fixture',
  lastAttemptAt:new Date().toISOString()}]}));
const calls=[],submissions=[],originalAdapter=axios.defaults.adapter;
let uncertain=false,uploaded=0;
axios.defaults.adapter=async config=>{
  calls.push(config.url);assert.equal(config.headers.get('Authorization'),'Bearer '+secret);
  let data;
  if(config.url==='https://api.kie.ai/api/v1/chat/credit')data=50;
  else if(config.url==='https://kieai.redpandaai.co/api/file-stream-upload'){
    uploaded++;data={downloadUrl:'https://example.com/reference-'+uploaded+'.png'};
  }else if(config.url==='https://api.kie.ai/api/v1/jobs/createTask'){
    const body=JSON.parse(config.data);submissions.push(body);
    assert.ok(!config.data.includes(secret));
    if(uncertain)throw Error('Fixture transport timeout after create');
    data={taskId:'fixture-model-task-'+submissions.length};
  }else if(config.url.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo?')){
    data={state:'success',resultJson:JSON.stringify({resultUrls:['https://example.com/result.png']}),creditsConsumed:3.6};
  }else throw Error('Unexpected provider request '+config.url);
  return {status:200,statusText:'OK',headers:{},config,data:{code:200,data}};
};
const app=express();app.use(express.json());app.use('/api/kie',createKieStudio({dir,encrypt,decrypt}));
const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base='http://127.0.0.1:'+listener.address().port+'/api/kie';
const headers={'X-Vanta-Device':'fixture-model-browser-device-123'};
async function generate(model,mode,fields={}){
  const body=new FormData();
  for(const [key,value] of Object.entries({model:model.id,mode,prompt:'A natural product photograph',
    aspect:'1:1',resolution:model.resolutions.at(-1)||'1K',accountId:'fixture-account',...fields}))body.set(key,value);
  if(mode==='edit')for(const filename of ['first.png','second.png'])
    body.append('references',new Blob(['synthetic-image'],{type:'image/png'}),filename);
  const response=await fetch(base+'/generate',{method:'POST',headers,body});
  return {status:response.status,data:await response.json()};
}
try{
  const listed=await (await fetch(base+'/models',{headers})).json();
  assert.ok(ids.every(id=>listed.models.some(m=>m.id===id)));
  assert.ok(!JSON.stringify(listed).includes(secret));
  const before=calls.length;
  for(const [model,fields] of [[seed,{prompt:'test'}],[seed,{aspect:'auto'}],[economy,{resolution:'4K'}]]){
    const rejected=await generate(model,'create',fields);assert.equal(rejected.status,400);
  }
  assert.equal(calls.length,before,'Invalid model parameters must fail before uploads, credits or paid submission');
  for(const model of models)for(const mode of ['create','edit']){
    const response=await generate(model,mode);assert.equal(response.status,202,JSON.stringify(response.data));
    const payload=submissions.at(-1);assert.equal(payload.model,model[mode]);
    if(mode==='edit')assert.equal(payload.input[model.images].length,2);
    else assert.equal(payload.input[model.images],undefined);
    assert.equal(response.data.task.model,model.id);assert.equal(response.data.task.modelName,model.name);
    const refreshed=await (await fetch(base+'/tasks/'+response.data.task.id,{headers})).json();
    assert.equal(refreshed.task.status,'success');assert.deepEqual(refreshed.task.resultUrls,['https://example.com/result.png']);
  }
  assert.equal(submissions.length,8,'Exactly one submission per Create/Edit action');
  const history=await (await fetch(base+'/tasks',{headers})).json();
  assert.equal(history.tasks.length,8);assert.ok(history.tasks.every(t=>t.status==='success'));
  assert.ok(!JSON.stringify(history).includes(secret));
  uncertain=true;const failed=await generate(models[1],'create');assert.equal(failed.status,502);
  assert.equal(submissions.length,9,'A timed-out create must never retry or spend another account');
  await new Promise(resolve=>setImmediate(resolve));
  console.log('PASS: Seedream 5.5 / GPT Image 2.6 official contracts, Create/Edit HTTP payloads, history results, validation-before-upload and no duplicate paid retry. No live provider requests.');
}finally{
  await new Promise(resolve=>listener.close(resolve));axios.defaults.adapter=originalAdapter;
  fs.rmSync(dir,{recursive:true,force:true});
}
