import assert from 'node:assert/strict';
import {safeTaskMetrics,auditRifeTasks,nativeTaskExecutionSeconds,RIFE_AUDIT_VERSION} from '../rife-task-audit.js';

assert.equal(nativeTaskExecutionSeconds({taskExecutedTime:'78',taskCostTime:900}),78);
assert.equal(nativeTaskExecutionSeconds({taskCostTime:'24.5'}),24.5);
for(const value of [null,undefined,'',-1,Infinity,'private',604801])assert.equal(nativeTaskExecutionSeconds({taskExecutedTime:value}),null);
assert.deepEqual(safeTaskMetrics({taskExecutedTime:'78',lastUpdateTime:'2026-11-12 09:44:18',
  instanceType:'plus',realInstanceType:'plus',taskName:'private'}),
{taskExecutedTime:'78',lastUpdateTime:'2026-11-12 09:44:18',instanceType:'plus',realInstanceType:'plus'});

assert.deepEqual(safeTaskMetrics({taskCostTime:45,createTime:'2026-11-12T09:43:00Z',
  startTime:'2026-11-12 09:44:00',endTime:1800000000000,duration:'00:01:32',
  token:'private',fileUrl:'https://private.example',prompt:'private',
  queueTime:'private',fps:Infinity,width:-1,height:null,taskTime:{private:true}}),
{taskCostTime:45,createTime:'2026-11-12T09:43:00Z',startTime:'2026-11-12 09:44:00',
  endTime:1800000000000,duration:'00:01:32'});
const now=Date.parse('2026-11-12T10:00:00Z'),calls=[],updates=[],logs=[];
const task=(id,extra={})=>({taskId:id,workflow:'RIFE · ≤60 → 60 FPS',status:'running',
  mode:'plus',submittedAt:'2026-11-12T09:43:00Z',...extra});
const tasks=[task('1',{workflow:'MotionFly'}),task('2',{submittedAt:'2026-11-12T09:59:00Z'}),
  task('3',{rifeAuditCheckedAt:'2026-11-12T09:59:30Z'}),task('4',{status:'success',rifeAuditVersion:RIFE_AUDIT_VERSION,rifeAuditCheckedAt:'2026-11-12T09:55:00Z'}),
  task('5'),task('6',{status:'success'}),task('7')];
await auditRifeTasks({tasks,now:()=>now,query:async t=>{
  calls.push(t.taskId);return {found:true,taskStatus:'SUCCESS',taskMetrics:{taskCostTime:12,accessToken:'private'},
    outputs:[{fileUrl:'https://private.example'}],lookups:[{recordFields:['taskStatus','taskCostTime']}]};
},update:async(id,patch)=>updates.push({id,patch}),log:r=>logs.push(r)});
assert.deepEqual(calls,['5','6'],'only two eligible RIFE tasks are inspected');
assert.deepEqual(updates.map(x=>x.patch.status),['running','success'],'inspection preserves lifecycle state');
assert.ok(updates.every(x=>x.patch.rifeAuditCheckedAt==='2026-11-12T10:00:00.000Z'));
assert.ok(!JSON.stringify(logs).includes('private'),'receipts never log output URLs or arbitrary fields');
assert.equal(logs[0].outputCount,1);assert.equal(logs[0].metrics.taskCostTime,12);
await auditRifeTasks({tasks:[task('8')],now:()=>now,query:async()=>{throw Error('private token');},
  update:async(id,patch)=>updates.push({id,patch}),log:r=>logs.push(r)});
assert.deepEqual(logs.at(-1),{taskId:'8',state:'running',lookupSucceeded:false});
console.log('RIFE task receipts: bounded inspection, stable status and private metadata passed.');
