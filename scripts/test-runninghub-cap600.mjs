import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MAX_NEW_TASK_CREDITS,canGenerateWithAccount,rankGenerationAccounts} from '../runninghub-account-priority.js';
import {canStartNewTask,partitionAccountRefresh} from '../account-eligibility.js';

assert.equal(MAX_NEW_TASK_CREDITS,600);
for(const [status,expected] of [
  [{remainCoins:600,currentTaskCounts:3},true],
  [{remainCoins:599.99},true],
  [{remainCoins:100},true],
  [{remainCoins:99},false],
  [{remainCoins:600.01},false],
  [{remainCoins:700},false],
  [{remainCoins:2500},false],
  [{remainCoins:null},false],
  [{error:'network',remainCoins:600},false],
  [null,false],
]){
  assert.equal(canGenerateWithAccount(status),expected,'Wrong eligibility for '+JSON.stringify(status));
}
const entry=(id,credits,addedAt='2026-10-17T10:00:00.000Z',lastUsedAt=null,tasks=0)=>
  ({account:{id,name:id,addedAt,lastUsedAt},status:{remainCoins:credits,currentTaskCounts:tasks}});
const checked=[
  entry('protected-1000',1000),
  entry('old600',600,'2026-10-14T10:00:00.000Z','2026-10-16T11:00:00.000Z',0),
  entry('new600',600,'2026-10-18T10:00:00.000Z',null,2),
  entry('older600unused',600,'2026-10-16T10:00:00.000Z',null,0),
  entry('fresh590',590,'2026-10-18T11:00:00.000Z'),
  entry('mid480',480),
  entry('low100',100),
  entry('expired99',99),
  {account:{id:'offline'},status:{error:'upstream failed'}},
];
const copy=JSON.stringify(checked);
const ranked=rankGenerationAccounts(checked).map(x=>x.account.id);
assert.deepEqual(ranked,['new600','older600unused','old600','fresh590','mid480','low100'],
  'Highest eligible credits first, newer unused key wins equal credit, >600 excluded');
assert.equal(JSON.stringify(checked),copy,'Sorting must not mutate the account vault representation');
assert.deepEqual(rankGenerationAccounts([entry('high',800),entry('low',50)]),[],
  'No eligible accounts means zero candidates and no paid RunningHub request');
assert.deepEqual(rankGenerationAccounts([entry('ready',600),entry('blocked',900)])
  .map(x=>x.account.id),['ready'],'Over-600 keys cannot appear in auto generation candidates');
// 600 RH not used up? Next refresh at 599 still ranks above lower accounts.
// Current RH account-retirement rules must remain unchanged and never erase >600.
assert.equal(canStartNewTask({remainCoins:700}),true,'Original minimum-credit helper unchanged for account addition');
assert.deepEqual(partitionAccountRefresh([entry('high',800),entry('low',99)]).retained.map(x=>x.account.id),
  ['high'],'Above-limit accounts remain stored in pool rather than being deleted');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const browser=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const backend=server.slice(server.indexOf('let candidates=[]'),server.indexOf("if(workflowKey==='r15'){",server.indexOf('let candidates=[]')));
assert.ok(backend.includes('if(!canGenerateWithAccount(status,MIN_POOL_CREDITS,MAX_NEW_TASK_CREDITS))'),
  'Manual selection must enforce credit cap on backend after fresh balance check');
assert.ok(backend.includes('rankGenerationAccounts(checked,MIN_POOL_CREDITS,MAX_NEW_TASK_CREDITS)'),
  'Automatic selection must use cap and priority after live status refresh');
assert.ok(server.includes('canGenerate: canGenerateWithAccount(status, MIN_POOL_CREDITS, MAX_NEW_TASK_CREDITS)'),
  'Browser account readiness must accurately match backend cap');
assert.ok(server.includes('partitionAccountRefresh(checked,MIN_POOL_CREDITS)'),
  'Old below-100 automatic retirement preserved, >600 never auto deleted');
assert.ok(server.includes('taskRegistry.add({taskId:'),
  'Existing RunningHub task monitoring retained');
assert.ok(!backend.includes('x.s.currentTaskCounts-y.s.currentTaskCounts'),
  'Old task-count-first ranking must not override balance priority');
assert.ok(browser.includes('sortedRunningHubAccounts().map(a=>'),
  'Pool cards must render sorted by credit');
assert.ok(browser.includes('protectedBalance'),
  'Above-600 pool accounts must visibly indicate restriction');
assert.ok(browser.includes('a.canGenerate===false?\'disabled\''),
  'Manual UI cannot select protected account');
// Run actual browser comparator with mocked account state, not static search alone.
const begin=browser.indexOf('function sortedRunningHubAccounts(){');
const end=browser.indexOf('function renderAccountSelect(){',begin);
assert.ok(begin>=0&&end>begin);
const js=browser.slice(begin,end);
const context={state:{accounts:[
  {id:'missing',status:null},
  {id:'500',status:{remainCoins:500},addedAt:'2026-10-17T09:00:00.000Z'},
  {id:'over',status:{remainCoins:901},addedAt:'2026-10-18T09:00:00.000Z'},
  {id:'600old',status:{remainCoins:600},addedAt:'2026-10-15T09:00:00.000Z'},
  {id:'600new',status:{remainCoins:600},addedAt:'2026-10-18T09:00:00.000Z'},
]}};vm.createContext(context);
const got=Array.from(vm.runInContext(js+'\nsortedRunningHubAccounts().map(x=>x.id)',context));
assert.deepEqual(got,['over','600new','600old','500','missing'],
  'Account Pool visual sorting is DESC by credit, including >600 keys for visibility');
assert.equal(context.state.accounts[0].id,'missing','UI sorting cannot reorder encrypted vault data');
console.log('PASS: RH 100–600 new-task policy, newest 600 first, fallback balances, over-600 blocked even manually, descending pool sorting, history/retirement unchanged');
