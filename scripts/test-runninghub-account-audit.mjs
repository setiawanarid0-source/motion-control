import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditRunningHubAccounts} from '../runninghub-account-audit.js';
const accounts=[{id:'account-a',name:'Account 01',key:'private-key-a'},
  {id:'account-b',name:'Account 02',key:'private-key-b'},
  {id:'account-c',name:'Account 03',key:'private-key-c'}];
const calls=[];
const result=await auditRunningHubAccounts({accounts,now:()=>new Date('2026-11-04T16:00:00Z'),
  request:async(route,key,body,timeout)=>{
    calls.push({route,key,body,timeout});
    if(key==='private-key-c')throw Error('provider error private-key-c');
    return {code:0,data:{remainCoins:'2538',remainMoney:'0',apiType:'NORMAL',currency:'USD',
      ...(key==='private-key-a'?{paidCoins:'0',freeCoins:2538}:{}),
      apiKey:key,accessToken:'not-for-output',nested:{key:'not-for-output'},
      creditCardNumber:'4111111111111111',otherBalanceStructure:{paid:10}}};
  }});
assert.equal(calls.length,3);
for(const call of calls){
  assert.equal(call.route,'/uc/openapi/accountStatus');
  assert.equal(call.body.apikey,call.key);assert.equal(call.timeout,20000);
}
assert.deepEqual(result.accounts[0].balances,{remainCoins:2538,remainMoney:0,paidCoins:0,freeCoins:2538});
assert.deepEqual(result.accounts[1].balances,{remainCoins:2538,remainMoney:0},
  'Missing paid/free fields stay unknown rather than becoming zero or inferred from totals');
assert.equal(result.accounts[2].status,'unavailable');
const serialized=JSON.stringify(result);
assert.doesNotMatch(serialized,/private-key|not-for-output|4111111111111111/);
assert.ok(result.accounts[0].responseFields.includes('otherBalanceStructure'),
  'Field names permit further diagnosis without exposing unrecognized values');
assert.equal(result.readOnly,true);
assert.equal(result.checkedAt,'2026-11-04T16:00:00.000Z');
const plusCalls=[];
const plus=await auditRunningHubAccounts({accounts:accounts.slice(0,1),instanceType:'plus',request:async(route,key,body)=>{
  plusCalls.push({route,body});
  return {code:0,data:{apiType:'WEB_SESSION',billingVersion:'NEW',balancePoint:30,
    workspace:{configured:true,contentNodeCount:0,runValidation:{instanceType:body.instanceType,code:0,canCreateTask:false,billingVersion:'NEW',
      providerMessage:'TASK_CREATE_FAILED_BY_NOT_ENOUGH_POWER_VALUE',responseFields:['requiredPoint','accessToken','secretPoint'],
      numericFields:{requiredPoint:'50',balancePoint:30,secretPoint:999,cost:-1,price:'not-a-number',arbitrary:700}}}}};
}});
assert.equal(plusCalls[0].body.instanceType,'plus');assert.equal(plus.instanceType,'plus');
assert.equal(plus.accounts[0].workspace.runValidation.canCreateTask,false);
assert.equal(plus.accounts[0].workspace.contentNodeCount,0);
assert.deepEqual(plus.accounts[0].workspace.runValidation.numericFields,{requiredPoint:50,balancePoint:30});
assert.doesNotMatch(JSON.stringify(plus),/private-key|secretPoint|accessToken|not-a-number|arbitrary/);
await assert.rejects(auditRunningHubAccounts({accounts,instanceType:'ultra',request:async()=>{throw Error('Invalid audit mode must not reach the provider');}}),/Mode audit tidak valid/);
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const at=server.indexOf("app.get('/api/runninghub/account-audit'");
assert.ok(at>server.indexOf('app.use(ownerAuth.requireOwner);'),'Audit is inside existing owner authentication');
const route=server.slice(at,server.indexOf('\nasync function handleGeneration(',at));
assert.match(route,/loadGlobalAccounts\(\)/);
assert.doesNotMatch(route,/refreshPool|createTask|uploadToRunningHub|saveVaultAccounts/);
assert.match(route,/\['default','plus'\]\.includes\(instanceType\)/);
console.log('PASS: owner-only account audit only reads accountStatus, preserves unknown balances, and never exposes credentials or creates tasks');
