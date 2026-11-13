import {withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS} from '../integrated-rife.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';
import assert from 'node:assert/strict';
import {isRunningHubWebKey} from '../runninghub-web-session.js';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  explicitQueueMaxed,queueCapacityError,isDefinitelyRejectedAtCapacity,
  mayTryNextAccountAfterCreate
} from '../runninghub-capacity.js';
import {rankGenerationAccounts} from '../runninghub-account-priority.js';
import {graphValidationError,isDefinitelyRejectedGraph} from '../runninghub-graph-validation.js';
import {rifeGraphForSourceFps,rifeBatchSize,RIFE_TARGET_FPS} from '../rife-video.js';

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
const context={withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS,withOriginalVideoArchive,
  isRunningHubWebKey,runningHubWeb:{prepare:async()=>{}},
  uploadToRunningHub:async(key,file)=>{uploads.push([key,file.originalname]);return 'uploaded-'+file.originalname;},
  prepareDiagnosticAssets:()=>null,
  runningHubInstanceType:mode=>mode==='plus'?'plus':'default',
  workflowGraphs:{current:JSON.parse(fs.readFileSync(new URL('../workflows/current-api.json',import.meta.url),'utf8')),rife60:JSON.parse(fs.readFileSync(new URL('../workflows/rife60-api.json',import.meta.url),'utf8'))},
  rifeGraphForSourceFps,RIFE_TARGET_FPS,
  explicitQueueMaxed,queueCapacityError,isDefinitelyRejectedAtCapacity,mayTryNextAccountAfterCreate,
  graphValidationError,isDefinitelyRejectedGraph,
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
const paidMessage='Insufficient paid RH coins. Consumer API keys can only spend paid RH coins; free RH coins are not accepted.';
const rifeArgs={...args,workflowKey:'rife60',imageFile:undefined,sourceFps:40,
  videoFile:{originalname:'two-seconds-40fps.mp4'}};
for(const reply of [{code:402,msg:paidMessage},{code:500,message:paidMessage},
  {code:500,data:{message:paidMessage.replaceAll(' ','\n')}}]){
  responses.push(reply);
  await assert.rejects(context.createTask({...rifeArgs,apiKey:'fixture-consumer'}),
    e=>e.code==='RUNNINGHUB_PAID_BALANCE_REQUIRED'&&e.definitelyRejected===true&&
      /Insufficient paid RH coins/.test(e.message)&&/Task belum dibuat/.test(e.message));
  const sent=requests.at(-1).payload;
  assert.equal(sent.nodeInfoList.find(x=>x.nodeId==='2'&&x.fieldName==='source_fps').fieldValue,40);
  assert.equal(sent.nodeInfoList.find(x=>x.nodeId==='2'&&x.fieldName==='target_fps').fieldValue,60);
  assert.equal(sent.retainSeconds,undefined);
}
for(const reply of [{msg:paidMessage},{code:'unknown',msg:paidMessage},{code:true,msg:paidMessage},{code:0,msg:paidMessage},
  {code:402,msg:paidMessage,taskId:'2109126366731984999'},
  {code:402,msg:paidMessage,data:{taskId:'2109126366731984999'}},
  {code:500,msg:'Insufficient balance'},
  {code:500,msg:'Connection lost after '+paidMessage}]){
  responses.push(reply);
  await assert.rejects(context.createTask({...rifeArgs,apiKey:'fixture-unconfirmed'}),
    e=>e.code!=='RUNNINGHUB_PAID_BALANCE_REQUIRED',
    'A task ID, contradictory success or arbitrary prose is never an unaccepted billing proof');
}
const normalRequest=context.rhJson;
context.rhJson=async()=>{throw new Error(paidMessage);};
await assert.rejects(context.createTask({...rifeArgs,apiKey:'fixture-transport'}),
  e=>e.code!=='RUNNINGHUB_PAID_BALANCE_REQUIRED','A thrown transport error is not a structured provider refusal');
context.rhJson=normalRequest;

// Neither a failed shared model transfer nor a definite balance rejection may
// loop through accounts or leave the browser polling an uncertain acceptance.
const handlerStart=server.indexOf('async function handleGeneration(');
const handlerEnd=server.indexOf('generationQueue.setExecutor(runQueuedGeneration);',handlerStart);
let attempts=0,saved,refusal,discarded=0;
const registered=[];
let pool=[{id:'one',name:'Account 01',key:'rhweb:'+'1'.repeat(64)},{id:'two',name:'Account 02',key:'rhweb:'+'2'.repeat(64)}];
const worker={...context,rifeBatchSize,IMAGE_MAX:20e6,VIDEO_MAX:100e6,MIN_POOL_CREDITS:100,LOCKED_WORKFLOW_ID:'fixture-workflow',
  isRunningHubWebKey,
  workflowGraphs:{current:{},rife60:context.workflowGraphs.rife60},
  workflowMeta:{current:{name:'Current'},rife60:{name:'RIFE',outputKind:'video'}},
  console:{info(){},warn(){},error(){}},
  verifyRifeInput:async()=>({sourceFps:40}),
  prepareAdaptiveRifeVideo:async file=>({file,sourceFps:40,adaptive:false,async release(){}}),
  getPersistentAccounts:()=>({deviceId:'fixture-device',accounts:pool}),
  accountStatus:async()=>({remainCoins:500}),canGenerateWithAccount:()=>true,rankGenerationAccounts,
  stageReferences:async()=>({staged:true}),discardReferences:async()=>{discarded++;},
  taskRegistry:{ensureWritable(){},add(task){registered.push(task);}},
  observeH3Progress(){},commitReferences:async()=>({video:true,image:true}),loadGlobalAccounts:()=>[],
  createTask:async args=>{attempts++;
    if(refusal==='RUNNINGHUB_PAID_BALANCE_REQUIRED')return context.createTask(args);
    if(refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE')args.onBeforeSubmit();
    throw Object.assign(new Error(refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE'?'Saldo tidak mencukupi. Task belum dibuat.':'Transfer model terhenti.'),{code:refusal});},
  safeH3Profile:()=>null,longH3Profile:()=>null,consistencyH3Profile:()=>null,
  safeH3FaceFocus:()=>null,safeH3Conditioning:()=>null,
  generationQueue:{read:()=>saved,update:(_id,patch)=>{saved={...saved,...patch};}}};
vm.createContext(worker);vm.runInContext(server.slice(handlerStart,handlerEnd)+'\nthis.run=runQueuedGeneration;',worker);
for(refusal of ['H3_MODEL_PREPARATION_FAILED','RUNNINGHUB_INSUFFICIENT_BALANCE','RUNNINGHUB_PAID_BALANCE_REQUIRED']){
  attempts=0;saved={stage:'queued'};
  const paid=refusal==='RUNNINGHUB_PAID_BALANCE_REQUIRED';
  if(paid)responses.push({code:402,msg:paidMessage});
  await worker.run({jobId:'fixture-job',deviceId:'fixture-device',body:{workflow:paid?'rife60':'current',mode:'plus',accountId:paid?'one':'auto'},
    image:{mimetype:'image/jpeg',originalname:'photo.jpg',size:1},video:{mimetype:'video/mp4',originalname:'driver.mp4',size:1}},
    stage=>{saved.stage=stage;});
  assert.equal(attempts,1,'A definite refusal must not repeat model setup or submit through other accounts');
  assert.equal(saved.stage,'error','The UI must receive a terminal failure, not poll indefinitely');
  assert.equal(saved.failureStage,refusal==='H3_MODEL_PREPARATION_FAILED'?'uploading_inputs':'submitting');
  assert.match(saved.error,paid?/Insufficient paid RH coins/:refusal==='RUNNINGHUB_INSUFFICIENT_BALANCE'?/Saldo tidak mencukupi/:/Transfer model terhenti/);
  if(paid)assert.equal(saved.failureCode,'RUNNINGHUB_PAID_BALANCE_REQUIRED');
}
assert.equal(discarded,3,'Rejected submissions release staged media');
// Render the actual Live Task failure function with the durable worker result.
const fields=new Map();
const ui={data:saved,modelProgressBar(){},$:selector=>{
  if(!fields.has(selector))fields.set(selector,{textContent:'',classList:{add(){},remove(){}}});
  return fields.get(selector);
}};
vm.createContext(ui);
vm.runInContext(app.slice(app.indexOf('function displaySubmissionFailure('),
  app.indexOf('async function restoreRecentRifeFailure('))+'\ndisplaySubmissionFailure(data);',ui);
assert.equal(fields.get('#taskStatus').textContent,'Pengiriman ditolak RunningHub');
assert.match(fields.get('#taskFailureDetail').textContent,/API RunningHub.*Insufficient paid RH coins/);
ui.data={stage:'uncertain',error:'Acknowledgement lost'};
vm.runInContext('displaySubmissionFailure(data);',ui);
assert.equal(fields.get('#taskStatus').textContent,'Status penerimaan belum pasti',
  'Real acknowledgement loss must retain its duplicate-submission warning');

// Actual RIFE create + account loop + durable worker: only explicit, taskless
// refusals may move an Automatic request to another account. No live APIs.
async function runRifeReplies(replies,{accountId='auto',workflow='rife60',accountCount=2,web=false}={}){
  responses.push(...replies);attempts=0;registered.length=0;saved={stage:'queued'};
  pool=[{id:'one',name:'Account 01',key:'rhweb:'+'1'.repeat(64)},
    {id:'two',name:'Account 02',key:'rhweb:'+'2'.repeat(64)},
    ...(accountCount===3?[{id:'zzz',name:'Account 03',key:'rhweb:'+'3'.repeat(64)}]:[])];
  if(web){pool[0].key='legacy-api-fixture';pool[1].key='rhweb:'+'b'.repeat(64);}
  refusal='RUNNINGHUB_PAID_BALANCE_REQUIRED';
  const before=requests.length;
  await worker.run({jobId:'fixture-job',deviceId:'fixture-device',body:{workflow,mode:'plus',accountId},
    image:{mimetype:'image/jpeg',originalname:'photo.jpg',size:1},
    video:{mimetype:'video/mp4',originalname:'two-second-source.mp4',size:1}},
    (stage,_message,details)=>{saved.stage=stage;if(details?.account)saved.submissionAccount=details.account;});
  return requests.slice(before);
}
const refused={code:402,msg:paidMessage};
const accepted={code:0,msg:'success',data:{taskId:'2119000000000000001',taskStatus:'RUNNING'}};
await runRifeReplies([{code:380,msg:'WORKFLOW_NOT_EXISTS'}]);
assert.equal(attempts,1);assert.equal(saved.stage,'error');assert.equal(registered.length,0);
assert.equal(saved.failureCode,'RH_WEB_WORKSPACE_NOT_FOUND');assert.match(saved.error,/WORKFLOW_NOT_EXISTS/);
ui.data=saved;vm.runInContext('displaySubmissionFailure(data);',ui);
assert.equal(fields.get('#taskStatus').textContent,'Workflow tidak ditemukan');
assert.doesNotMatch(fields.get('#taskFailureDetail').textContent,/belum pasti|saldo/i);
for(const reply of [{code:0,msg:'WORKFLOW_NOT_EXISTS'},
  {code:380,msg:'WORKFLOW_NOT_EXISTS',taskId:'2119000000000000001'}]){
  await runRifeReplies([reply]);assert.equal(attempts,1);assert.equal(saved.stage,'uncertain');
}
const rerouted=await runRifeReplies([refused,accepted]);
assert.equal(attempts,2);assert.equal(saved.stage,'accepted');
assert.equal(registered.length,1,'Exactly one accepted task is registered');
assert.equal(registered[0].accountId,'two');
assert.equal(saved.task.accountId,'two');
assert.deepEqual(JSON.parse(JSON.stringify(saved.submissionAccount)),{id:'two',name:'Account 02',mode:'plus'});
assert.equal(rerouted[0].payload.workflow,rerouted[1].payload.workflow);
assert.equal(rerouted[1].payload.instanceType,'plus');
assert.equal(rerouted[1].payload.nodeInfoList.find(x=>x.fieldName==='source_fps').fieldValue,40);
assert.equal(rerouted[1].payload.nodeInfoList.find(x=>x.fieldName==='target_fps').fieldValue,60);

await runRifeReplies([refused,refused]);
assert.equal(attempts,2);assert.equal(saved.stage,'error');
assert.equal(saved.failureStage,'submitting');assert.equal(registered.length,0);
assert.match(saved.error,/menolak 2 akun.*Tidak ada task yang dibuat/);

await runRifeReplies([accepted],{accountCount:3});
assert.equal(attempts,1);assert.equal(saved.stage,'accepted');assert.equal(registered.length,1);
await runRifeReplies([refused,{code:421,msg:'TASK_QUEUE_MAXED'},accepted],{accountCount:3});
assert.equal(attempts,3);assert.equal(saved.stage,'accepted');assert.equal(registered.length,1);

await runRifeReplies([refused,null],{accountCount:3});
assert.equal(attempts,2);assert.equal(saved.stage,'uncertain');assert.equal(registered.length,0);
for(const response of [null,{msg:paidMessage},{code:'unknown',msg:paidMessage},{code:true,msg:paidMessage},{code:0,msg:paidMessage},
  {code:402,msg:paidMessage,taskId:'2119000000000000001'},
  {code:402,msg:paidMessage,data:{taskId:'2119000000000000001'}}]){
  await runRifeReplies([response],{accountCount:3});
  assert.equal(attempts,1,'Unknown or contradictory acknowledgement cannot reach another account');
  assert.equal(saved.stage,'uncertain');assert.equal(registered.length,0);
}
context.rhJson=async()=>{throw Object.assign(new Error('ETIMEDOUT'),{code:'ETIMEDOUT'});};
await runRifeReplies([],{accountCount:3});
assert.equal(attempts,1);assert.equal(saved.stage,'uncertain','A transport timeout cannot reroute');
context.rhJson=normalRequest;
const originalAdd=worker.taskRegistry.add;
worker.taskRegistry.add=()=>{throw Error('registry unavailable');};
await runRifeReplies([accepted],{accountCount:3});
assert.equal(attempts,1);assert.equal(saved.stage,'accepted');
assert.equal(saved.task.trackingRegistered,false,'A local registry failure cannot reroute an accepted create');
worker.taskRegistry.add=originalAdd;
await runRifeReplies([refused],{accountId:'one',accountCount:3});
assert.equal(attempts,1);assert.equal(saved.stage,'error','Manual account choice stays fixed');
await runRifeReplies([refused],{workflow:'current',accountCount:3});
assert.equal(attempts,1);assert.equal(saved.stage,'error','Other workflow billing behavior stays fixed');
ui.data={stage:'uncertain',failureStage:'submitting',error:'Acknowledgement lost',
  submissionAccount:{id:'two',name:'Account 02',mode:'plus'}};
vm.runInContext('displaySubmissionFailure(data);',ui);
assert.equal(fields.get('#taskAccount').textContent,'Account 02');

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

const webOnly=await runRifeReplies([accepted],{web:true});
assert.equal(attempts,1);assert.equal(registered[0].accountId,'two');
assert.equal(webOnly[0].key,'rhweb:'+'b'.repeat(64),'Automatic selects the web account when web and API accounts coexist');
await runRifeReplies([refused],{web:true});
assert.equal(attempts,1,'Web refusal must not spill into a paid API account');
assert.equal(saved.stage,'error');
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
console.log('PASS: RIFE Automatic reroutes exact taskless billing refusals, stops after acceptance or uncertainty, preserves manual/other workflow choices and 40-to-60 payload, and attributes the selected account');
