import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const queue=fs.readFileSync(new URL('../generation-queue.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

function section(start,end){
  const i=app.indexOf(start),j=app.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,'Missing actual function: '+start);
  return app.slice(i,j);
}
const actualUpdate=section('function updateGenerate(){','function workflowName(){');
const actualGenerate=section('async function generate(){','function showTask(data){');
const actualAccept=section('function completedSubmission(data){','async function checkSubmission(){');
const actualPoll=section('async function pollTask(){','function selectTaskOutputs(outputs,kind){');
const generateControl=actualUpdate+actualGenerate;
assert.ok(!actualUpdate.includes('!state.task'),'Accepted task must not disable new submission');
assert.ok(!actualGenerate.includes('state.submission||state.task'),'Prior accepted task must not block Generate');
assert.ok(actualGenerate.includes('if(state.task){')&&actualGenerate.includes('clearInterval(state.pollTimer)'),
  'On next submission, old single-task Live poll must stop without cancelling the task');
assert.ok(actualPoll.includes('if(state.task!==tracked)return;'),
  'Late old provider replies must never overwrite the new Live Task state');
assert.ok(html.includes('app.js?v=20261020-independent-runninghub-tasks-v1'),
  'Mobile browser must get fresh JS');
assert.ok(server.includes("taskRegistry.add({taskId:String(task.taskId)"),
  'Original paid task still captured in server registry');
assert.ok(server.includes("setInterval(()=>monitorRegisteredTasks(),25000)"),
  'Server keeps tracking all RunningHub tasks independently');
assert.ok(queue.includes("maxConcurrent=1"),
  'Existing upload/preflight queue remains serial, idempotent per request ID');
assert.ok(server.includes("MAX_NEW_TASK_CREDITS"),
  'Previously agreed <=600 RH policy preserved');

function makeButton(){
  const span={textContent:'Memproses…'};
  return {disabled:false,querySelector(){return span;},span};
}
function eligible(){return {id:'account-A',canGenerate:true,status:{remainCoins:450}};}
function makeState(){
  return {image:{name:'img.png'},video:{name:'vid.mp4'},workflow:'current',mode:'standard',
    accounts:[eligible()],submission:null,task:null,pollTimer:null,registeredTaskIds:new Set()};
}
const state=makeState(),btn=makeButton(),store=new Map(),cleared=[],uploads=[],tracked=[],toasts=[];
const nodes={
  '#generateBtn':btn,'#accountSelect':{value:'auto'},
  '#taskStatus':{textContent:''},'#taskEstimate':{textContent:''},
};
const context={
  state, console,Date,Number,Math,Promise,
  $:sel=>nodes[sel]||{textContent:''},
  lastSam3Diagnostic:()=>null,refreshLabNotice(){},
  FormData:class {items=[];append(k,v){this.items.push([k,v]);}},
  crypto:{randomUUID:()=>'9d37adcf-4ef7-4433-8cd2-5fb9ca950012'},
  localStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)},
  ACTIVE_UPLOAD_KEY:'vantaActiveUploadV1',
  clearInterval:id=>cleared.push(id),toast:(...args)=>toasts.push(args),
  showStartingTask(){},startVisibleTimer(){},
  uploadReferences:async (fd,id)=>{
    uploads.push({id,fields:fd.items});
    return {jobId:id};
  },
  trackSubmission:id=>tracked.push(id),
  api:async()=>null,
  getDeviceId:()=>'device-123'
};
vm.createContext(context);
vm.runInContext(generateControl+'\nthis.updateGenerate=updateGenerate;this.generate=generate;',context);

state.task={taskId:'2109126366731984901',accountId:'account-A',currentState:'running'};
state.pollTimer=123;
context.updateGenerate();
assert.equal(btn.disabled,false,'Generate stays enabled despite previously accepted RunningHub task');
assert.equal(btn.span.textContent,'Generate motion');
await context.generate();
assert.equal(uploads.length,1,'Second generation actually submits its own reference upload');
assert.equal(state.task,null,'Previous Live Task pointer must be detached after its safe handoff');
assert.ok(cleared.includes(123),'Old Live status interval must be released');
assert.equal(tracked.length,1);
assert.equal(state.submission.jobId,tracked[0]);
assert.equal(store.get('vantaActiveUploadV1'),tracked[0],
  'New submission retains request-id recovery for uncertain delivery');
assert.equal(uploads[0].fields.find(x=>x[0]==='accountId')[1],'auto');
assert.equal(uploads[0].fields.find(x=>x[0]==='referenceImage')[1],state.image);
context.updateGenerate();
assert.equal(btn.disabled,true,'No duplicate submission while new reference upload is pending');
await context.generate();
assert.equal(uploads.length,1,'Rapid repeated Generate clicks cannot double charge');

state.submission=null;
state.task={taskId:'2109126366731984902'};
state.pollTimer=321;
state.accounts=[{canGenerate:false}];
context.updateGenerate();
assert.equal(btn.disabled,true,'Account eligibility still blocks when no account has 100–600 RH');
await context.generate();
assert.equal(uploads.length,1,'No submission without eligible RH credit');
assert.equal(state.task.taskId,'2109126366731984902',
  'Failed local eligibility must not abandon previous task tracking');
assert.equal(cleared.includes(321),false);

state.accounts=[eligible()];
state.task={taskId:'2109126366731984903',currentState:'queued'};
state.submission={jobId:'pending-upload'};
context.updateGenerate();
assert.equal(btn.disabled,true,'Reference upload in progress keeps Generate locked');
state.submission=null;
context.updateGenerate();
assert.equal(btn.disabled,false,'New submission allowed as soon as previous upload is acknowledged');

const completed=makeState(),acceptBtn=makeButton(),saved=[],retained=new Set(),calls=[];
completed.submission={jobId:'request-accepted'};
completed.task=null;
completed.registeredTaskIds=retained;
const acceptNodes={'#generateBtn':acceptBtn};
const acceptedContext={
  state:completed,Date,Number,Math,console,
  $:sel=>acceptNodes[sel]||{querySelector:()=>({textContent:''})},
  lastSam3Diagnostic:()=>null,refreshLabNotice(){},
  history:()=>[],clearSubmission(){
    completed.submission=null;
    this.updateGenerate();
  },showTask(){calls.push('showTask');},
  saveHistory:item=>saved.push(item),
  saveReferenceMedia:async()=>{},
  startPolling(){calls.push('startPolling');}
};
vm.createContext(acceptedContext);
vm.runInContext(actualUpdate+actualAccept+
  '\nthis.updateGenerate=updateGenerate;this.completedSubmission=completedSubmission;',acceptedContext);
const task={taskId:'2109126366731984955',accountId:'account-A',
  accountName:'Account 02',submittedAt:'2026-10-20T10:00:00Z',
  workflow:{name:'Current Workflow',outputKind:'video'},taskStatus:'RUNNING',mode:'standard'};
acceptedContext.completedSubmission({task});
assert.equal(saved.length,1,'Accepted task must be added to Motion History');
assert.equal(saved[0].taskId,task.taskId);
assert.equal(saved[0].status,'processing');
assert.ok(retained.has(task.taskId),'Task stays registered for independent server monitoring');
assert.ok(calls.includes('startPolling'),'Latest task still gets Live Task status updates');
assert.equal(acceptBtn.disabled,false,'Generate automatically becomes available when task accepted');
assert.equal(acceptBtn.span.textContent,'Generate motion',
  'Generate button label must reset instead of staying at Memproses…');

// A delayed old-task response must never corrupt a new upload screen.
// Use the actual pollTask() function with a pending provider response.
let resolver;
let rej;
let providerCalls=0,statusMutations=0,finishCalls=0;
const pollingState={task:{taskId:'2109126366731984901',accountId:'account-A',workflow:{outputKind:'video'}}};
const pollCtx={
  state:pollingState,console,Date,Number,Math,
  api:()=>{providerCalls++;return new Promise((res,rejFn)=>{resolver=res;rej=rejFn;});},
  $:()=>{statusMutations++;return{textContent:''}},
  updateHistory:()=>{statusMutations++},
  finishFailed:()=>{finishCalls++},
  finishSuccess:()=>{finishCalls++},
  renderLiveTaskDuration:()=>{statusMutations++},
  selectTaskOutputs:()=>({videoUrl:'https://example.com/vid.mp4'})
};
vm.createContext(pollCtx);
vm.runInContext(actualPoll+'\nthis.pollTask=pollTask;',pollCtx);
const oldPoll=pollCtx.pollTask();
assert.equal(providerCalls,1);
pollingState.task={taskId:'2109126366731984902',accountId:'account-B'};
resolver({state:'success',outputs:[]});
await oldPoll;
assert.equal(finishCalls,0,'Late previous SUCCESS must not finish new task');
assert.equal(statusMutations,0,'Late previous response must not touch newer UI');

const oldPollError=pollCtx.pollTask();
pollingState.task={taskId:'2109126366731984903',accountId:'account-B'};
rej(new Error('Transient old status request'));
await oldPollError;
assert.equal(statusMutations,0,'Old network errors must not overwrite new task status');

console.log('PASS: repeated RunningHub generation without waiting, previous task in History, distinct idempotent request, no overlapping upload, RH eligibility, late poll isolation');
