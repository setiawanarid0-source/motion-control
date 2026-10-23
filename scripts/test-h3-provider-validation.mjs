import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {findValidationRejection,graphValidationError,isDefinitelyRejectedGraph} from '../runninghub-graph-validation.js';
import {mayTryNextAccountAfterCreate} from '../runninghub-capacity.js';

const rejected={result:false,error:{
 type:'prompt_outputs_failed_validation',message:'Prompt outputs failed validation',details:'',extra_info:{}},
 outputs_to_execute:[],node_errors:{
 '1177':{class_type:'BFSShotH3ConditioningSimple',errors:[{message:'Node does not exist'}]},
 '2':{class_type:'UNETLoader',errors:[{message:'Value not in list: model unavailable'}]}
}};
const response={code:500,msg:JSON.stringify(rejected),data:null};
assert.deepEqual(findValidationRejection(response),rejected);
const error=graphValidationError(response);
assert.ok(isDefinitelyRejectedGraph(error));
assert.equal(error.definitelyRejected,true);
assert.match(error.message,/prompt_outputs_failed_validation/);
assert.match(error.message,/1177/);
assert.match(error.message,/BFSShotH3ConditioningSimple/);
assert.match(error.message,/Task tidak diterima/);
assert.equal(mayTryNextAccountAfterCreate({
 error,selectedAccount:'auto',attemptedCreate:true}),false,
 'Never retry a rejected H3 graph on another RunningHub account');

for(const candidate of [
 null,{}, {code:0,data:{taskId:'2110000000000000001'},msg:JSON.stringify(rejected)},
 {code:500,msg:'TASK_QUEUE_MAXED'}, {code:503,msg:'Service unavailable'},
 {code:504,msg:'Gateway Timeout'}, {code:500,msg:'not valid json'}
]){
 assert.equal(graphValidationError(candidate),null,
  'Unknown provider replies or accepted tasks must not be treated as definite graph rejection');
}
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=server.indexOf('async function createTask(');
const end=server.indexOf('const upload = multer(',start);
assert.ok(start>=0&&end>start);
const source=server.slice(start,end);
const requestBody=[];
const context={
 uploadToRunningHub:async (_key,file)=>'uploaded-'+file.originalname,
 prepareDiagnosticAssets:async()=>null,
 buildCharacterSwapWorkflow:()=>({graph:{'1283':{class_type:'BFSShotPlanner',inputs:{plan:'{}'}}},
  nodeInfoList:[{nodeId:'1283',fieldName:'plan',fieldValue:'{}'}]}),
 workflowGraphs:{characterSwap:{}},
 runningHubInstanceType:()=> 'plus',
 explicitQueueMaxed:()=>false,queueCapacityError:()=>null,graphValidationError,
 rhJson:async (_endpoint,_key,payload)=>{requestBody.push(payload);return response;},
 process:{env:{RUNNINGHUB_H3_WORKFLOW_ID:'2110000000000000001'}}
};
vm.createContext(context);
vm.runInContext(source+'\nthis.createTask=createTask;',context);
await assert.rejects(context.createTask({apiKey:'test-no-actual-network',workflowId:'legacy',
 workflowKey:'characterSwap',mode:'plus',imageFile:{originalname:'ref.png'},
 videoFile:{originalname:'guide.mp4'}}),e=>isDefinitelyRejectedGraph(e));
assert.equal(requestBody.length,1);
assert.equal(requestBody[0].workflowId,'2110000000000000001',
 'H3 must use its own workflow ID, never the legacy motion workflow');
assert.equal(requestBody[0].nodeInfoList[0].nodeId,'1283');

const guard=server.indexOf("if(workflowKey==='characterSwap' && !/^");
const firstUpload=server.indexOf("req.progress?.('uploading_inputs')");
assert.ok(guard>=0&&firstUpload>guard,'Block missing H3 configuration before RunningHub upload');
assert.ok(server.includes('req.submissionAttempted=false;') &&
 server.includes('if(isDefinitelyRejectedGraph(error))') &&
 server.includes('break;'),'Explicit graph rejection must be terminal; no cross-account repeat');
assert.ok(server.includes("const validation=graphValidationError(data);") &&
 server.includes('if(validation)throw validation;'));
assert.ok(app.includes('Workflow ditolak RunningHub') &&
 app.includes('Workflow H3 belum tersedia'),
 'Frontend must show provider validation reason rather than uncertain task acceptance');
console.log('PASS: deterministic H3 graph rejection is terminal, shows node details, avoids duplicate paid requests, and requires a dedicated workflow ID.');
