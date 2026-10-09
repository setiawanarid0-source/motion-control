import assert from 'node:assert/strict';
import { extractTaskFailure } from '../task-failure.js';
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
console.log('PASS: RunningHub failedReason extracts node/type/message only; hides traceback and current_inputs.');
