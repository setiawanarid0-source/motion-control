import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskRegistry} from '../task-registry.js';
import { extractTaskFailure,classifyH3Failure,auditFailedH3Tasks } from '../task-failure.js';
const sample={code:805,msg:'APIKEY_TASK_STATUS_ERROR',data:{failedReason:{
  node_id:'492',node_name:'video_stabilizer_classic',exception_type:'TypeError',
  exception_message:'wrong frames argument',traceback:'DO NOT EXPOSE',
  current_inputs:'DO NOT EXPOSE'
}}};
assert.deepEqual(extractTaskFailure(sample),{
 nodeId:'492',nodeName:'video_stabilizer_classic',exceptionType:'TypeError',message:'wrong frames argument'
});
assert.equal(extractTaskFailure({code:805,msg:'APIKEY_TASK_STATUS_ERROR',data:null}),null);
assert.equal(extractTaskFailure({data:{failedReason:'{"node_id":"3","exception_message":"bad input"}'}})?.nodeId,'3');
assert.equal(extractTaskFailure({data:{failedReason:{exception_message:'a'.repeat(1000)}}})?.message.length,400);
assert.ok(!JSON.stringify(extractTaskFailure(sample)).includes('DO NOT EXPOSE'));
assert.equal(classifyH3Failure({data:{failedReason:'Task execution timeout'}}),'runtime_limit');
assert.equal(classifyH3Failure({data:{failedReason:'CUDA out of memory'}}),'out_of_memory');
assert.equal(classifyH3Failure({data:{failedReason:'Task cancelled by user'}}),'cancelled');
const updates=[],reports=[];
const task={taskId:'2113333333333333333',status:'failed',workflow:'MiniMax H3 · Motion Control · 1080p'};
const akatz={...task,taskId:'2117568678426140673',workflow:'MiniMax H3 · Akatz V1.5 Native · 1080p'};
assert.equal(await auditFailedH3Tasks({tasks:[task,{...task,taskId:'2114444444444444444'}],
  query:async()=>({code:805,data:{failedReason:{exception_type:'TimeoutError',exception_message:'time limit exceeded',current_inputs:'secret'}}}),
  update:async(id,patch)=>updates.push({id,patch}),log:x=>reports.push(x)}),1);
assert.equal(updates[0].patch.status,'failed');assert.equal(updates[0].patch.failureCategory,'runtime_limit');
assert.ok(!('finishedAt' in updates[0].patch),'Audit must not change elapsed time');
assert.ok(!JSON.stringify(reports).includes('secret'));
const missing={...akatz,failureAuditCheckedAt:'previous-audit',failureCategory:'unclassified'};
let modernReads=0;
await auditFailedH3Tasks({tasks:[missing],query:async()=>({code:805,data:null}),
  queryV2:async item=>{assert.equal(item.taskId,akatz.taskId);modernReads++;
    return {status:'FAILED',errorCode:'TASK_TIMEOUT',errorMessage:'Maximum execution time exceeded',promptTips:'secret'};},
  update:async(id,patch)=>updates.push({id,patch}),log:x=>reports.push(x)});
assert.equal(modernReads,1);assert.equal(updates.at(-1).patch.failureCategory,'runtime_limit');
assert.ok(updates.at(-1).patch.failureV2CheckedAt);assert.ok(!JSON.stringify(reports).includes('secret'));
assert.equal(await auditFailedH3Tasks({tasks:[{...missing,...updates.at(-1).patch}],
  query:async()=>{throw Error('No recurring audit');},queryV2:async()=>{throw Error('No repeated V2 call');},update:()=>{}}),0);
await auditFailedH3Tasks({tasks:[missing],query:async()=>{throw Error('Transport unavailable');},
  queryV2:async()=>{throw Error('Transport unavailable');},update:async(id,patch)=>updates.push({id,patch})});
assert.ok(updates.at(-1).patch.failureV2CheckedAt,'An unavailable diagnostic cannot create an endless lookup loop');
let detailReads=0;
await auditFailedH3Tasks({tasks:[missing],query:async()=>sample,
  queryV2:async()=>{detailReads++;throw Error('A usable legacy reason needs no fallback');},
  update:async(id,patch)=>updates.push({id,patch})});
assert.equal(detailReads,0);assert.equal(updates.at(-1).patch.failureCategory,'unclassified');
assert.ok(updates.at(-1).patch.failureV2CheckedAt);
assert.equal(await auditFailedH3Tasks({tasks:[{...missing,...updates.at(-1).patch}],
  query:async()=>{throw Error('Unclassified legacy reason already checked');},queryV2:async()=>{},update:()=>{}}),0,
  'An unclassified legacy error must not monopolize the once-only audit queue');
assert.equal(await auditFailedH3Tasks({tasks:[{...task,failureAuditCheckedAt:'done'}],query:async()=>{throw Error('Do not retry');},update:()=>{}}),0);
await auditFailedH3Tasks({tasks:[akatz],query:async()=>({code:805,data:{failedReason:{
  node_id:'104',node_name:'SamplerCustomAdvanced',exception_type:'torch.OutOfMemoryError',
  exception_message:'CUDA out of memory',current_inputs:'secret',traceback:'secret'}}}),
  update:async(id,patch)=>updates.push({id,patch}),log:x=>reports.push(x)});
assert.equal(updates.at(-1).id,akatz.taskId);assert.equal(updates.at(-1).patch.failureCategory,'out_of_memory');
assert.equal(reports.at(-1).nodeName,'SamplerCustomAdvanced');
assert.equal(reports.at(-1).exceptionType,'torch.OutOfMemoryError');
assert.ok(!JSON.stringify(reports).includes('secret'));
console.log('PASS: RunningHub failedReason extracts node/type/message only; hides traceback and current_inputs.');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-failure-audit-'));
try{
  const options={dir,encrypt:JSON.stringify,decrypt:JSON.parse},registry=createTaskRegistry(options);
  registry.add({...akatz,accountId:'fixture-account',key:'fixture-key'});
  registry.update(akatz.taskId,{status:'failed',finishedAt:'2026-11-03T11:25:31Z'});
  await auditFailedH3Tasks({tasks:registry.publicList(),query:async()=>({code:805,data:null}),
    queryV2:async()=>({status:'FAILED',errorCode:'TASK_TIMEOUT',errorMessage:'execution timeout'}),update:registry.update});
  const restarted=createTaskRegistry(options);
  assert.ok(restarted.publicList()[0].failureV2CheckedAt,'The fallback checkpoint must survive a server restart');
  assert.equal(restarted.publicList()[0].finishedAt,'2026-11-03T11:25:31Z');
  assert.equal(await auditFailedH3Tasks({tasks:restarted.publicList(),query:async()=>{throw Error('Already audited');},
    queryV2:async()=>{throw Error('Already audited');},update:restarted.update}),0);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
