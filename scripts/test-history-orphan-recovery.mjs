import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const gallery=fs.readFileSync(new URL('../public/history-gallery.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function section(start,end){
  const i=app.indexOf(start),j=app.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,'Actual function missing: '+start);
  return app.slice(i,j);
}
const status=section('function isActiveHistoryStatus(status){','function historyElapsed(item){');
const polling=section('async function pollHistoryTasks(){','function referenceLink(taskId,kind,accountId){');
const entries=[{taskId:'2111065333379493889',accountId:'retired-account',status:'processing'}];
let calls=0;
const state={historyPollBusy:false,registeredTaskIds:new Set(),task:null};
const ctx={
  state,console,JSON,String,Date,
  history:()=>entries,
  resolveHistoryAccountId:item=>item.accountId,
  updateHistory:(id,patch)=>Object.assign(entries.find(x=>x.taskId===id),patch),
  api:async()=>{calls++;throw Object.assign(new Error('Account missing'),{status:409});}
};
vm.createContext(ctx);
vm.runInContext(status+polling+'\nthis.pollHistoryTasks=pollHistoryTasks;',ctx);
await ctx.pollHistoryTasks();
assert.equal(entries[0].status,'unavailable','Missing account should be recoverable');
assert.equal(calls,1);
await ctx.pollHistoryTasks();
await ctx.pollHistoryTasks();
assert.equal(calls,1,'Orphaned task must not poll every eight seconds forever');
assert.equal(state.historyPollBusy,false);
entries[0]={taskId:'2111065333379493889',accountId:'retired-account',status:'processing'};
ctx.api=async()=>{calls++;throw Object.assign(new Error('Temporary 502'),{status:502});};
await ctx.pollHistoryTasks();
assert.equal(entries[0].status,'check_error','Transient errors must remain retryable');
await ctx.pollHistoryTasks();
assert.equal(calls,3,'Temporary errors should retry');
entries[0]={taskId:'2111065333379493889',accountId:'',status:'processing'};
await ctx.pollHistoryTasks();
assert.equal(entries[0].status,'unavailable','Missing account ID must be recoverable');
assert.equal(calls,3,'No account ID means no futile provider request');
assert.ok(app.includes('async recover(item){') && app.includes("+'/recover',{method:'POST',body:'{}'}"),'Orphan History recovery call must stay available');
assert.ok(gallery.includes('data-nora-action="recover"')&&gallery.includes("adapter?.recover?.(item)"));
assert.ok(/app\.js\?v=20\d{6}-[a-z0-9-]+/.test(html) &&
  html.includes('/history-gallery.js?v=20261021-history-recovery-v1'));
assert.ok(!polling.includes('/task/openapi/create')&&!polling.includes('/task/openapi/delete'));
console.log('PASS: 409 orphan tasks stop polling; transient errors retry; gallery recovery never creates paid tasks');
