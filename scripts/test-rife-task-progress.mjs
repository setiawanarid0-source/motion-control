import assert from 'node:assert/strict';
import {createRifeExecutionMonitor,observeRegisteredH3Progress} from '../runninghub-execution-trace.js';
import {createRifeProgressRecorder,rifeProgressMessage} from '../rife-task-progress.js';
let clock=0;
const task={taskId:'2110000000000000111',workflow:'RIFE · ≤60 → 60 FPS',status:'running'},writes=[],logs=[];
const registry={get:id=>id===task.taskId?task:null,update:(id,patch)=>{writes.push(patch);Object.assign(task,patch);}};
const record=createRifeProgressRecorder({registry,now:()=>clock,log:r=>logs.push(r)});
class Socket{
  static instances=[];
  constructor(){this.events={};Socket.instances.push(this);}
  addEventListener(name,fn){this.events[name]=fn;}
  close(){this.closed=true;}
  send(type,data){this.events.message({data:JSON.stringify({type,data})});}
}
const monitor=createRifeExecutionMonitor({WebSocketImpl:Socket,log:record,now:()=>clock});
const url='wss://www.runninghub.ai/ws?token=private';
assert.equal(observeRegisteredH3Progress({taskId:task.taskId,url,registry,monitor}),true);
assert.equal(monitor.observe({...task,workflow:'MotionFly'},url),false);
const socket=Socket.instances[0];socket.send('executing',{node:'2',private:'input'});
assert.equal(task.providerProgress.stage,'interpolating');
assert.equal(rifeProgressMessage(task),'Interpolasi ke 60 FPS');
clock=6000;socket.send('progress',{value:10,max:120,private:'input'});
assert.equal(task.providerProgress.value,10,'Native progress without a node uses the preceding executing node');
assert.equal(rifeProgressMessage(task),'Interpolasi ke 60 FPS · 10/120');
clock=6500;socket.send('progress',{value:12,max:120});
assert.equal(task.providerProgress.value,10,'Fast progress is throttled to protect the encrypted registry');
clock=12000;socket.send('executing',{node:'900003'});
assert.equal(task.providerProgress.label,'Mengemas ZIP');
clock=15000;socket.send('execution_success',{});
assert.equal(task.status,'running','Stream success must wait for authoritative task/output polling');
assert.equal(task.providerProgress.stage,'waiting_output');assert.equal(socket.closed,true);
assert.ok(!JSON.stringify({writes,logs}).includes('private'));
task.status='success';const count=writes.length;
record({taskId:task.taskId,event:'node_start',node:'2'});
assert.equal(writes.length,count,'Late progress must never change a completed task');
assert.equal(monitor.observe(task,'wss://attacker.example/ws'),false);
monitor.closeAll();
const unavailable=createRifeProgressRecorder({registry:{get(){throw Error('private vault failure');}}});
assert.doesNotThrow(()=>unavailable({taskId:task.taskId,event:'node_start',node:'2'}));
console.log('RIFE native progress: stage transitions, throttling, privacy and polling ownership passed.');
