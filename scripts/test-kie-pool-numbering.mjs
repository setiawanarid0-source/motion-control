import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import axios from 'axios';
import {createKieStudio} from '../kie-studio.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-kie-numbering-'));
const root=path.join(dir,'kie-studio');fs.mkdirSync(root);
const encrypt=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const decrypt=value=>JSON.parse(Buffer.from(value,'base64').toString());
const record=(id,name,state='ready',credits=47)=>({id,name,key:'fixture-kie-key-'+id,
  fingerprint:id,state,credits,lastAttemptAt:new Date().toISOString()});
const initial=[record('a','Account 50'),record('b','Account 51','ready',0),record('c','Account 99','unavailable')];
fs.writeFileSync(path.join(root,'accounts.enc'),encrypt({accounts:initial}));
const history=encrypt({tasks:[{id:'fixture-accepted-task',accountId:'a',accountName:'Account 50',
  key:initial[0].key,status:'success',createdAt:new Date().toISOString()}]});
fs.writeFileSync(path.join(root,'tasks.enc'),history);
const originalAdapter=axios.defaults.adapter;
let gate=null,entered=null;
axios.defaults.adapter=async config=>{
  assert.equal(config.method,'get');
  assert.equal(config.url,'https://api.kie.ai/api/v1/chat/credit','Pool operations must not submit a paid task');
  if(gate&&config.headers.get('Authorization')==='Bearer '+initial[1].key){entered();await gate;}
  return {status:200,statusText:'OK',headers:{},config,data:{code:200,data:47}};
};
const app=express();app.use(express.json());app.use('/api/kie',createKieStudio({dir,encrypt,decrypt}));
const listener=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
const base='http://127.0.0.1:'+listener.address().port+'/api/kie/accounts';
const headers={'X-Vanta-Device':'fixture-kie-pool-device-1234','Content-Type':'application/json'};
const names=accounts=>Array.from(accounts,a=>a.name);
const ids=accounts=>Array.from(accounts,a=>a.id);
const request=async(suffix='',options={})=>{
  const response=await fetch(base+suffix,{headers,...options});return {status:response.status,data:await response.json()};
};
try{
  const loaded=await request();assert.equal(loaded.status,200);
  assert.deepEqual(names(loaded.data.accounts),['Account 01','Account 02','Account 03']);
  assert.deepEqual(ids(loaded.data.accounts),['a','b','c']);
  assert.equal(loaded.data.accounts.length,3,'Total includes empty-credit and temporarily unavailable accounts');
  const stored=decrypt(fs.readFileSync(path.join(root,'accounts.enc'),'utf8')).accounts;
  assert.deepEqual(names(stored),names(loaded.data.accounts),'Legacy numbering must be fixed in persistent storage');
  assert.deepEqual(stored.map(a=>a.key),initial.map(a=>a.key),'Renumbering must not replace credentials');

  const removed=await request('/a',{method:'DELETE'});
  assert.equal(removed.status,200);assert.deepEqual(ids(removed.data.accounts),['b','c']);
  assert.deepEqual(names(removed.data.accounts),['Account 01','Account 02']);
  assert.equal(fs.readFileSync(path.join(root,'tasks.enc'),'utf8'),history,'Deleting a pool account must retain accepted task credentials and ownership');
  const added=await request('',{method:'POST',body:JSON.stringify({apiKey:'fixture-new-kie-key'})});
  assert.equal(added.status,201);assert.equal(added.data.account.name,'Account 03');
  const newId=added.data.account.id;
  assert.deepEqual(names((await request()).data.accounts),['Account 01','Account 02','Account 03']);
  const middle=await request('/c',{method:'DELETE'});
  assert.deepEqual(ids(middle.data.accounts),['b',newId]);assert.deepEqual(names(middle.data.accounts),['Account 01','Account 02']);
  const last=await request('/'+newId,{method:'DELETE'});assert.deepEqual(names(last.data.accounts),['Account 01']);

  let release;
  gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const refreshing=request('/refresh',{method:'POST',body:'{}'});await started;
  assert.deepEqual((await request('/b',{method:'DELETE'})).data.accounts,[]);
  release();const refreshed=await refreshing;gate=null;
  assert.deepEqual(refreshed.data.accounts,[],'Delayed balance checks must not restore a deleted account');
  const again=await request('',{method:'POST',body:JSON.stringify({apiKey:'fixture-next-kie-key'})});
  assert.equal(again.data.account.name,'Account 01','An emptied pool must restart at one');
  const missing=await request('/not-present',{method:'DELETE'});assert.equal(missing.status,404);
  assert.equal((await request()).data.accounts.length,1);
  assert.ok(!JSON.stringify(loaded.data).includes('fixture-kie-key'),'API snapshots must not expose saved credentials');
}finally{
  axios.defaults.adapter=originalAdapter;await new Promise(resolve=>listener.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
}

// Exercise the actual client functions, including a balance response arriving
// after a successful deletion. Account selection remains bound to stable IDs.
const source=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const nodes=new Map();
const element=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,classList:{toggle(){}}});
  return nodes.get(id);
};
const select=element('kieAccountSelect');let selectHtml='';
Object.defineProperty(select,'innerHTML',{get:()=>selectHtml,set:html=>{selectHtml=html;select.value='auto';}});
Object.defineProperty(select,'options',{get:()=>[...selectHtml.matchAll(/<option value="([^"]+)"/g)].map(m=>({value:m[1]}))});
const title=element('title'),foot=element('foot');
let resolveRead;
const context={kie:{accounts:initial.map(({key,fingerprint,...a})=>a),accountsRevision:0,accountPolling:false},
  state:{view:'kie-accounts',accounts:[{canGenerate:true}]},el:element,
  window:{},document:{querySelector:selector=>selector==='.balance-pill span'?title:foot},
  esc:s=>String(s),fmt:n=>String(n),toast(){},confirm:()=>true,console:{warn(){}},
  api:async(url,options={})=>{
    if(!options.method)return new Promise(resolve=>{resolveRead=resolve;});
    if(options.method==='DELETE')return {ok:true};
    if(options.method==='POST')return {account:{id:'new',name:'Account 99',credits:47,state:'ready'}};
    throw Error('unexpected client request');
  }};
vm.createContext(context);
const indicator=source.slice(source.indexOf('  function updateProviderIndicator(){'),source.indexOf('  window.vantaKieNavigation='));
const pool=source.slice(source.indexOf('  function accountDisplayName('),source.indexOf('  function renderLatest(){'));
vm.runInContext(indicator+pool+'\nthis.pool={drawAccounts,loadAccounts,removeAccount,addAccount};',context);
context.pool.drawAccounts();select.value='b';context.pool.drawAccounts();
assert.equal(element('poolCredits').textContent,'3');assert.equal(element('poolCount').textContent,'3 akun kie.ai');
const main=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
context.$=selector=>element(selector.slice(1));context.updateGenerate=()=>{};
vm.runInContext(main.slice(main.indexOf('function updatePoolSummary(){'),main.indexOf('function renderAccounts(){')),context);
context.updatePoolSummary();
assert.equal(element('poolCredits').textContent,'3','Background RunningHub refresh must not overwrite the kie.ai total');
assert.ok(element('kieAccountList').innerHTML.includes('Account 01'));
assert.ok(!element('kieAccountList').innerHTML.includes('Account 50'));
const pending=context.pool.loadAccounts();await context.pool.removeAccount('a');
assert.equal(element('poolCredits').textContent,'2');assert.equal(select.value,'b');
assert.deepEqual(names(context.kie.accounts),['Account 01','Account 02']);
resolveRead({accounts:initial});await pending;
assert.deepEqual(ids(context.kie.accounts),['b','c'],'A late GET must not restore deleted rows or old counts');
element('kieKeyInput').value='fixture-client-new-key';await context.pool.addAccount();
assert.equal(element('poolCredits').textContent,'3');assert.deepEqual(names(context.kie.accounts),['Account 01','Account 02','Account 03']);
await Promise.all([context.pool.removeAccount('b'),context.pool.removeAccount('new')]);
assert.deepEqual(ids(context.kie.accounts),['c']);assert.deepEqual(names(context.kie.accounts),['Account 01']);
assert.equal(select.value,'auto');assert.equal(element('poolCredits').textContent,'1');
await context.pool.removeAccount('c');assert.equal(element('poolCredits').textContent,'0');
assert.ok(element('kieAccountList').innerHTML.includes('Belum ada akun'));
console.log('PASS: kie.ai persistent numbering starts at one; first/middle/last deletion, empty/re-add, total counts, stable ownership, selection, and stale response safety. No paid provider calls.');
