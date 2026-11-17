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
const fundingStart=source.indexOf('function runningHubPoolFunding(');
const fundingEnd=source.indexOf('function updatePoolSummary(',fundingStart);
assert.ok(fundingStart>0&&fundingEnd>fundingStart);
const fundingCode=source.slice(fundingStart,fundingEnd);
vm.runInNewContext(fundingCode+'\n'+code,context);
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
    billingVersion:'NEW',remainCoins:0,transitionCoinRemained:0,balancePoint:427.5,walletBalance:10.25,currency:'USD',currentTaskCounts:2}},
  {id:'account-beta',name:'Account 2',canGenerate:true,status:{apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:'UNKNOWN',remainCoins:null,balancePoint:null,currentTaskCounts:null}}
];
context.renderAccounts();
assert.ok(accountList.innerHTML.includes('Points 427,5'),'NEW billing must display the real points balance');
assert.ok(accountList.innerHTML.includes('Wallet USD 10,25'),'Wallet currency must remain separate from RH and points');
assert.ok(accountList.innerHTML.includes('Tasks 2'));
assert.ok(accountList.innerHTML.includes('RH lama — · Points belum tersedia'));
assert.ok(accountList.innerHTML.includes('Tasks —'),'Unknown task counts must not become zero');
assert.ok(accountList.innerHTML.includes('RH 0'),'Known zero RH must remain visible alongside points');
state.accounts[0].status.transitionCoinRemained=null;context.renderAccounts();
assert.ok(accountList.innerHTML.includes('RH —'),'Unknown RH must remain unknown instead of being fabricated as zero');
assert.ok(!accountList.innerHTML.includes('Saldo tidak memenuhi syarat'));
state.accounts[0].status.transitionCoinRemained=1734;
context.renderAccounts();assert.ok(accountList.innerHTML.includes('RH 1.734'),'Available transition RH must remain visible alongside points');
state.accounts[0].status.balancePoint=0.0001;
context.renderAccounts();assert.ok(accountList.innerHTML.includes('Points 0,0001'),'Small nonzero balances must not round to zero');
state.accounts[0].status.sessionRenewal={state:'renewed',refreshedAt:'2026-11-11T10:00:00Z'};
context.renderAccounts();assert.match(accountList.innerHTML,/Token diperbarui 17[.:]00 WIB/);
state.accounts[0].status.sessionRenewal={state:'failed',code:'RH_WEB_REFRESH_MISSING'};
context.renderAccounts();assert.ok(accountList.innerHTML.includes('refresh token belum tersimpan'));
assert.ok(accountList.innerHTML.includes('Saldo terverifikasi'),'A still-valid funded access token remains usable when refresh credentials are absent');

state.accounts=[
  {id:'funded',name:'Funded',canGenerate:true,status:{apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:'NEW',balancePoint:30,transitionCoinRemained:0,dailyCredit:{state:'claimed',amount:30}}},
  ...['unknown-a','unknown-b','unknown-c'].map(id=>({id,name:id,canGenerate:true,status:{
    apiType:'WEB_SESSION',sessionVerified:true,billingVersion:'NEW',balancePoint:null,transitionCoinRemained:0,
    dailyCredit:{state:'claimed',amount:30}}}))
];
context.renderAccounts();
assert.equal((accountList.innerHTML.match(/Klaim harian dikonfirmasi; saldo belum terverifikasi/g)||[]).length,3);
assert.equal((accountList.innerHTML.match(/\+30 points/g)||[]).length,1,'A reward receipt must not masquerade as a verified balance');
assert.ok(accountList.innerHTML.includes('Sesi aktif · saldo belum terverifikasi'));
assert.ok(state.accounts.every(a=>a.canGenerate),'Incomplete funding must not block access-token submission');
const poolNodes={poolCount:{},poolCredits:{},poolReadyUnit:{},poolDot:{classList:{toggle(){}}}};
let generateUpdates=0;
const summaryContext={state:{view:'accounts',accounts:state.accounts},
  $:selector=>poolNodes[selector.slice(1)],updateGenerate:()=>generateUpdates++};
const summaryStart=source.indexOf('function updatePoolSummary(){');
const summaryEnd=source.indexOf('function renderAccounts(){',summaryStart);
vm.runInNewContext(fundingCode+'\n'+source.slice(summaryStart,summaryEnd),summaryContext);
summaryContext.updatePoolSummary();
assert.equal(poolNodes.poolCount.textContent,'1 akun bersaldo');
assert.equal(poolNodes.poolCredits.textContent,'1');
assert.equal(poolNodes.poolReadyUnit.textContent,'akun bersaldo');
assert.equal(generateUpdates,1);
state.accounts[1].status.balancePoint=0;
context.renderAccounts();
assert.ok(accountList.innerHTML.includes('Sesi aktif · saldo 0'),'Confirmed zero must be distinct from an unreadable ledger');
summaryContext.updatePoolSummary();
assert.equal(poolNodes.poolCount.textContent,'1 akun bersaldo');
state.accounts[2].status.transitionCoinRemained=200;
summaryContext.updatePoolSummary();
assert.equal(poolNodes.poolCount.textContent,'2 akun bersaldo','Verified transition RH remains usable when points are missing');
state.accounts[3].status.balancePoint=-12.5;
context.renderAccounts();
assert.ok(accountList.innerHTML.includes('Points -12,5'),'The owner must see the signed provider ledger');
assert.ok(accountList.innerHTML.includes('Saldo points negatif'));
assert.ok(accountList.innerHTML.includes('Klaim harian dikonfirmasi; saldo points masih negatif'));
summaryContext.updatePoolSummary();
assert.equal(poolNodes.poolCount.textContent,'2 akun bersaldo','A negative point-only balance is not funded');
state.accounts[3].status.transitionCoinRemained=1000;
summaryContext.updatePoolSummary();
assert.equal(poolNodes.poolCount.textContent,'3 akun bersaldo','Negative points must not hide positive transition RH');


state.accounts=[];
assert.doesNotThrow(()=>context.renderAccounts(),'Empty Account Pool still renders safely');
assert.ok(accountList.innerHTML.includes('Belum ada akun'));
const refreshStart=source.indexOf('async function refreshAccounts(');
const refreshEnd=source.indexOf('function updatePoolSummary(',refreshStart);
const feedback=[],refreshButton={classList:{add(){},remove(){}}};let requests=0,failed=0;
const labels={poolLastChecked:{},poolLastTokenRefresh:{},poolRefreshNotice:{}};
const refreshContext={state:{accounts:[{id:'fixture'}]},$:selector=>selector==='#refreshAccounts'?refreshButton:labels[selector.slice(1)]||null,
  renderAccounts(){},updatePoolSummary(){},renderAccountSelect(){},
  api:async(route,options)=>{
    requests++;
    if(options){assert.equal(route,'/api/accounts/refresh');assert.equal(options.method,'POST');}
    else assert.equal(route,'/api/accounts/status','Background UI synchronization only reads backend receipts');
    return {accounts:[{id:'fixture'}],tokenRenewal:options?{requested:1,renewed:failed?0:1,failed}:null,
      poolRefresh:{lastAutomaticCheckAt:'2026-11-11T11:00:00Z',lastTokenRefreshAt:'2026-11-11T10:00:00Z',reconnectRequired:failed}};
  },toast:(message,error)=>feedback.push({message,error})};
vm.runInNewContext(source.slice(refreshStart,refreshEnd)+'\nthis.refresh=refreshAccounts;',refreshContext);
await refreshContext.refresh({type:'click'});
assert.match(feedback[0].message,/Token 1 akun berhasil diperbarui/);
assert.equal(refreshButton.disabled,false);
failed=1;await refreshContext.refresh({type:'click'});
assert.equal(feedback[1].error,true);assert.match(feedback[1].message,/1 akun belum bisa diperbarui/);
await refreshContext.refresh();assert.equal(feedback.length,2,'Background loading must not show a click completion toast');
assert.equal(requests,3);
assert.match(labels.poolLastChecked.textContent,/18[.:]00 WIB/);
assert.match(labels.poolLastTokenRefresh.textContent,/17[.:]00 WIB/);
assert.equal(labels.poolRefreshNotice.hidden,false);
console.log('PASS: Account Pool with 0/2 accounts renders, each Remove button binds and works.');
