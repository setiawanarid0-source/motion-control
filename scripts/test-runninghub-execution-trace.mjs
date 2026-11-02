import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createExecutionTrace,createH3ExecutionMonitor,allowedProgressUrl,h3NodeClass,observeRegisteredH3Progress} from '../runninghub-execution-trace.js';
const plan={revision:'motion-transfer-native-1080-v2',samplerCount:1};
assert.equal(h3NodeClass('1010',plan),'SamplerCustomAdvanced');
assert.equal(h3NodeClass('1004',plan),'MiniMaxH3ReferenceToVideo');
assert.equal(h3NodeClass('1040',plan),null);
assert.equal(h3NodeClass('1010',{}),null);
assert.equal(h3NodeClass('9',{...plan,inferenceProfile:'tara-native'}),'BFSMiniMaxH3NativeTemporal');
assert.equal(h3NodeClass('9',{...plan,inferenceProfile:'guide-kitchen'}),'ModelAttentionBackend');
assert.equal(h3NodeClass('10',{...plan,inferenceProfile:'guide-sol-focus'}),'BlockSparseAttention');
assert.equal(h3NodeClass('32',{...plan,inferenceProfile:'guide-sol-focus'}),'ImageCrop');
assert.equal(h3NodeClass('1010',{...plan,revision:'motion-transfer-native-1080-v4'}),'SamplerCustomAdvanced');
assert.equal(h3NodeClass('1010',{...plan,revision:'motion-transfer-native-1080-v5'}),'SamplerCustomAdvanced');
const character={revision:'motion-transfer-native-1080-v6',inferenceProfile:'guide-dmad4-character-caption',samplerCount:3};
for(const [node,type] of Object.entries({7:'RHLoraLoader',9:'ModelAttentionBackend',10:'BlockSparseAttention',85:'CLIPLoader',86:'TextGenerate',
  1010:'SamplerCustomAdvanced',1036:'ImageFromBatch',1044:'ImageFromBatch',1045:'ImageBatch',1074:'ImageFromBatch',1075:'ImageBatch'}))
  assert.equal(h3NodeClass(node,character),type,'Production character node '+node+' must remain observable');
assert.equal(h3NodeClass('1105',character),null,'Never classify a non-existent continuation window');
for(const url of ['wss://www.runninghub.ai/ws?token=private','wss://worker.runninghub.cn/ws'])assert.ok(allowedProgressUrl(url));
for(const url of ['ws://www.runninghub.ai/ws','wss://127.0.0.1/ws','wss://runninghub.ai.attacker.invalid/ws',
  'wss://user:secret@www.runninghub.ai/ws','wss://www.runninghub.ai:8080/ws'])assert.ok(!allowedProgressUrl(url));
let clock=0;const events=[];
const trace=createExecutionTrace({taskId:'2113333333333333333',plan,now:()=>clock,emit:x=>events.push(x)});
const send=(type,data)=>trace.message(JSON.stringify({type,data}));
trace.message(new Uint8Array([0,1,2]));trace.message('not-json');
for(const invalid of ['null','[]','true','42','{"type":"executing","data":{"node":{"toString":"private"}}}'])
  assert.doesNotThrow(()=>trace.message(invalid),'Malformed provider messages must not crash the web service');
send('executing',{node:'1004',prompt:'must not be logged'});
send('bfs-tara-monitor',{node:'9',phase:'evaluating',evaluation:1,backend:'flash partitions (no compile)',
  motion_rows:100,packed_rows:1000,prompt:'private-reference',url:'private-url'});
const telemetry=events.find(e=>e.event==='temporal_evaluation');
assert.equal(telemetry.packed_rows,1000);
assert.ok(!JSON.stringify(telemetry).includes('private'));
clock=5000;send('executing',{node:'1010'});
clock=8000;send('progress',{node:'1010',value:1,max:8,secret:'private'});
send('progress',{node:'1010',value:1,max:8});
clock=20000;send('executing',{node:'1011'});
clock=21000;send('execution_success',{outputs:['private-url']});
assert.equal(events.filter(x=>x.event==='progress').length,1,'Duplicate progress must not flood logs');
assert.deepEqual(events.filter(x=>x.event==='node_end').map(x=>[x.node,x.observedSeconds,x.partial]),
  [['1004',5,false],['1010',15,false],['1011',1,false]]);
assert.ok(!JSON.stringify(events).includes('private'));assert.ok(!JSON.stringify(events).includes('prompt'));
// A connection made mid-node must not claim the entire node's elapsed time.
const partial=[];clock=100;
const joined=createExecutionTrace({taskId:'2113333333333333333',plan,now:()=>clock,emit:x=>partial.push(x)});
joined.message(JSON.stringify({type:'progress',data:{node:'1010',value:4,max:8}}));
clock=10100;joined.message(JSON.stringify({type:'execution_success',data:{}}));
assert.equal(partial.find(x=>x.event==='node_end').partial,true);
assert.equal(partial.find(x=>x.event==='node_end').observedSeconds,10);
class Socket{
  static instances=[];
  constructor(url){this.url=url;this.listeners={};this.closed=false;Socket.instances.push(this);}
  addEventListener(name,fn){this.listeners[name]=fn;}
  close(){this.closed=true;}
}
const logs=[],monitor=createH3ExecutionMonitor({WebSocketImpl:Socket,log:x=>logs.push(x),now:()=>clock});
const task={taskId:'2113333333333333333',workflow:'MiniMax H3 · Motion Control · 1080p',inputDiagnostics:plan};
const url='wss://www.runninghub.ai/ws?token=do-not-log';
assert.equal(monitor.observe(task,url),true);assert.equal(monitor.observe(task,url),false);
Socket.instances[0].listeners.open();
Socket.instances[0].listeners.message({data:JSON.stringify({type:'progress',data:{node:'1010',value:3,max:8}})});
assert.ok(!JSON.stringify(logs).includes('do-not-log'));
monitor.retain([]);assert.equal(Socket.instances[0].closed,true);
assert.equal(monitor.observe({...task,workflow:'Other workflow'},url),false);
monitor.closeAll();
// The browser polls with an account-only credential object. Exercise the actual
// status function and verify tracing resolves the task's workflow and node plan.
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const statusSource=source.slice(source.indexOf('async function runningHubTaskState('),source.indexOf('let monitorBusy=false;'));
const received=[];
const stored={...task,key:'private-task-key',accountId:'private-account-id',status:'running'};
let lookups=0;
const registry={get(id){lookups++;assert.equal(id,task.taskId);return stored;}};
const observer={observe(item,progress){received.push({item,progress});return true;}};
const observe=(taskId,url)=>observeRegisteredH3Progress({taskId,url,registry,monitor:observer});
const state=vm.runInNewContext(statusSource+';runningHubTaskState',{
  rhJson:async()=>({code:804,data:{netWssUrl:url}}),observeH3Progress:observe
});
assert.equal((await state(task.taskId,{key:'private-task-key'},'private-account-id')).state,'running');
assert.equal(received.length,1);
assert.deepEqual(received[0].item,task);
assert.ok(!JSON.stringify(received[0].item).includes('private'));
// Accepted-create observation is within the post-registration, protected path.
const accepted=source.slice(source.indexOf('let trackingRegistered=false;'),source.indexOf('let referencesStored=false;'));
assert.ok(accepted.indexOf('trackingRegistered=true;')<accepted.indexOf('observeH3Progress(task.taskId,task.netWssUrl)'));
assert.ok(accepted.includes('if(trackingRegistered)observeH3Progress(task.taskId,task.netWssUrl);'));
assert.equal(observe(task.taskId,'wss://attacker.invalid/ws'),false);
assert.equal(lookups,1,'Untrusted progress URLs must not trigger task lookup');
stored.status='success';assert.equal(observe(task.taskId,url),false);
assert.equal(received.length,1,'Completed tasks must not open a progress stream');
assert.doesNotThrow(()=>observeRegisteredH3Progress({taskId:task.taskId,url,
  registry:{get(){throw Error('vault unavailable');}},monitor:observer}));
stored.status='running';
assert.equal(observeRegisteredH3Progress({taskId:task.taskId,url,registry,
  monitor:{observe(){throw Error('optional diagnostics unavailable');}}}),false,
  'Observer failure cannot fail an accepted paid submission');
console.log('PASS: read-only H3 node timing, partial-stream timestamps, binary/privacy guards, trusted WSS destinations and terminal cleanup; no task submission');

// Only the fixed private inventory profile may return its text outside the log.
const captured=[],privateLog=[];
const captionTrace=createExecutionTrace({taskId:'2113333333333333333',plan:{revision:'motion-transfer-native-1080-v6',inferenceProfile:'native-photo-inventory-check'},emit:e=>privateLog.push(e),diagnosticText:e=>captured.push(e)});
const captionEvent=(node,text)=>JSON.stringify({type:'executed',data:{node,output:{text}}});
captionTrace.message(captionEvent('86',['private photo inventory']));
captionTrace.message(captionEvent('495',[{secret:'reject'}]));
captionTrace.message(captionEvent('495',['x'.repeat(8001)]));
assert.equal(captured.length,0);
captionTrace.message(captionEvent('495',['private photo inventory']));
assert.deepEqual(captured,[{taskId:'2113333333333333333',text:'private photo inventory'}]);
assert.ok(!JSON.stringify(privateLog).includes('private photo inventory'));
const ordinaryTrace=createExecutionTrace({taskId:'2113333333333333334',plan:{revision:'motion-transfer-native-1080-v6',inferenceProfile:'native-fun-global4-face-attributes'},emit:e=>privateLog.push(e),diagnosticText:e=>captured.push(e)});
ordinaryTrace.message(captionEvent('495',['must not be captured']));assert.equal(captured.length,1);
