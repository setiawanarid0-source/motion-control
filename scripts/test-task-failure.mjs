import assert from 'node:assert/strict';
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
assert.equal(await auditFailedH3Tasks({tasks:[task,{...task,taskId:'2114444444444444444'}],
  query:async()=>({code:805,data:{failedReason:{exception_type:'TimeoutError',exception_message:'time limit exceeded',current_inputs:'secret'}}}),
  update:async(id,patch)=>updates.push({id,patch}),log:x=>reports.push(x)}),1);
assert.equal(updates[0].patch.status,'failed');assert.equal(updates[0].patch.failureCategory,'runtime_limit');
assert.ok(!('finishedAt' in updates[0].patch),'Audit must not change elapsed time');
assert.ok(!JSON.stringify(reports).includes('secret'));
assert.equal(await auditFailedH3Tasks({tasks:[{...task,failureAuditCheckedAt:'done'}],query:async()=>{throw Error('Do not retry');},update:()=>{}}),0);
console.log('PASS: RunningHub failedReason extracts node/type/message only; hides traceback and current_inputs.');
