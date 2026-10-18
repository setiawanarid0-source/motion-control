import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/vanta-polish.css',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const original=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

const refresh=html.match(/<button\b[^>]*id="refreshAccounts"[^>]*>[\s\S]*?<\/button>/)?.[0]||'';
assert.ok(refresh.includes('aria-label="Perbarui status dan saldo RunningHub"'), 'Refresh must retain accessible label');
assert.match(refresh,/<svg\s[^>]*viewBox="0 0 24 24"/,'Refresh icon must be SVG (font-size:0 hides text glyph)');
assert.match(refresh,/<path\s[^>]*d="M20 7v5h-5"/,'Refresh icon must be visible vector paths');
assert.ok(app.includes("$('#refreshAccounts').onclick=refreshAccounts"),
  'Existing RunningHub refresh action must still be bound');
assert.ok(css.includes('#view-accounts #refreshAccounts svg{')&&css.includes('stroke:currentColor'),
  'Refresh SVG must be sized and colored independently of text font size');
assert.ok(css.includes('#view-accounts #refreshAccounts.refreshing span[aria-hidden="true"]'),
  'Existing refresh animation must work');

const slice=(start,end)=>{
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing app function '+start);return app.slice(a,b);
};
const fmt=slice('function fmtElapsed(ms){','function machineLabel(');
const elapsed=slice('function historyElapsed(item){','function historyStatusLabel(');
const live=slice('function renderLiveTaskDuration(){','function machineLabel(');
const render=slice('function renderHistory(){','async function pollHistoryTasks()');
const show=slice('function showTask(data){','function startPolling(){');
const polling=slice('async function pollTask(){','function selectTaskOutputs(');
const monitor=slice('function startHistoryMonitor(){','function initDropzone(');

const start=Date.parse('2026-10-18T10:00:00.000Z');
const now=start+67*60*1000+12*1000;
const estimate={textContent:'unchanged'};
const state={task:null};
const FakeDate=class extends Date {static now(){return now;}};
const context={state,Date:FakeDate,Number,Math,String,$:selector=>selector==='#taskEstimate'?estimate:null};
vm.createContext(context);
vm.runInContext(fmt+elapsed+live+
  '\nthis.format=fmtElapsed; this.historyElapsed=historyElapsed; this.tick=renderLiveTaskDuration;',context);

assert.equal(context.format(0),'00:00:00');
assert.equal(context.format(125000),'00:02:05');
assert.equal(context.format(3600000+62000),'01:01:02');
assert.equal(context.historyElapsed({status:'queued',startedAt:new Date(start).toISOString()}),null,
  'Queued status should not show generation time');
assert.equal(context.historyElapsed({status:'uploading',startedAt:new Date(start).toISOString()}),null,
  'Upload must not count toward RunningHub generation time');
assert.equal(context.historyElapsed({status:'running',startedAt:new Date(start).toISOString()}),4032000,
  'Running task duration must come from submittedAt');
assert.equal(context.historyElapsed({status:'processing',startedAt:new Date(start).toISOString()}),4032000);
assert.equal(context.historyElapsed({status:'check_error',startedAt:new Date(start).toISOString()}),4032000,
  'Clock must stay readable during provider status retry');
assert.equal(context.historyElapsed({status:'success',startedAt:new Date(start).toISOString(),
  finishedAt:new Date(start+50000).toISOString()}),50000,
  'Completed task must stop increasing from actual finishedAt');
assert.equal(context.historyElapsed({status:'success',runtimeMs:78000,startedAt:new Date(start).toISOString()}),78000,
  'Use saved actual duration when available');
assert.equal(context.historyElapsed({status:'success',startedAt:new Date(start).toISOString()}),null,
  'Do not fabricate a duration for historical data missing finish timestamp');

state.task={submittedAt:new Date(start).toISOString(),currentState:'queued'};
context.tick();
assert.equal(estimate.textContent,'unchanged','Queued task must not display RunningHub running timer');
state.task.currentState='running';context.tick();
assert.equal(estimate.textContent,'Sejak dikirim · 01:07:12','Live timer must show correct hh:mm:ss');
state.task.currentState='check_error';context.tick();
assert.equal(estimate.textContent,'Sejak dikirim · 01:07:12','Clock should not overwrite error message');
state.task=null;context.tick();
assert.equal(estimate.textContent,'Sejak dikirim · 01:07:12','Clock stops when there is no active task');

assert.ok(render.includes('const elapsed=historyElapsed(x);')&&render.includes('class="history-duration"'),
  'History status card must display time');
assert.ok(render.includes('${duration}${error}'), 'Status must include duration beside RunningHub state');
assert.ok(render.includes('Dihitung sejak task diterima RunningHub'),'Duration must be accurately described');
assert.ok(show.includes('renderLiveTaskDuration();'),'Live Task must draw its timer at accepted state');
assert.ok(polling.includes('state.task.currentState=data.state;')&&polling.includes('renderLiveTaskDuration();'),
  'RunningHub provider status polling must control timing');
assert.ok(monitor.includes('renderLiveTaskDuration();')&&monitor.includes("if(state.view==='history'){")&&monitor.includes('renderHistory();'),
  'Both timers must reuse existing 1 second clock');
assert.equal((monitor.match(/setInterval/g)||[]).length,3,'Do not introduce additional polling timers');
assert.ok(!original.includes('MAX_NEW_TASK_CREDITS=700'),'RunningHub 600 RH account policy stays in place');
assert.ok(html.includes('/app.js?v=20261018-runninghub-duration-refresh-v1'),
  'Fresh frontend asset version must be deployed');
console.log('PASS: RunningHub Refresh SVG visible with existing click handler; task time restored from submission, updated live/History, frozen on success, no new polling');
