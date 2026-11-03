import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  explicitQueueMaxed,queueCapacityError,isDefinitelyRejectedAtCapacity,
  mayTryNextAccountAfterCreate
} from '../runninghub-capacity.js';
import {rankGenerationAccounts} from '../runninghub-account-priority.js';
import {graphValidationError} from '../runninghub-graph-validation.js';

assert.equal(explicitQueueMaxed({code:500,msg:'TASK_QUEUE_MAXED'}),true);
assert.equal(explicitQueueMaxed({code:403,data:{message:'TASK_QUEUE_MAXED: no task slots'}}),true);
for(const reply of [null,{}, {code:0,msg:'success',data:{taskId:'111'}},
  {code:401,msg:'INVALID_API_KEY'}, {code:500,msg:'server failed'},
  {code:429,msg:'Too many requests'}, {msg:'connection interrupted'}])
  assert.equal(explicitQueueMaxed(reply),false,'Only known explicit queue capacity rejection is definite');
assert.equal(isDefinitelyRejectedAtCapacity(queueCapacityError()),true);
assert.equal(mayTryNextAccountAfterCreate({
  error:queueCapacityError(),selectedAccount:'auto',attemptedCreate:true}),true,
  'An explicit queue-capacity rejection is safe to reroute to another paid account');
assert.equal(mayTryNextAccountAfterCreate({
  error:queueCapacityError(),selectedAccount:'account-5',attemptedCreate:true}),false,
  'Manual account selection must not silently spend another account balance');
assert.equal(mayTryNextAccountAfterCreate({
  error:new Error('connect ETIMEDOUT'),selectedAccount:'auto',attemptedCreate:true}),false,
  'Network timeouts after paid create MUST NOT trigger a duplicate create');
assert.equal(mayTryNextAccountAfterCreate({
  error:new Error('unrecognized failure'),selectedAccount:'auto',attemptedCreate:true}),false);
assert.equal(mayTryNextAccountAfterCreate({
  error:new Error('upload failed'),selectedAccount:'auto',attemptedCreate:false}),true,
  'Account auto fallback before a paid submit remains supported');

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const queue=fs.readFileSync(new URL('../generation-queue.js',import.meta.url),'utf8');
const from=server.indexOf('async function createTask(');
const to=server.indexOf('const upload = multer(',from);
assert.ok(from>0&&to>from,'Actual RunningHub createTask function required');
const cut=server.slice(from,to);
const responses=[
  {code:429,msg:'TASK_QUEUE_MAXED',data:null},
  {code:0,msg:'success',data:{taskId:'2109126366731984999',taskStatus:'RUNNING'}}
];
const absentNode={code:500,msg:JSON.stringify({result:false,error:{type:'missing_node_type',message:"Node 'TARA' not found"}})};
assert.equal(graphValidationError(absentNode)?.definitelyRejected,true,'Explicit pre-execution missing-node error is a rejected graph');
assert.equal(graphValidationError({...absentNode,data:{taskId:'2109126366731984999'}}),null,'Accepted task IDs always forbid retry');
assert.equal(graphValidationError({...absentNode,taskId:'2109126366731984999'}),null);
assert.equal(graphValidationError({msg:JSON.stringify({result:false,error:{type:'execution_error'}})}),null);
const uploads=[],requests=[];
let nextReply=0;
const context={
  uploadToRunningHub:async(key,file)=>{uploads.push([key,file.originalname]);return 'uploaded-'+file.originalname;},
  prepareDiagnosticAssets:()=>null,
  runningHubInstanceType:mode=>mode==='plus'?'plus':'default',
  workflowGraphs:{current:{nodes:'unchanged'}},
  explicitQueueMaxed,queueCapacityError,graphValidationError,
  rhJson:async(path,key,payload)=>{
    requests.push({path,key,payload});
    return responses[nextReply++];
  }
};
vm.createContext(context);
vm.runInContext(cut+'\nthis.createTask=createTask;',context);
let startCount=0;
const args={workflowId:'123',workflowKey:'current',mode:'plus',
  imageFile:{originalname:'reference.png'},videoFile:{originalname:'driving.mp4'},
  onBeforeSubmit:()=>{startCount++;}};
await assert.rejects(context.createTask({...args,apiKey:'key-top'}),
  e=>isDefinitelyRejectedAtCapacity(e));
assert.equal(startCount,1);
assert.equal(requests.length,1,'First RunningHub create was explicitly rejected');
assert.equal(requests[0].path,'/task/openapi/create');
const result=await context.createTask({...args,apiKey:'key-next'});
assert.equal(result.taskId,'2109126366731984999');
assert.equal(requests.length,2);
assert.equal(requests[1].key,'key-next');
assert.equal(startCount,2);
assert.equal(result.taskStatus,'RUNNING');
assert.equal(requests[1].payload.instanceType,'plus');
assert.equal(uploads.length,4,'Each selected account receives the two references, without altering workflow');
assert.equal(requests[0].payload.workflow,requests[1].payload.workflow);

responses.push(null);
await assert.rejects(context.createTask({...args,apiKey:'key-timeout'}),
  /RunningHub gagal membuat task/);
assert.equal(explicitQueueMaxed(responses[2]),false,
  'Null/missing acknowledgement remains uncertain (no fallback)');

responses.push({code:500,msg:'NOT_ENOUGH_BALANCE'});
await assert.rejects(context.createTask({...args,apiKey:'key-rejected-balance'}),
  e=>e.code==='RUNNINGHUB_INSUFFICIENT_BALANCE'&&/Task belum dibuat/.test(e.message),
  'Explicit balance rejection without an accepted ID must be shown as a refusal');
for(const reply of [{code:500,msg:'NOT_ENOUGH_BALANCE',taskId:'2109126366731984999'},
  {code:500,msg:'NOT_ENOUGH_BALANCE',data:{taskId:'2109126366731984999'}}]){
  responses.push(reply);
  await assert.rejects(context.createTask({...args,apiKey:'key-with-id'}),
    e=>e.code!=='RUNNINGHUB_INSUFFICIENT_BALANCE',
    'A response containing a task ID cannot be declared unaccepted');
}

// Run the actual account loop and durable worker with mocked provider refusals.
// Neither a failed shared model transfer nor a definite balance rejection may
// loop through accounts or leave the browser polling an uncertain acceptance.
const handlerStart=server.indexOf('async function handleGeneration(');
const handlerEnd=server.indexOf('generationQueue.setExecutor(runQueuedGeneration);',handlerStart);
let attempts=0,saved,refusal,discarded=0;
const worker={...context,IMAGE_MAX:20e6,VIDEO_MAX:100e6,MIN_POOL_CREDITS:100,LOCKED_WORKFLOW_ID:'fixture-workflow',
  workflowGraphs:{current:{}},console:{info(){},warn(){},error(){}},
  getPersistentAccounts:()=>({deviceId:'fixture-device',accounts:[{id:'one',key:'fixture-one'},{id:'two',key:'fixture-two'}]}),
  accountStatus:async()=>({remainCoins:500}),canGenerateWithAccount:()=>true,rankGenerationAccounts,
  stageReferences:async()=>({staged:true}),discardReferences:async()=>{discarded++;},
  taskRegistry:{ensureWritable(){}},
  createTask:async args=>{attempts++;if(refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE')args.onBeforeSubmit();
    throw Object.assign(new Error(refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE'?'Saldo tidak mencukupi. Task belum dibuat.':'Transfer model terhenti.'),{code:refusal});},
  safeH3Profile:()=>null,longH3Profile:()=>null,consistencyH3Profile:()=>null,
  safeH3FaceFocus:()=>null,safeH3Conditioning:()=>null,
  generationQueue:{read:()=>saved,update:(_id,patch)=>{saved={...saved,...patch};}}};
vm.createContext(worker);vm.runInContext(server.slice(handlerStart,handlerEnd)+'\nthis.run=runQueuedGeneration;',worker);
for(refusal of ['H3_MODEL_PREPARATION_FAILED','RUNNINGHUB_INSUFFICIENT_BALANCE']){
  attempts=0;saved={stage:'queued'};
  await worker.run({jobId:'fixture-job',deviceId:'fixture-device',body:{workflow:'current',mode:'plus',accountId:'auto'},
    image:{mimetype:'image/jpeg',originalname:'photo.jpg',size:1},video:{mimetype:'video/mp4',originalname:'driver.mp4',size:1}},
    stage=>{saved.stage=stage;});
  assert.equal(attempts,1,'A definite refusal must not repeat model setup or submit through other accounts');
  assert.equal(saved.stage,'error','The UI must receive a terminal failure, not poll indefinitely');
  assert.equal(saved.failureStage,refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE'?'submitting':'uploading_inputs');
  assert.match(saved.error,refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE'?/Saldo tidak mencukupi/:/Transfer model terhenti/);
}
assert.equal(discarded,2,'Rejected submissions release staged media');

const accounts=[
  {account:{id:'unusable',addedAt:'2026-10-20T12:00:00Z'},status:{remainCoins:700}},
  {account:{id:'top',addedAt:'2026-10-20T10:00:00Z'},status:{remainCoins:600}},
  {account:{id:'next',addedAt:'2026-10-19T10:00:00Z'},status:{remainCoins:500}},
  {account:{id:'low',addedAt:'2026-10-19T10:00:00Z'},status:{remainCoins:99}}
];
assert.deepEqual(rankGenerationAccounts(accounts).map(x=>x.account.id),['unusable','top','next'],
  'Fall back on all accounts with at least 100 RH, highest balance first');
assert.ok(server.includes("if(isDefinitelyRejectedAtCapacity(error)){") &&
  server.includes("req.submissionAttempted=false;"),
  'Server must reset uncertain marker ONLY for definitive queue rejections');
assert.ok(server.includes('mayTryNextAccountAfterCreate({'),
  'Server must explicitly reject ambiguous duplicate paid creates');
assert.ok(server.includes("if(rejectedAtCapacity===candidates.length)"),
  'All accounts full must surface clear refusal instead of unknown paid state');
assert.ok(server.includes("if(req.submissionAttempted){")&&
  server.includes("stage:'uncertain'"),
  'Ambiguous RunningHub create is still not automatically retried');
assert.ok(app.includes("const capacityFull=/TASK_QUEUE_MAXED/i.test(String(data.error||''));"),
  'Frontend should display truthful account-capacity error');
assert.ok(queue.includes("const FINISHED=new Set(['accepted','error','uncertain'])"),
  'Idempotent durable upload queue remains unchanged');
assert.ok(queue.includes("maxConcurrent=1"),
  'One preflight at a time continues protecting uploads without serializing completed paid tasks');
assert.ok(/app\.js\?v=20\d{6}-[a-z0-9-]+/.test(html),
  'Browser cache bust is required for user-visible queue error text');
console.log('PASS: explicit TASK_QUEUE_MAXED reroutes to next eligible 100+ RH account, manual choice honored, null/timeout never double charges, real createTask payload/workflow preserved, truthful status');
