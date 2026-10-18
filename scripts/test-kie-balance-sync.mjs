import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server=fs.readFileSync(new URL('../kie-studio.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const coreStart=server.indexOf('  const publicAccount=a=>');
const coreEnd=server.indexOf('  const updateTask=(',coreStart);
assert.ok(coreStart>=0&&coreEnd>coreStart,'Credit sync helpers must be present');

let stored=[
  {id:'a',name:'Account 04',fingerprint:'finger-a',key:'secret-a',credits:80,state:'ready',lastCheckedAt:'2026-10-01T00:00:00.000Z'},
  {id:'b',name:'Account 04',fingerprint:'finger-b',key:'secret-b',credits:80,state:'ready',lastCheckedAt:'2026-10-01T00:00:00.000Z'}
];
const providerCredits=new Map([['secret-a',68],['secret-b',56]]);
let calls=0;
let gate=null;
const axios=async request=>{
  calls++;
  assert.equal(request.url,'https://api.kie.ai/api/v1/chat/credit');
  assert.ok(request.headers.Authorization.startsWith('Bearer secret-'));
  assert.ok(request.timeout<=30000);
  if(gate)await gate.promise;
  const key=request.headers.Authorization.slice('Bearer '.length);
  const amount=providerCredits.get(key);
  if(amount==='fail')throw Error('provider temporarily down');
  return {status:200,data:{code:200,msg:'success',data:amount}};
};
const context={getAccounts:()=>structuredClone(stored),save:(file,key,items)=>{
  assert.equal(file,'accounts.enc');assert.equal(key,'accounts');
  stored=structuredClone(items);},accountsFile:'accounts.enc',axios,BASE:'https://api.kie.ai',
  console:{warn(){}},Date,Number,Math,Promise,Map,
  balanceProbes:new Map(),AUTO_BALANCE_MAX_AGE_MS:30000,
  cleanError:e=>String(e.message)};
vm.createContext(context);
vm.runInContext(server.slice(coreStart,coreEnd)+'\nthis.sync={refreshBalances,refreshAccountBalance,publicAccount};',context);

const first=await context.sync.refreshBalances();
assert.deepEqual(Array.from(first,x=>x.credits),[68,56],'First GET must fetch live provider credits, not cached 80');
assert.equal(stored[0].credits,68);
assert.equal(stored[1].credits,56);
assert.equal(calls,2);
const next=await context.sync.refreshBalances();
assert.equal(calls,2,'Repeated rapid reads must respect freshness TTL');
assert.deepEqual(Array.from(next,x=>x.credits),[68,56]);

providerCredits.set('secret-a',44);
const forced=await context.sync.refreshAccountBalance('a',{force:true});
assert.equal(forced.credits,44,'Forced sync must reflect updated credit after spending');
assert.equal(stored[0].credits,44);
assert.equal(stored[1].credits,56,'Refreshing one account must never erase another');

providerCredits.set('secret-a','fail');
const failed=await context.sync.refreshAccountBalance('a',{force:true});
assert.equal(failed.state,'unavailable');
assert.equal(failed.credits,null,'Failed balance fetch must NEVER show stale 44 as live');
assert.equal(stored[0].credits,44,'Last known value remains encrypted for audit, not displayed');
assert.equal(stored[1].credits,56);
providerCredits.set('secret-a',32);
const restored=await context.sync.refreshAccountBalance('a',{force:true});
assert.equal(restored.credits,32);
assert.equal(restored.state,'ready');

let release;
gate={promise:new Promise(resolve=>{release=resolve;})};
providerCredits.set('secret-b',20);
const previousCalls=calls;
const start=context.sync.refreshAccountBalance('b',{force:true});
const concurrent=context.sync.refreshAccountBalance('b',{force:true});
assert.equal(calls,previousCalls+1,'Per-account credit probes must issue only one concurrent provider request');
// Ensure a removed API key cannot be silently reinstated when request completes.
stored=stored.filter(x=>x.id!=='b');
release();await Promise.all([start,concurrent]);
assert.equal(stored.some(x=>x.id==='b'),false,'Deleted account must remain deleted after delayed API response');
gate=null;

// The next account name must be unique even after removals.
const nameLine=server.match(/const nextIndex=([^;]+);/);
assert.ok(nameLine,'Unique future account-number assignment missing');
const nextName=new Function('accounts','return '+nameLine[1]+';');
assert.equal(nextName([{name:'Account 01'},{name:'Account 04'}]),5);
assert.equal(nextName([]),1);

assert.ok(ui.includes("if(becameTerminal||Date.now()-kie.lastAccountsSync>25000)void loadAccounts();"),
  'History polling must update displayed balances after terminal jobs and on interval');
assert.ok(ui.includes("void loadAccounts();")&&ui.includes("await loadTasks();"),
  'Accepted generation must cause balance refresh');
assert.ok(ui.includes("credits:null,state:'unavailable'"),
  'Network errors must not leave falsely current balance on screen');
assert.ok(ui.includes("accountDisplayName(a)"),'Duplicate old account display names must be disambiguated');
assert.ok(server.includes("void refreshAccountBalance(account.id,{force:true})"),
  'Accepted task should recheck provider credits without submitting duplicate jobs');
assert.ok(server.includes("void refreshAccountBalance(task.accountId,{force:true})"),
  'Completed task should recheck provider credits');
assert.ok(server.includes("res.json({accounts:await refreshBalances()})"),
  'Account Pool GET must fetch fresh credits, unlike previous stale-only implementation');
assert.ok(server.includes("if(submitted&&!accepted)"),
  'Keep existing protections against resubmitting uncertain paid tasks');
assert.ok(server.includes("const task={id:taskId,key:account.key"),
  'Keep existing paid task and account ownership');
assert.ok(!server.includes("credits:account.credits -"),
  'Never invent deducted credit amounts');

console.log('PASS: kie.ai live credit sync, stale rejection, task completion refresh, in-flight safety, unique labels and no paid submit changes');
