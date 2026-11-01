import assert from 'node:assert/strict';
import {createExecutionTrace,createH3ExecutionMonitor,allowedProgressUrl,h3NodeClass} from '../runninghub-execution-trace.js';
const plan={revision:'motion-transfer-native-1080-v2',samplerCount:1};
assert.equal(h3NodeClass('1010',plan),'SamplerCustomAdvanced');
assert.equal(h3NodeClass('1004',plan),'MiniMaxH3ReferenceToVideo');
assert.equal(h3NodeClass('1040',plan),null);
assert.equal(h3NodeClass('1010',{}),null);
for(const url of ['wss://www.runninghub.ai/ws?token=private','wss://worker.runninghub.cn/ws'])assert.ok(allowedProgressUrl(url));
for(const url of ['ws://www.runninghub.ai/ws','wss://127.0.0.1/ws','wss://runninghub.ai.attacker.invalid/ws',
  'wss://user:secret@www.runninghub.ai/ws','wss://www.runninghub.ai:8080/ws'])assert.ok(!allowedProgressUrl(url));
let clock=0;const events=[];
const trace=createExecutionTrace({taskId:'2113333333333333333',plan,now:()=>clock,emit:x=>events.push(x)});
const send=(type,data)=>trace.message(JSON.stringify({type,data}));
trace.message(new Uint8Array([0,1,2]));trace.message('not-json');
send('executing',{node:'1004',prompt:'must not be logged'});
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
console.log('PASS: read-only H3 node timing, partial-stream timestamps, binary/privacy guards, trusted WSS destinations and terminal cleanup; no task submission');
