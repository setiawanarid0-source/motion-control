import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  explicitQueueMaxed,queueCapacityError,isDefinitelyRejectedAtCapacity,
  mayTryNextAccountAfterCreate
} from '../runninghub-capacity.js';
import {rankGenerationAccounts} from '../runninghub-account-priority.js';

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
const uploads=[],requests=[];
let nextReply=0;
const context={
  uploadToRunningHub:async(key,file)=>{uploads.push([key,file.originalname]);return 'uploaded-'+file.originalname;},
  prepareDiagnosticAssets:()=>null,
  runningHubInstanceType:mode=>mode==='plus'?'plus':'default',
  workflowGraphs:{current:{nodes:'unchanged'}},
  explicitQueueMaxed,queueCapacityError,
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

const accounts=[
  {account:{id:'unusable',addedAt:'2026-10-20T12:00:00Z'},status:{remainCoins:700}},
  {account:{id:'top',addedAt:'2026-10-20T10:00:00Z'},status:{remainCoins:600}},
  {account:{id:'next',addedAt:'2026-10-19T10:00:00Z'},status:{remainCoins:500}},
  {account:{id:'low',addedAt:'2026-10-19T10:00:00Z'},status:{remainCoins:99}}
];
assert.deepEqual(rankGenerationAccounts(accounts).map(x=>x.account.id),['top','next'],
  'Fall back only within 100–600 RH range, highest balance first');
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
console.log('PASS: explicit TASK_QUEUE_MAXED reroutes to next eligible 100–600 RH account, manual choice honored, null/timeout never double charges, real createTask payload/workflow preserved, truthful status');
