// Exercise the REAL Account Pool renderer. querySelector selects one element;
// querySelectorAll returns all Remove buttons and supports .forEach.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function renderAccounts(){');
const end=source.indexOf('\nfunction setMedia(',start);
assert.ok(start>0&&end>start,'Account Pool render function must be present');
const code=source.slice(start,end);
assert.ok(code.includes("$$('[data-delete]').forEach"),
  'All Account Pool Remove buttons must use querySelectorAll');
assert.ok(!code.split('\n').some(line=>line.trimStart().startsWith("$('[data-delete]').forEach")),
  'A single element has no forEach method');

const accountList={innerHTML:''};
const state={accounts:[
  {id:'account-alpha',name:'Account 1',status:{remainCoins:450,currentTaskCounts:0},canGenerate:true},
  {id:'account-beta',name:'Account 2',status:{remainCoins:150,currentTaskCounts:0},canGenerate:true}
]};
const buttons=state.accounts.map(a=>({dataset:{delete:a.id},onclick:null}));
const removed=[];
const context={
  state,
  sortedRunningHubAccounts:()=>state.accounts,
  escapeHtml:s=>String(s),
  $:selector=>{assert.equal(selector,'#accountList');return accountList;},
  $$:selector=>{assert.equal(selector,'[data-delete]');return buttons;},
  claimBrowserHistory:async()=>true,
  history:()=>[],
  api:async(url,opts)=>{
    removed.push({url,method:opts?.method});
    return {ok:true};
  },
  loadSession:async()=>{},
  toast:()=>{}
};
vm.runInNewContext(code,context);
assert.doesNotThrow(()=>context.renderAccounts(),
  'Rendering 2 accounts must not throw a forEach TypeError');
assert.ok(accountList.innerHTML.includes('account-alpha'));
assert.ok(accountList.innerHTML.includes('account-beta'));
assert.equal(buttons.filter(x=>typeof x.onclick==='function').length,2,
  'Both Remove buttons must have handlers');
await buttons[0].onclick();
await buttons[1].onclick();
assert.deepEqual(removed.map(x=>x.url),['/api/accounts/account-alpha','/api/accounts/account-beta']);
assert.ok(removed.every(x=>x.method==='DELETE'));
state.accounts=[];
assert.doesNotThrow(()=>context.renderAccounts(),'Empty Account Pool still renders safely');
assert.ok(accountList.innerHTML.includes('Belum ada API key'));
console.log('PASS: Account Pool with 0/2 accounts renders, each Remove button binds and works.');
