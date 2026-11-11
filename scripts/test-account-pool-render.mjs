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
  {id:'account-beta',name:'Account 2',connectionMode:'access-token',status:{remainCoins:150,currentTaskCounts:0},canGenerate:true}
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
assert.ok(accountList.innerHTML.includes('Access token'));
assert.ok(!accountList.innerHTML.includes('API key'));
assert.equal(buttons.filter(x=>typeof x.onclick==='function').length,2,
  'Both Remove buttons must have handlers');
await buttons[0].onclick();
await buttons[1].onclick();
assert.deepEqual(removed.map(x=>x.url),['/api/accounts/account-alpha','/api/accounts/account-beta']);
assert.ok(removed.every(x=>x.method==='DELETE'));
state.accounts=[
  {id:'account-alpha',name:'Account 1',canGenerate:true,status:{apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:'NEW',remainCoins:0,balancePoint:427.5,walletBalance:10.25,currency:'USD',currentTaskCounts:2}},
  {id:'account-beta',name:'Account 2',canGenerate:true,status:{apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:'UNKNOWN',remainCoins:null,balancePoint:null,currentTaskCounts:null}}
];
context.renderAccounts();
assert.ok(accountList.innerHTML.includes('Points 427,5'),'NEW billing must display the real points balance');
assert.ok(accountList.innerHTML.includes('Wallet USD 10,25'),'Wallet currency must remain separate from RH and points');
assert.ok(accountList.innerHTML.includes('Tasks 2'));
assert.ok(accountList.innerHTML.includes('RH lama — · Points belum tersedia'));
assert.ok(accountList.innerHTML.includes('Tasks —'),'Unknown task counts must not become zero');
assert.ok(!accountList.innerHTML.includes('RH 0'),'A funded points account must not be presented as RH zero');
assert.ok(!accountList.innerHTML.includes('Saldo tidak memenuhi syarat'));
state.accounts[0].status.transitionCoinRemained=1734;
context.renderAccounts();assert.ok(accountList.innerHTML.includes('RH 1.734'),'Available transition RH must remain visible alongside points');
state.accounts[0].status.balancePoint=0.0001;
context.renderAccounts();assert.ok(accountList.innerHTML.includes('Points 0,0001'),'Small nonzero balances must not round to zero');
state.accounts=[];
assert.doesNotThrow(()=>context.renderAccounts(),'Empty Account Pool still renders safely');
assert.ok(accountList.innerHTML.includes('Belum ada akun'));
console.log('PASS: Account Pool with 0/2 accounts renders, each Remove button binds and works.');
