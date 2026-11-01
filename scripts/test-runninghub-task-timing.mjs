import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {providerExecutionSeconds,taskTimingReport,auditCompletedH3Timings} from '../runninghub-task-timing.js';
import {createTaskRegistry} from '../task-registry.js';
const output=(...times)=>({code:0,data:times.map(taskCostTime=>({taskCostTime}))});
assert.equal(providerExecutionSeconds(output('83','83',83)),83,'Per-file copies of job runtime are not added together');
assert.equal(providerExecutionSeconds(output('0')),0);
assert.equal(providerExecutionSeconds(output('',null,undefined,-1,'bad',Infinity)),null);
assert.equal(providerExecutionSeconds({code:804,data:[{taskCostTime:99}]}),null);
const task={taskId:'2113333333333333333',workflow:'MiniMax H3 · Motion Control · 1080p',status:'success',
  submittedAt:'2026-11-01T00:00:00Z',finishedAt:'2026-11-01T00:21:52Z'};
const summary=taskTimingReport(task,1000);
assert.equal(summary.observedTotalSeconds,1312);
assert.equal(summary.unassignedSeconds,312);
assert.ok(!('queueSeconds' in summary),'Queue time cannot be inferred from aggregate runtime');
assert.equal(taskTimingReport(task,1400).unassignedSeconds,null,'Never invent negative queue/allocation time');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-timing-registry-'));
try{
  const reg=createTaskRegistry({dir,encrypt:JSON.stringify,decrypt:JSON.parse});
  reg.add({...task,accountId:'account',key:'test-key-only',inputDiagnostics:{samplerCount:1}});
  reg.update(task.taskId,{status:'success',finishedAt:task.finishedAt,resultUrl:'https://example.invalid/output.mp4'});
  const calls=[],reports=[];
  await auditCompletedH3Timings({tasks:reg.publicList(),query:async t=>{calls.push(t.taskId);return output('1000');},
    update:reg.update,log:r=>reports.push(r),now:()=>task.finishedAt});
  const saved=reg.get(task.taskId);
  assert.equal(saved.providerRuntimeSeconds,1000);
  assert.equal(saved.finishedAt,task.finishedAt,'Timing audit cannot extend/falsify the displayed elapsed duration');
  assert.equal(saved.status,'success');assert.equal(saved.resultUrl,'https://example.invalid/output.mp4');
  assert.equal(saved.key,'test-key-only');
  assert.equal(reg.publicList()[0].key,undefined);
  assert.equal(reg.publicList()[0].inputDiagnostics.samplerCount,1);
  await auditCompletedH3Timings({tasks:reg.publicList(),query:async()=>{throw Error('must not refetch');},update:reg.update});
  assert.equal(calls.length,1,'No recurring queries for an already-audited completed task');
  assert.equal(reports[0].unassignedSeconds,312);
  const updates=[];
  await auditCompletedH3Timings({tasks:[{...task,taskId:'2114444444444444444'}],query:async()=>{throw Error('transport');},
    update:(id,p)=>updates.push(p),log:r=>reports.push(r)});
  assert.equal(updates[0].status,'success','A diagnostics outage must not mark a successful job failed');
  assert.equal(updates[0].providerRuntimeSeconds,null);
  assert.equal(reports.at(-1).lookupSucceeded,false);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: provider workflow runtime, no per-file double count, bounded read-only audit, preserved task duration/credentials/state and no invented queue time');
