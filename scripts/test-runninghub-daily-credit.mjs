import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunningHubDailyCredit,runningHubRewardDay,publicDailyCredit} from '../runninghub-daily-credit.js';
const start=Date.UTC(2026,10,16,12);
function fixture(){
  let clock=start,granted=false,enabled=true,amount='17.25',ack={code:0},mode='success';
  const store=new Map([['a',{access:'private-access'}],['b',{access:'other-access'}]]),calls=[];
  const get=key=>store.get(key),remember=(key,patch)=>store.set(key,{...get(key),...patch});
  const post=async(key,route,body,options)=>{
    calls.push({key,route,body,options});
    if(route==='/api/welfare/summary'){
      assert.deepEqual(body,{issue:false});
      if(mode==='summary-fails')throw Error('network');
      return {code:0,data:{enabled,dailyGift:{granted,amount}}};
    }
    assert.equal(route,'/api/welfare/daily-gift/claim');assert.deepEqual(body,{});
    assert.equal(options.retryAuth,false);
    assert.equal(get(key).dailyCredit.state,'pending','Receipt must be persisted before sending the claim');
    if(mode==='success'||mode==='lost-ack')granted=true;
    if(mode==='lost-ack')throw Error('timeout');
    return ack;
  };
  const reopen=()=>createRunningHubDailyCredit({get,remember,post,now:()=>clock});
  return {get,remember,calls,reopen,advance:ms=>clock+=ms,configure:v=>{
    if('granted'in v)granted=v.granted;if('enabled'in v)enabled=v.enabled;
    if('amount'in v)amount=v.amount;if('mode'in v)mode=v.mode;if('ack'in v)ack=v.ack;
  }};
}
test('native daily grant requires summary confirmation and reports the actual amount only',async()=>{
  const f=fixture(),service=f.reopen();
  const result=await service.claim('a');
  assert.equal(result.receipt.state,'claimed');assert.equal(result.receipt.amount,17.25);
  assert.equal(result.attempted,true);assert.equal(f.calls.length,3);
  assert.equal(f.get('a').access,'private-access');
  assert.ok(!JSON.stringify(service.snapshot('a')).includes('private'));
  assert.deepEqual(publicDailyCredit({state:'unexpected',access:'secret'}),null);
});
test('parallel checks share one claim and persisted confirmation skips retries on the same reward day',async()=>{
  const f=fixture(),service=f.reopen();
  const results=await Promise.all([service.claim('a'),service.claim('a')]);
  assert.ok(results.every(r=>r.receipt.state==='claimed'));
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
  await f.reopen().claim('a');assert.equal(f.calls.length,3);
  f.advance(12*3600000);f.configure({granted:false});
  assert.equal((await f.reopen().claim('a')).receipt.state,'claimed');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,2);
});
test('acknowledgement alone is pending; restart and repeated checks do not immediately replay',async()=>{
  const f=fixture();f.configure({mode:'no-grant'});
  assert.equal((await f.reopen().claim('a')).receipt.state,'pending');
  assert.equal((await f.reopen().claim('a')).receipt.state,'pending');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
  f.configure({granted:true});assert.equal((await f.reopen().claim('a')).receipt.state,'already_claimed');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
});
test('a lost claim acknowledgement is reconciled without a second claim',async()=>{
  const f=fixture();f.configure({mode:'lost-ack'});
  assert.equal((await f.reopen().claim('a')).receipt.state,'claimed');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
});
test('provider challenges remain manual and never trigger a repeated claim',async()=>{
  const f=fixture();f.configure({mode:'challenge',ack:{code:412,msg:'captcha verification required'}});
  assert.equal((await f.reopen().claim('a')).receipt.state,'requires_action');
  f.advance(3*3600000);await f.reopen().claim('a');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
});
test('unavailable or already-claimed rewards and summary failures cannot issue a claim',async()=>{
  for(const config of [{enabled:false},{granted:true},{mode:'summary-fails'}]){
    const f=fixture();f.configure(config);const result=await f.reopen().claim('a');
    assert.equal(result.attempted,false);assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,0);
  }
});
test('unconfirmed failures retry only after two hours and isolate account receipts',async()=>{
  const f=fixture();f.configure({mode:'no-grant',ack:{code:500,msg:'temporary error'}});
  await f.reopen().claim('a');f.advance(119*60000);await f.reopen().claim('a');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,1);
  f.advance(60000);await f.reopen().claim('a');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/claim')).length,2);
  assert.equal(f.get('b').dailyCredit,undefined);
});
test('reward day uses native Shanghai midnight, which is 23:00 WIB',()=>{
  assert.equal(runningHubRewardDay(Date.UTC(2026,10,16,15,59,59)),'2026-11-16');
  assert.equal(runningHubRewardDay(Date.UTC(2026,10,16,16)),'2026-11-17');
});
