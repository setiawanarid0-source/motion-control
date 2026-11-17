import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {motionFlyBillingWorkflow} from '../runninghub-billing-evidence.js';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRunningHubWebSession,parseRunningHubSession,isRunningHubWebKey} from '../runninghub-web-session.js';
import {runningHubWebBalance,webBalanceNumber,webBalanceEncoding} from '../runninghub-web-balance.js';
import {canGenerateWithAccount,rankGenerationAccounts} from '../runninghub-account-priority.js';
import {partitionAccountRefresh} from '../account-eligibility.js';

const time=Date.UTC(2026,10,8),userId='2110000000000000001',renderId='2110000000000000999';
const jwt=(sub=userId,exp=time/1000+3600)=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub,exp})).toString('base64url')+'.fixture-signature';
const exported={site:'runninghub.ai',access:jwt(),refresh:'fixture-refresh-token',identify:'fixture_identify',comfyAuth:'fixture-comfy-token'};
async function fixture(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rh-web-')),calls=[],secret=crypto.randomBytes(32);
  let clock=time;
  const encrypt=value=>{
    const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,iv);
    const content=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
    return Buffer.concat([iv,c.getAuthTag(),content]).toString('base64');
  };
  const decrypt=value=>{try{
    const b=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',secret,b.subarray(0,12));
    d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());
  }catch{return null;}};
  let handler=async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'600.00'}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD',converting:false,balancePoint:0}};
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt(userId,time/1000+7200),refresh_token:'fixture-refreshed-token'}};
    if(route==='/task/list')return {code:0,data:{total:1,records:config.data.taskId?[{taskId:renderId,taskStatus:'SUCCESS'}]:[]}};
    if(route==='/api/workflow/upload')return {code:0,data:{workflowId:'2110000000000000100'}};
    if(route==='/api/workflow/getContent')return {code:0,data:{id:'2110000000000000100',userId,workflowContent:'{"nodes":[]}',draft:true}};
    if(route==='/api/workflow/setContent')return {code:0,data:null};
    if(route==='/api/user/task/work/valid')return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    if(route==='/task/create')return {code:0,data:{taskId:renderId,taskStatus:'QUEUED'}};
    if(route==='/api/output/v2/history')return {code:0,data:[
      {taskId:'2110000000000000998',fileUrl:'https://example.com/wrong.mp4',outputType:'mp4',nodeId:'490'},
      {taskId:renderId,fileUrl:'https://example.com/correct.mp4',outputType:'mp4',nodeId:'490'}]};
    throw Error('Unexpected fixture route '+route);
  };
  const http={request:async config=>{
    calls.push(config);return {status:200,data:await handler(config)};
  }};
  const reopen=()=>createRunningHubWebSession({dir,encrypt,decrypt,http,now:()=>clock});
  const service=reopen();
  try{await run({dir,calls,service,encrypt,decrypt,reopen,advance:ms=>{clock+=ms;},setHandler:fn=>{handler=fn;}});}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('daily credits are opt-in for maintenance, refresh balances after confirmation, and survive re-import',()=>fixture(async({service,setHandler,calls,reopen})=>{
  let granted=false;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:granted?625:600}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:granted?31.123:6.123}};
    if(route==='/task/list')return {code:0,data:{total:0}};
    if(route==='/api/welfare/summary'){assert.deepEqual(config.data,{issue:false});return {code:0,data:{enabled:true,dailyGift:{granted,amount:25}}};}
    if(route==='/api/welfare/daily-gift/claim'){granted=true;return {code:0,data:null};}
    throw Error('Unexpected operation '+route);
  });
  const {key}=await service.connect(exported);
  await service.status(key);service.sessionAudit(key);service.cachedStatus(key);
  assert.equal(calls.filter(c=>new URL(c.url).pathname.startsWith('/api/welfare')).length,0,'Read-only status and audits must not claim rewards');
  const result=await service.status(key,{automatic:true,claimDailyCredit:true});
  assert.equal(result.dailyCredit.state,'claimed');assert.equal(result.dailyCredit.amount,25);
  assert.equal(result.balancePoint,31.123);assert.equal(result.remainCoins,625);
  await service.connect(exported);
  assert.equal(reopen().sessionAudit(key).dailyCredit.state,'claimed');
  await reopen().status(key,{automatic:true,claimDailyCredit:true});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/welfare/daily-gift/claim').length,1);
}));



test('native exponent strings stay points, preserve real zero and never create a task',()=>fixture(async({service,setHandler,calls})=>{
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'0E-8'}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:'3E+1',balanceUnit:'30000',transitionCoinRemained:'0E-8'}};
    if(route==='/task/list')return {code:0,data:{total:0}};
    throw Error('Unexpected operation '+route);
  });
  const {key}=await service.connect(exported);
  const status=await service.status(key);
  assert.equal(status.remainCoins,0);
  assert.equal(status.balancePoint,30);
  assert.equal(status.transitionCoinRemained,0);
  assert.equal(status.balanceRead.state,'verified');
  assert.equal(status.balanceRead.pointEncoding,'scientific_string');
  assert.equal(status.balanceRead.pointAvailability,'positive');
  assert.equal(status.balanceRead.attempts,1);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,0);
}));
test('balance numeric grammar handles decimal encodings without accepting malformed or nonfinite amounts',()=>{
  for(const [raw,expected] of [['3E+1',30],['0E-8',0],['-0E-8',0],['+30.0',30],['.125',.125],['30.',30],['6.123e0',6.123],['1,734',1734]])
    assert.equal(webBalanceNumber(raw),expected);
  for(const raw of ['1,2,3','1,23','0x20','3E','3E+','1e309','-1e2','Infinity','NaN','30 points'])
    assert.equal(webBalanceNumber(raw),null);
  assert.equal(webBalanceEncoding(null),'null');
  assert.equal(webBalanceEncoding(undefined),'missing');
  assert.equal(webBalanceEncoding('0E-8'),'scientific_string');
  assert.equal(webBalanceEncoding('30'),'decimal_string');
  assert.equal(webBalanceEncoding('fixture-private'),'unsupported_string');
});

test('post-claim missing points are reconciled once without another claim or inference',()=>fixture(async({service,setHandler,calls})=>{
  let granted=false,postGrantReads=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:0}};
    if(route==='/uc/point/summary'){
      if(!granted)return {code:0,data:{billingVersion:'NEW',balancePoint:0,transitionCoinRemained:0}};
      postGrantReads++;
      return {code:0,data:postGrantReads===1?{billingVersion:'NEW',balanceUnit:'30000',transitionCoinRemained:0}:
        {billingVersion:'NEW',balancePoint:30,transitionCoinRemained:0}};
    }
    if(route==='/task/list')return {code:0,data:{total:0}};
    if(route==='/api/welfare/summary')return {code:0,data:{enabled:true,dailyGift:{granted,amount:30}}};
    if(route==='/api/welfare/daily-gift/claim'){granted=true;return {code:0,data:null};}
    throw Error('Unexpected operation '+route);
  });
  const {key}=await service.connect(exported);
  const status=await service.status(key,{claimDailyCredit:true});
  assert.equal(status.dailyCredit.state,'claimed');
  assert.equal(status.balancePoint,30);
  assert.equal(status.balanceRead.state,'verified');
  assert.equal(status.balanceRead.attempts,2);
  assert.equal(postGrantReads,2);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/welfare/daily-gift/claim').length,1);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,0);
}));

test('a confirmed reward does not fabricate a missing points balance from its amount or accounting unit',()=>fixture(async({service,setHandler,calls})=>{
  let granted=false,postGrantReads=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:0}};
    if(route==='/uc/point/summary'){
      if(granted)postGrantReads++;
      return {code:0,data:{billingVersion:'NEW',balanceUnit:'30000',transitionCoinRemained:0,accessToken:'fixture-private'}};
    }
    if(route==='/task/list')return {code:0,data:{total:0}};
    if(route==='/api/welfare/summary')return {code:0,data:{enabled:true,dailyGift:{granted,amount:30}}};
    if(route==='/api/welfare/daily-gift/claim'){granted=true;return {code:0,data:null};}
    throw Error('Unexpected operation '+route);
  });
  const {key}=await service.connect(exported);
  const status=await service.status(key,{claimDailyCredit:true});
  assert.equal(status.dailyCredit.state,'claimed');
  assert.equal(status.dailyCredit.amount,30);
  assert.equal(status.balancePoint,null);
  assert.equal(status.balanceRead.state,'incomplete');
  assert.equal(status.balanceRead.problem,'points_missing');
  assert.equal(status.balanceRead.pointAvailability,'unverified');
  assert.equal(status.balanceRead.attempts,2);
  assert.equal(postGrantReads,2);
  assert.equal(canGenerateWithAccount(status),true,'Unknown funding must not restore a client-side credit gate');
  assert.ok(!JSON.stringify(status.balanceRead).includes('fixture-private'));
  assert.ok(!status.balanceRead.presentFields.includes('accessToken'));
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/welfare/daily-gift/claim').length,1);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,0);
}));

test('points-summary outages retry at most once and keep rejected balances unknown',()=>fixture(async({service,setHandler,calls})=>{
  let phase='connect',reads=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:0}};
    if(route==='/uc/point/summary'){
      if(phase==='connect')return {code:0,data:{billingVersion:'NEW',balancePoint:0,transitionCoinRemained:0}};
      reads++;
      return phase==='recover'&&reads===2?{code:0,data:{billingVersion:'NEW',balancePoint:30,transitionCoinRemained:0}}:
        {code:503,msg:'fixture temporary outage'};
    }
    if(route==='/task/list')return {code:0,data:{total:0}};
    throw Error('Unexpected operation '+route);
  });
  const {key}=await service.connect(exported);
  phase='recover';
  const recovered=await service.status(key);
  assert.equal(recovered.balancePoint,30);
  assert.equal(recovered.balanceRead.state,'verified');
  assert.equal(reads,2);
  phase='reject';reads=0;
  const rejected=await service.status(key);
  assert.equal(reads,2);
  assert.equal(rejected.balancePoint,null);
  assert.equal(rejected.balanceRead.state,'unavailable');
  assert.equal(rejected.balanceRead.providerCode,503);
  assert.equal(rejected.sessionVerified,true);
  assert.equal(calls.filter(c=>/daily-gift\/claim|task\/create/.test(new URL(c.url).pathname)).length,0);
}));

test('ordinary requests do not hammer a rejected rotating grant; verified re-import clears the latch',()=>fixture(async({service,setHandler,calls})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>{
    if(new URL(config.url).pathname==='/uc/token/refresh')return {code:412};
    return {code:412};
  });
  await assert.rejects(service.status(key,{renewTokens:true}),{code:'RH_WEB_REFRESH_REJECTED'});
  for(let i=0;i<3;i++)await assert.rejects(service.request('/openapi/v2/query',key,{taskId:renderId}),{code:'RH_WEB_REFRESH_REJECTED'});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/uc/token/refresh').length,1);
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:600}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD'}};
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt(),refresh_token:'fixture-fresh-refresh'}};
    if(route==='/task/list')return {code:0,data:{total:0}};
    throw Error('Unexpected operation');
  });
  await service.connect({...exported,refresh:'fixture-new-valid-refresh'});
  assert.equal(service.sessionAudit(key).lastRenewal,null);
  await service.status(key,{renewTokens:true});assert.equal(service.sessionAudit(key).lastRenewal.outcome,'renewed');
}));

test('accepts the original popup and persists only the four needed credential fields',()=>{
  const parsed=parseRunningHubSession({site:'runninghub.ai',access:exported.access,
    cookies:'analytics=unrelated; preferences=private',localStorage:{'Rh-Refreshtoken':exported.refresh,
      'Rh-Identify':exported.identify,'Rh-Comfy-Auth':exported.comfyAuth,'otherToken':'unrelated-secret'},
    sessionStorage:{irrelevant:'not-for-vanta'}});
  assert.equal(parsed.access,exported.access);assert.equal(parsed.refresh,exported.refresh);
  assert.equal(parsed.identify,exported.identify);assert.equal(parsed.comfyAuth,exported.comfyAuth);
  assert.ok(!JSON.stringify(parsed).includes('unrelated'));
  assert.deepEqual(Object.keys(parsed).sort(),['access','refresh','identify','comfyAuth','expiresAt'].sort());
  const fresh=jwt(userId,time/1000+9000);
  assert.equal(parseRunningHubSession({...exported,cookies:'Rh-Accesstoken='+encodeURIComponent(fresh)}).access,fresh);
  for(const input of [{...exported,site:'attacker.example'},'javascript:alert(1)',{site:'runninghub.ai',cookies:'ordinary=cookie'},
    {...exported,access:'bad\r\nAuthorization: injected'}])assert.throws(()=>parseRunningHubSession(input));
});

test('legacy imports use the native localStorage refresh token instead of a stale cookie',()=>{
  const cookieRefresh='fixture-stale-cookie-refresh',storageRefresh='fixture-current-storage-refresh';
  const parsed=parseRunningHubSession({...exported,
    cookies:'Rh-Refreshtoken='+encodeURIComponent(cookieRefresh),
    localStorage:{'Rh-Refreshtoken':storageRefresh},
    sessionStorage:{'Rh-Refreshtoken':'fixture-older-tab-refresh'}});
  assert.equal(parsed.refresh,storageRefresh);
  assert.equal(parseRunningHubSession({site:'runninghub.ai',access:exported.access,
    cookies:'Rh-Refreshtoken='+cookieRefresh}).refresh,cookieRefresh);
  assert.throws(()=>parseRunningHubSession({...exported,refresh:jwt('2110000000000000002')}),
    {code:'RH_WEB_IDENTITY_MISMATCH'});
});

test('the actual one-line exporter selects the rotated native refresh token without network requests',()=>{
  const nodes=[],alerts=[];
  const element=tag=>{const node={tag,style:{},appendChild(){},setAttribute(){},remove(){}};nodes.push(node);return node;};
  const storageRefresh='fixture-current-storage-refresh';
  const context={window:{},location:{hostname:'www.runninghub.ai'},alert:message=>alerts.push(message),
    document:{cookie:'Rh-Accesstoken='+encodeURIComponent(exported.access)+'; Rh-Refreshtoken=fixture-stale-cookie-refresh',
      getElementById:()=>null,createElement:element,body:{appendChild(){}}},
    localStorage:{getItem:name=>name==='Rh-Refreshtoken'?storageRefresh:''},
    sessionStorage:{getItem:()=>''}};
  context.window.localStorage=context.localStorage;context.window.sessionStorage=context.sessionStorage;
  vm.runInNewContext(fs.readFileSync(new URL('../public/rh-session.js',import.meta.url),'utf8'),context);
  vm.runInNewContext(decodeURIComponent(context.window.vantaRunningHubSessionCode.slice('javascript:'.length)),context);
  assert.deepEqual(alerts,[]);
  const data=JSON.parse(nodes.find(node=>node.tag==='textarea').value);
  assert.equal(data.access,exported.access);assert.equal(data.refresh,storageRefresh);
  assert.deepEqual(Object.keys(data).sort(),['site','access','refresh','identify','comfyAuth'].sort());
  assert.equal(parseRunningHubSession(data).refresh,storageRefresh);
});

test('a stale-cookie import renews through the current native token and keeps its rotation after restart',()=>fixture(async({service,setHandler,reopen})=>{
  const current='fixture-current-storage-refresh',rotated='fixture-current-backend-rotation';
  const {key}=await service.connect({...exported,cookies:'Rh-Refreshtoken=fixture-stale-cookie-refresh',
    localStorage:{'Rh-Refreshtoken':current}});
  let grant=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh'){
      assert.equal(config.headers.Authorization,'Bearer '+(grant?rotated:current));
      grant++;return {code:0,data:{access_token:jwt(userId,time/1000+7200+grant),refresh_token:rotated}};
    }
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:0}};
    if(route==='/uc/point/summary')return {code:0,data:{balancePoint:0}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    throw Error('unexpected route');
  });
  await service.status(key,{renewTokens:true});
  const restarted=reopen();
  await restarted.status(key,{renewTokens:true});
  assert.equal(grant,2);
  assert.equal(restarted.sessionAudit(key).lastRenewal.outcome,'renewed');
}));

test('connect is read-only on RunningHub, verifies balance, encrypts credentials and keeps a stable reference',()=>fixture(async({service,calls})=>{
  const first=await service.connect(JSON.stringify(exported));
  assert.ok(isRunningHubWebKey(first.key));assert.equal(first.status.remainCoins,600);
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/uc/getUserInfo','/uc/point/summary']);
  assert.equal(fs.statSync(service.file).mode&0o777,0o600);
  assert.ok(!fs.readFileSync(service.file,'utf8').includes(exported.access));
  const second=await service.connect({...exported,access:jwt(userId,time/1000+5000)});
  assert.equal(first.key,second.key,'reconnect must not invalidate accepted task credentials');
}));

test('a verified identity can connect with unknown balances without fabricating zero',()=>fixture(async({service,setHandler})=>{
  setHandler(async()=>({code:0,data:{id:userId}}));
  const connected=await service.connect(exported);
  assert.equal(connected.status.remainCoins,null);assert.equal(connected.status.balancePoint,null);
  assert.equal(connected.status.currentTaskCounts,null);assert.equal(connected.status.billingVersion,'UNKNOWN');
  assert.equal(connected.status.sessionVerified,true);assert.equal(canGenerateWithAccount(connected.status),true);
}));

test('accepts and reconnects valid tokens at every balance without a 100 RH import threshold',()=>fixture(async({service,setHandler,calls})=>{
  let key;
  for(const coins of [0,0.25,12,99,100,600,1734]){
    setHandler(async()=>({code:0,data:{id:userId,totalCoin:String(coins)}}));
    const connected=await service.connect(exported);
    assert.equal(connected.status.remainCoins,coins);
    if(key)assert.equal(connected.key,key,'Balance changes must not create a different credential reference');
    key=connected.key;
  }
  assert.ok(calls.every(call=>['/uc/getUserInfo','/uc/point/summary'].includes(new URL(call.url).pathname)),'Import must not generate, upload or spend RH');
}));

test('reads NEW web points separately from zero old RH coins and retains eligibility without a numeric guess',()=>fixture(async({service,setHandler,calls})=>{
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'0',walletInfo:{balance:'10.25',currency:'USD'}}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',converting:false,balancePoint:'427.50',paidPoint:0,bonusPoint:427.5,activityPoint:0}};
    if(route==='/task/list')return {code:0,data:{total:2,records:[]}};
    throw Error('Unexpected inference or mutation');
  });
  const connected=await service.connect(exported),status=await service.status(connected.key);
  assert.equal(status.remainCoins,0);assert.equal(status.balancePoint,427.5);
  assert.equal(status.balanceUnit,'POINTS');assert.equal(status.currentTaskCounts,2);
  assert.equal(status.walletBalance,10.25);assert.equal(status.currency,'USD');
  assert.equal(status.sessionVerified,true);assert.equal(status.billingSummaryVerified,true);
  assert.equal(canGenerateWithAccount(status),true);
  assert.equal(partitionAccountRefresh([{account:{id:'web'},status}]).removed.length,0);
  assert.equal(canGenerateWithAccount({...status,balancePoint:0}),true,'RunningHub decides whether zero-point accounts have applicable web benefits');
  assert.equal(canGenerateWithAccount({...status,billingConverting:true}),false);
  const ranked=rankGenerationAccounts([
    {account:{id:'empty'},status:{...status,balancePoint:0}},
    {account:{id:'funded'},status}
  ]);
  assert.equal(ranked[0].account.id,'funded');
  assert.equal(rankGenerationAccounts([
    {account:{id:'new',addedAt:'2026-11-11T00:00:00Z'},status:{...status,transitionCoinRemained:0}},
    {account:{id:'old',addedAt:'2026-11-10T00:00:00Z'},status:{...status,transitionCoinRemained:1734}}
  ])[0].account.id,'old','Equal points must preserve priority for available transition RH');
  assert.ok(calls.every(call=>['/uc/getUserInfo','/uc/point/summary','/task/list'].includes(new URL(call.url).pathname)));
}));

test('preserves units, real zero and unknown values across OLD/NEW billing',()=>{
  for(const v of [null,undefined,'',false,true,NaN,Infinity,-1,'not-a-number'])assert.equal(webBalanceNumber(v),null);
  assert.equal(webBalanceNumber('1,734'),1734);assert.equal(webBalanceNumber('0.25'),0.25);
  const old=runningHubWebBalance({id:userId,totalCoin:'1,734',virtualCoin:'50',virtualCoinDaily:'10'}, {billingVersion:'OLD',balancePoint:0});
  assert.equal(old.balanceUnit,'RH');assert.equal(old.remainCoins,1734);
  assert.equal(old.virtualCoin,50);assert.equal(old.virtualCoinDaily,10);
  const missing=runningHubWebBalance({id:userId,totalCoin:'0'},undefined);
  assert.equal(missing.balanceUnit,'UNKNOWN');assert.equal(missing.balancePoint,null);
  assert.equal(missing.billingSummaryVerified,false);
});

test('rejects an imported token when RunningHub returns a different identity',()=>fixture(async({service,setHandler})=>{
  setHandler(async()=>({code:0,data:{id:'2110000000000000002',totalCoin:600}}));
  await assert.rejects(service.connect(exported),{code:'RH_WEB_IDENTITY_MISMATCH'});
  assert.ok(!fs.existsSync(service.file));
}));

test('expired imported access token uses refresh credentials before verifying the account',()=>fixture(async({service,calls})=>{
  await service.connect({...exported,access:jwt(userId,time/1000-1)});
  assert.equal(new URL(calls[0].url).pathname,'/uc/token/refresh');
  assert.equal(calls[0].headers.Authorization,'Bearer '+exported.refresh);
  assert.equal(new URL(calls[1].url).pathname,'/uc/getUserInfo');
  assert.notEqual(calls[1].headers.Authorization,'Bearer '+exported.access);
}));

test('web create initializes its owned workspace once, applies existing input overrides and never opens an editor',()=>fixture(async({service,calls})=>{
  const {key}=await service.connect(exported);
  const graph={'3':{class_type:'VHS_VideoCombine',inputs:{images:['2',0],save_output:true,frame_rate:60}},
    '1':{class_type:'VHS_LoadVideo',inputs:{video:'old.mp4'}},
    '2':{class_type:'LoadImage',inputs:{image:'source.png'}}};
  await service.request('/task/openapi/create',key,{apiKey:key,workflowId:'not-an-owned-web-workflow',
    workflow:JSON.stringify(graph),instanceType:'plus',retainSeconds:259200,
    nodeInfoList:[{nodeId:'1',fieldName:'video',fieldValue:'input/new.mp4'}]});
  const create=calls.find(c=>new URL(c.url).pathname==='/task/create');
  const prompt=JSON.parse(create.data.promptContent);
  assert.equal(create.data.workflowId,'2110000000000000100');
  assert.equal(create.data.instanceType,'plus');assert.equal(prompt.client_id,create.data.clientId);
  assert.equal(prompt.prompt['1'].inputs.video,'input/new.mp4');
  assert.deepEqual(prompt.prompt['3'],graph['3']);
  assert.equal(create.data.usePersonalQueue,false);
  for(const c of calls){
    assert.equal(new URL(c.url).origin,'https://www.runninghub.ai');
    assert.equal(c.maxRedirects,0);
    assert.ok(!new URL(c.url).pathname.includes('/openapi/'));
    assert.ok(!JSON.stringify(c.data).includes(key));
    assert.ok(!JSON.stringify(c.data).includes(exported.access));
    assert.ok(!Object.hasOwn(c.data,'apiKey'));assert.ok(!Object.hasOwn(c.data,'retainSeconds'));
    if(new URL(c.url).pathname==='/api/workflow/setContent')assert.equal(c.data.workflowId,'2110000000000000100');
  }
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
  // The private workspace is reused, including after reconnect.
  await service.connect(exported);
  await service.request('/task/openapi/create',key,{workflow:JSON.stringify(graph)});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/workflow/upload').length,1);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/workflow/setContent').length,3,'One workspace initialization plus one native Save per submitted graph');
}));

test('a lost create acknowledgement never causes another paid request or an OpenAPI fallback',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>{
    if(new URL(config.url).pathname==='/api/workflow/upload')return {code:0,data:{id:'2110000000000000100'}};
    if(new URL(config.url).pathname==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(new URL(config.url).pathname==='/api/user/task/work/valid')return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    if(new URL(config.url).pathname==='/api/workflow/setContent')return {code:0,data:null};
    if(new URL(config.url).pathname==='/task/create')throw Error('Lost response after task acceptance');
    throw Error('unexpected');
  });
  await assert.rejects(service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"PrimitiveString","inputs":{"value":"fixture"}}}'}),{code:'RH_WEB_TRANSPORT_ERROR'});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
  assert.ok(calls.every(c=>!c.url.includes('/openapi/')));
}));

test('workspace audit verifies the cached reference without changing workflows or creating tasks',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'0'}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:30}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    if(route==='/api/workflow/getContent')return {code:404,msg:'WORKFLOW_NOT_EXISTS'};
    if(route==='/api/user/task/work/valid')return {code:380,msg:'WORKFLOW_NOT_EXISTS'};
    if(route==='/api/workflow/simpleList')return {code:0,data:[{id:'2110000000000000101',workflowName:'VANTA Studio'},{id:'2110000000000000102',workflowName:'Unrelated private workflow'}]};
    throw Error('Audit must not mutate or submit');
  });
  const audit=await service.request('/uc/openapi/accountStatus',key,{inspectWorkspace:true});
  assert.equal(audit.data.workspace.contentCode,404);assert.equal(audit.data.workspace.activeMatch,false);
  assert.deepEqual(audit.data.workspace.vantaWorkspaces,[{reference:'000101',cachedMatch:false}]);
  assert.doesNotMatch(JSON.stringify(audit),/Unrelated|fixture-signature|2110000000000000102/);
  assert.ok(!calls.some(x=>new URL(x.url).pathname==='/task/create'));
}));

test('read-only audit validates the requested machine and preserves provider billing evidence without creating a task',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'1001'}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:30}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:true}};
    if(route==='/api/user/task/work/valid'){
      assert.deepEqual(JSON.parse(config.data.workflowContent),{nodes:[]});
      return {code:0,msg:'SUCCESS',data:{billingVersion:'NEW',canCreateTask:config.data.instanceType==='default',
        requiredPoint:'50',balancePoint:30,duration:'NaN',cost:-1,secretPoint:999,accessToken:'fixture-secret'}};
    }
    if(route==='/api/workflow/simpleList')return {code:0,data:[]};
    throw Error('Read-only audit must never save, upload, create or cancel');
  });
  const standard=await service.request('/uc/openapi/accountStatus',key,{inspectWorkspace:true});
  const plus=await service.request('/uc/openapi/accountStatus',key,{inspectWorkspace:true,instanceType:'plus'});
  assert.equal(standard.data.workspace.runValidation.canCreateTask,true);
  assert.equal(plus.data.workspace.runValidation.canCreateTask,false);
  assert.equal(plus.data.workspace.runValidation.instanceType,'plus');
  assert.equal(plus.data.workspace.contentNodeCount,0,'An empty workspace is not evidence about the actual MotionFly graph');
  assert.deepEqual(plus.data.workspace.runValidation.numericFields,{requiredPoint:50,balancePoint:30});
  assert.doesNotMatch(JSON.stringify(plus.data.workspace),/fixture-secret|accessToken|secretPoint/);
  assert.deepEqual(calls.filter(c=>new URL(c.url).pathname==='/api/user/task/work/valid').map(c=>c.data.instanceType),['default','plus']);
  await assert.rejects(service.request('/uc/openapi/accountStatus',key,{inspectWorkspace:true,instanceType:'unexpected'}),{code:'RH_WEB_INVALID_AUDIT'});
  assert.ok(calls.every(c=>['/uc/getUserInfo','/uc/point/summary','/task/list','/api/workflow/getContent','/api/user/task/work/valid','/api/workflow/simpleList'].includes(new URL(c.url).pathname)));
}));

test('audits the actual MotionFly/RIFE editor and native billing rules without saving or generating',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  const workflowAudit=motionFlyBillingWorkflow();
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:'1001',powerValue:'1001',type:'1',memberInfo:{memberCode:'0011',userId,accessToken:'private'}}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:30,transitionCoinRemained:1001}};
    if(route==='/api/product/v2/pricing')return {code:0,data:{currentMember:{memberCode:'0011'},gpuRules:{standard:{minimumPoint:3},plus:{minimumPoint:6}},transitionCoinFirst:true,secretCode:123}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:true}};
    if(route==='/api/workflow/simpleList')return {code:0,data:[]};
    if(route==='/api/user/task/work/valid'){
      const editor=JSON.parse(config.data.workflowContent);
      assert.equal(editor.nodes.length,103);assert.equal(editor.nodes.find(n=>n.id===760060).type,'RIFEInterpolation');
      return {code:0,data:{billingVersion:'NEW',canCreateTask:config.data.instanceType==='default'}};
    }
    throw Error('No create, save, upload or cancel may occur in this audit');
  });
  for(const instanceType of ['default','plus']){
    const result=await service.request('/uc/openapi/accountStatus',key,{inspectWorkspace:true,inspectBilling:true,workflowAudit,instanceType});
    assert.equal(result.data.workspace.contentNodeCount,0);
    assert.equal(result.data.workspace.validatedNodeCount,103);
    assert.equal(result.data.workspace.validatedGraphSha256,workflowAudit.graphSha256);
    assert.equal(result.data.workspace.runValidation.canCreateTask,instanceType==='default');
    assert.equal(result.data.billingEvidence['profile.memberInfo.memberCode'],'0011');
    assert.equal(result.data.billingEvidence['pricing.gpuRules.plus.minimumPoint'],6);
    assert.equal(result.data.billingEvidence['pricing.transitionCoinFirst'],true);
    assert.doesNotMatch(JSON.stringify(result.data.billingEvidence),/private|userId|secretCode|accessToken/);
  }
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/product/v2/pricing').length,2);
  assert.ok(calls.every(c=>['/uc/getUserInfo','/uc/point/summary','/api/product/v2/pricing','/task/list','/api/workflow/getContent','/api/user/task/work/valid','/api/workflow/simpleList'].includes(new URL(c.url).pathname)));
}));

test('materializes an owned empty draft once using native Save and read-only validation before GPU submission',()=>fixture(async({service,calls,setHandler,decrypt,encrypt})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  const id='2110000000000000100';let saved=false;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:saved?'{"nodes":[]}':null,draft:true}};
    if(route==='/api/workflow/setContent'){
      assert.equal(config.data.workflowId,id);
      assert.deepEqual(JSON.parse(config.data.workflowContent).nodes,[]);
      assert.deepEqual(JSON.parse(config.data.promptContent).prompt,{});
      saved=true;return {code:0,data:null};
    }
    if(route==='/api/user/task/work/valid')return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    throw Error('Workspace repair cannot run, import another workspace or cancel a task');
  });
  const state=decrypt(fs.readFileSync(service.file,'utf8'));delete state.sessions[key.slice(6)].workspaceSavedId;fs.writeFileSync(service.file,encrypt(state));
  assert.deepEqual(await Promise.all([service.prepare(key),service.prepare(key)]),[id,id]);
  assert.equal(await service.prepare(key),id);
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/api/workflow/setContent').length,1);
  assert.ok(calls.every(x=>['/api/workflow/getContent','/api/workflow/setContent','/api/user/task/work/valid'].includes(new URL(x.url).pathname)));
}));

test('workspace ownership and unknown lookup failures fail before submission instead of importing repeatedly',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  setHandler(async()=>({code:0,data:{userId:'2110000000000000002',workflowContent:'{"nodes":[]}',draft:false}}));
  await assert.rejects(service.prepare(key),{code:'RH_WEB_IDENTITY_MISMATCH',definitelyRejected:true});
  setHandler(async()=>{throw Error('Lookup timeout');});
  await assert.rejects(service.prepare(key),{code:'RH_WEB_WORKSPACE_UNAVAILABLE',definitelyRejected:true});
  assert.ok(calls.every(x=>new URL(x.url).pathname==='/api/workflow/getContent'));
}));

test('provider authentication refusal on create does not replay the create request',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  await service.prepare(key);
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid')return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    if(route==='/api/workflow/setContent')return {code:0,data:null};
    return {code:412,msg:'Token expired'};
  });
  const response=await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"PrimitiveString","inputs":{"value":"fixture"}}}'});
  assert.equal(response.code,412);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
}));

test('only an explicit taskless missing-workflow refusal invalidates the cached reference, without replaying',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  let reply;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid')return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    if(route==='/api/workflow/setContent')return {code:0,data:null};
    if(route==='/task/create')return reply;
    throw Error('No automatic re-import or create replay');
  });
  for(reply of [{msg:'WORKFLOW_NOT_EXISTS'},{code:0,msg:'WORKFLOW_NOT_EXISTS'},
    {code:380,msg:'WORKFLOW_NOT_EXISTS',data:{taskId:renderId}}]){
    await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"PrimitiveString","inputs":{"value":"fixture"}}}'});
    assert.equal(await service.prepare(key),'2110000000000000100');
  }
  reply={code:380,msg:'WORKFLOW_NOT_EXISTS'};
  await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"PrimitiveString","inputs":{"value":"fixture"}}}'});
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/task/create').length,4);
  assert.ok(!calls.some(x=>new URL(x.url).pathname==='/api/workflow/upload'));
}));

test('output lookup keeps the exact task ID and does not substitute another render',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  const result=await service.request('/task/openapi/outputs',key,{taskId:renderId});
  assert.deepEqual(result.data.map(x=>x.fileUrl),['https://example.com/correct.mp4']);
  assert.equal(calls.find(c=>new URL(c.url).pathname==='/task/list').data.taskId,renderId);
  setHandler(async config=>new URL(config.url).pathname==='/task/list'
    ?{code:0,data:{records:[{taskId:renderId,taskStatus:'SUCCESS'}]}}
    :{code:0,data:[{taskId:'2110000000000000998',fileUrl:'https://example.com/wrong.mp4'}]});
  const late=await service.request('/task/openapi/outputs',key,{taskId:renderId});
  assert.equal(late.code,804);assert.equal(late.data,undefined);
}));

test('web monitoring includes native task filters and recovers queued, running and failed accepted tasks without resubmission',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);let state='QUEUED';
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/task/list'){
      // The consumer list defaults do not include this workflow task. A
      // taskId alone therefore returns an empty list despite acceptance.
      if(!config.data.taskType?.includes('WORKFLOW')||!config.data.taskStatus?.includes(state))
        return {code:0,data:{total:0,records:[]}};
      assert.equal(config.data.taskId,renderId);
      return {code:0,data:{total:1,records:[{taskId:renderId,taskStatus:state,promptContent:'private-inputs'}]}};
    }
    if(route==='/task/failedReason')return {code:0,data:{node_id:'33',exception_type:'FixtureError',exception_message:'Fixture input rejected',traceback:'private trace'}};
    throw Error('Monitoring cannot start inference');
  });
  assert.equal((await service.request('/task/openapi/outputs',key,{taskId:renderId})).code,813);
  state='RUNNING';assert.equal((await service.request('/task/openapi/outputs',key,{taskId:renderId})).code,804);
  state='FAILED';assert.equal((await service.request('/task/openapi/outputs',key,{taskId:renderId})).code,805);
  const audit=await service.inspectTask(key,renderId);
  assert.equal(audit.taskStatus,'FAILED');assert.equal(audit.found,true);
  assert.equal(audit.failure.nodeId,'33');assert.equal(audit.failure.message,'Fixture input rejected');
  assert.doesNotMatch(JSON.stringify(audit),/private-inputs|private trace|fixture-signature/);
  assert.ok(calls.every(x=>!['/task/create','/task/cancel'].includes(new URL(x.url).pathname)));
}));

test('native running progress and completed execution seconds pass through without exposing unrelated task fields',()=>fixture(async({service,setHandler,calls})=>{
  const {key}=await service.connect(exported);let state='RUNNING';
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/task/list')return {code:0,data:{records:[{taskId:renderId,taskStatus:state,
      taskExecutedTime:'78',netWssUrl:'wss://www.runninghub.ai/ws?token=fixture-progress',promptContent:'private-inputs'}]}};
    if(route==='/api/output/v2/history')return {code:0,data:[{taskId:renderId,fileUrl:'https://example.com/correct.mp4',outputType:'mp4'}]};
    throw Error('No generation, cancellation or editor mutation is permitted');
  });
  const running=await service.request('/task/openapi/outputs',key,{taskId:renderId});
  assert.equal(running.data.netWssUrl,'wss://www.runninghub.ai/ws?token=fixture-progress');
  state='SUCCESS';const done=await service.request('/task/openapi/outputs',key,{taskId:renderId});
  assert.equal(done.data[0].taskCostTime,78);
  assert.ok(!JSON.stringify([running,done]).includes('private-inputs'));
  assert.ok(!calls.some(x=>['/task/create','/task/cancel'].includes(new URL(x.url).pathname)));
}));

test('media uses the native image multipart field, including original MP4 bytes',()=>fixture(async({service,dir,setHandler})=>{
  const {key}=await service.connect(exported),source=path.join(dir,'fixture.mp4');fs.writeFileSync(source,'original-mp4-bytes');
  let multipart='';
  setHandler(async config=>{
    assert.equal(new URL(config.url).pathname,'/upload/image');
    assert.equal(config.headers['Rh-Identify'],exported.identify);
    assert.equal(config.headers['Rh-Comfy-Auth'],exported.comfyAuth);
    assert.equal(new URL(config.url).searchParams.get('Rh-Comfy-Auth'),exported.comfyAuth);
    assert.equal(new URL(config.url).searchParams.get('Rh-Identify'),exported.identify);
    await new Promise((resolve,reject)=>{config.data.on('data',b=>{multipart+=b.toString();});config.data.on('end',resolve);config.data.on('error',reject);config.data.resume();});
    return {name:'fixture.mp4',subfolder:'input'};
  });
  assert.equal(await service.upload(key,{path:source,originalname:'fixture.mp4',mimetype:'video/mp4',size:18}),'input/fixture.mp4');
  assert.ok(multipart.includes('name="image"'));assert.ok(multipart.includes('original-mp4-bytes'));
  assert.ok(!multipart.includes('apiKey'));
}));

test('a corrupt encrypted store is never silently overwritten',()=>fixture(async({service})=>{
  const {key}=await service.connect(exported);fs.writeFileSync(service.file,'corrupt encrypted data');
  await assert.rejects(service.status(key),{code:'RH_WEB_STORAGE_ERROR'});
  assert.equal(fs.readFileSync(service.file,'utf8'),'corrupt encrypted data');
}));

test('parallel stale responses share a token refresh, including a late stale response',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported),stale=[];
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt(userId,time/1000+7200),refresh_token:'fixture-rotated-refresh'}};
    if(route==='/uc/getUserInfo'){
      if(config.headers.Authorization==='Bearer '+exported.access)return new Promise(resolve=>stale.push(resolve));
      return {code:0,data:{id:userId,totalCoin:'600'}};
    }
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    throw Error('unexpected request');
  });
  const first=service.status(key),second=service.status(key);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stale.length,2);
  stale[0]({code:412});await first;
  stale[1]({code:412});await second;
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/uc/token/refresh').length,1);
}));

test('an expired media permission renews only upload auth, rebuilding the upload stream',()=>fixture(async({service,dir,calls,setHandler})=>{
  const {key}=await service.connect(exported),source=path.join(dir,'upload.mp4');fs.writeFileSync(source,'same-original-bytes');
  let uploads=0;
  setHandler(async config=>{
    if(new URL(config.url).pathname==='/api/instance/access/auth')return {code:0,data:{accessKey:'fixture-fresh-comfy-auth'}};
    assert.equal(new URL(config.url).pathname,'/upload/image');uploads++;
    if(uploads===1)return {code:412};
    assert.equal(config.headers['Rh-Comfy-Auth'],'fixture-fresh-comfy-auth');
    let body='';await new Promise((resolve,reject)=>{config.data.on('data',b=>{body+=b.toString();});config.data.on('end',resolve);config.data.on('error',reject);config.data.resume();});
    assert.ok(body.includes('same-original-bytes'));return {name:'upload.mp4',subfolder:''};
  });
  assert.equal(await service.upload(key,{path:source,originalname:'upload.mp4',mimetype:'video/mp4',size:19}),'upload.mp4');
  assert.equal(uploads,2);
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/task/create').length,0);
}));

test('credential refresh preserves a workspace created concurrently',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);let finishRefresh;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/getUserInfo')return config.headers.Authorization==='Bearer '+exported.access
      ?{code:412}:{code:0,data:{id:userId,totalCoin:'600'}};
    if(route==='/uc/token/refresh')return new Promise(resolve=>{finishRefresh=resolve;});
    if(route==='/api/workflow/upload')return {code:0,data:{id:'2110000000000000100'}};
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    throw Error('unexpected');
  });
  const check=service.status(key);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finishRefresh,'function');
  await service.prepare(key);
  finishRefresh({code:0,data:{access_token:jwt(userId,time/1000+7200),refresh_token:'fixture-new-refresh'}});
  await check;await service.prepare(key);
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/api/workflow/upload').length,1);
}));

test('export code is one-line JavaScript and contains only the intended session exporter',()=>{
  const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../public/rh-session.js',import.meta.url),'utf8'),context);
  const code=context.window.vantaRunningHubSessionCode;
  assert.ok(code.startsWith('javascript:'));assert.ok(!code.includes('\n'));
  const decoded=decodeURIComponent(code.slice('javascript:'.length));new vm.Script(decoded);
  assert.ok(!decoded.includes('fetch('));assert.ok(!decoded.includes('XMLHttpRequest'));
  assert.ok(!decoded.includes('localStorage.length'));assert.ok(!decoded.includes('cookies:document.cookie'));
});


test('raw access token authenticates directly and reimport retains verified refresh/upload metadata',()=>fixture(async({service,calls})=>{
  assert.equal(parseRunningHubSession('Bearer '+exported.access).access,exported.access);
  const first=await service.connect(exported);
  const next=await service.connect('Bearer '+jwt(userId,time/1000+8000));
  assert.equal(next.key,first.key);
  const before=calls.length;
  await service.status(next.key);
  assert.equal(calls[before].headers.Authorization,'Bearer '+jwt(userId,time/1000+8000));
  assert.ok(!calls.slice(before).some(c=>c.url.includes('/openapi/')));
}));

test('a task absent from the token account cannot be claimed as running or recovered',()=>fixture(async({service,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async()=>({code:0,data:{total:0,records:[]}}));
  const result=await service.request('/task/openapi/outputs',key,{taskId:renderId});
  assert.equal(result.code,802);
}));

test('manual Pool refresh renews a still-valid access token and persists each rotated refresh token',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);let count=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh'){
      assert.equal(config.headers.client,'WEB');assert.deepEqual(config.data,{});
      assert.equal(config.headers.Authorization,'Bearer '+(count?'fixture-rotation-'+count:exported.refresh));
      count++;return {code:0,data:{access_token:jwt(userId,time/1000+7200+count),refresh_token:'fixture-rotation-'+count}};
    }
    assert.equal(config.headers.Authorization,'Bearer '+jwt(userId,time/1000+7200+count));
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:587}};
    if(route==='/task/list')return {code:0,data:{total:2}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'NEW',balancePoint:25,transitionCoinRemained:587}};
    throw Error('Unexpected provider call');
  });
  for(let index=0;index<2;index++){
    const status=await service.status(key,{renewTokens:true});
    assert.equal(status.sessionRenewal.state,'renewed');assert.equal(status.currentTaskCounts,2);
    assert.equal(status.remainCoins,587);assert.equal(status.balancePoint,25);
  }
  assert.equal(count,2);assert.equal(service.sessionAudit(key).lastRenewal.outcome,'renewed');
  const publicData=JSON.stringify(service.sessionAudit(key));
  assert.ok(!publicData.includes(exported.refresh));assert.ok(!publicData.includes('fixture-rotation'));
  assert.ok(!calls.some(call=>/create|cancel|openapi/.test(new URL(call.url).pathname)));
}));

test('automatic renewal starts ten minutes before expiry while the browser is closed',()=>fixture(async({service,calls})=>{
  const {key}=await service.connect({...exported,access:jwt(userId,time/1000+8*60)});
  const before=calls.length;
  await service.status(key);
  assert.equal(new URL(calls[before].url).pathname,'/uc/token/refresh');
  assert.equal(service.sessionAudit(key).lastRenewal.outcome,'renewed');
}));

test('temporary proactive renewal failure keeps a still-valid access token usable',()=>fixture(async({service,setHandler})=>{
  const {key}=await service.connect({...exported,access:jwt(userId,time/1000+8*60)});
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh')throw Error('temporary network failure');
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:111}};
    if(route==='/task/list')return {code:0,data:{total:0}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD'}};
    throw Error('Unexpected request');
  });
  const status=await service.status(key);assert.equal(status.remainCoins,111);assert.equal(status.sessionVerified,true);
  assert.equal(service.sessionAudit(key).lastRenewal.code,'RH_WEB_TRANSPORT_ERROR');
  const manual=await service.status(key,{renewTokens:true});
  assert.equal(manual.sessionRenewal.state,'failed');assert.equal(manual.sessionRenewal.code,'RH_WEB_TRANSPORT_ERROR');
  assert.equal(manual.sessionVerified,true);
}));

test('a revoked grant is reported precisely once without claiming success or exposing provider secrets',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>({code:412,msg:'rejected '+exported.refresh+' '+exported.access}));
  const before=calls.length;
  await assert.rejects(service.status(key,{renewTokens:true}),error=>{
    assert.equal(error.code,'RH_WEB_REFRESH_REJECTED');assert.equal(error.providerCode,412);
    assert.ok(!error.message.includes(exported.refresh));assert.ok(!error.message.includes(exported.access));return true;
  });
  assert.equal(calls.slice(before).filter(call=>new URL(call.url).pathname==='/uc/token/refresh').length,1);
  assert.equal(service.sessionAudit(key).lastRenewal.providerCode,412);
  assert.notEqual(service.sessionAudit(key).lastRenewal.outcome,'renewed');
}));

test('parallel manual refreshes share one grant and a cross-account renewal never replaces credentials',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported),before=calls.length;
  await Promise.all([service.status(key,{renewTokens:true}),service.status(key,{renewTokens:true})]);
  assert.equal(calls.slice(before).filter(call=>new URL(call.url).pathname==='/uc/token/refresh').length,1);
  const expiry=service.sessionAudit(key).accessExpiresAt;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt('2110000000000000002'),refresh_token:'wrong-account-refresh'}};
    if(route==='/uc/getUserInfo')return {code:412};
    throw Error('Unexpected request');
  });
  await assert.rejects(service.status(key,{renewTokens:true}),{code:'RH_WEB_IDENTITY_MISMATCH'});
  assert.equal(service.sessionAudit(key).accessExpiresAt,expiry);
}));

test('backend renews every two hours without browser requests and persists separate check and token timestamps across restarts',()=>fixture(async({service,calls,advance,reopen,dir,setHandler})=>{
  const {key}=await service.connect({...exported,access:jwt(userId,time/1000+30*86400)});
  const originalHandler=async config=>{const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt(userId,time/1000+30*86400),refresh_token:'fixture-refreshed-token'}};
    if(route==='/uc/getUserInfo')return {code:0,data:{id:userId,totalCoin:600}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD'}};
    if(route==='/task/list')return {code:0,data:{total:1}};throw Error('Unexpected fixture route '+route);};
  setHandler(originalHandler);
  await service.status(key,{automatic:true});
  assert.equal(service.sessionAudit(key).lastAutomaticCheckAt,new Date(time).toISOString());
  assert.equal(service.sessionAudit(key).lastRenewedAt,null,'A balance check must not claim that a token was renewed');
  advance(2*60*60*1000);
  await service.status(key,{automatic:true});
  const audit=service.sessionAudit(key),renewedAt=new Date(time+7200000).toISOString();
  assert.equal(audit.lastRenewedAt,renewedAt);assert.equal(audit.lastAutomaticRenewedAt,renewedAt);
  assert.equal(audit.lastRenewal.source,'automatic');
  const grants=()=>calls.filter(c=>new URL(c.url).pathname==='/uc/token/refresh').length;
  assert.equal(grants(),1);
  advance(2*60*1000);await service.status(key,{automatic:true});
  assert.equal(grants(),1,'Two-minute checks must not rotate the token on every tick');
  const before=calls.length,restarted=reopen(),restored=restarted.sessionAudit(key);
  assert.equal(restored.lastRenewedAt,renewedAt);
  assert.equal(restored.lastAutomaticCheckAt,new Date(time+7320000).toISOString());
  assert.equal(restarted.cachedStatus(key).currentTaskCounts,1);
  assert.equal(restarted.cachedStatus(key).stale,false);
  advance(120*60*1000);assert.equal(restarted.cachedStatus(key).stale,false);
  advance(6*60*1000);assert.equal(restarted.cachedStatus(key).stale,true);
  assert.equal(calls.length,before,'Reading persisted receipts must not contact RunningHub');
  assert.ok(!fs.readFileSync(service.file,'utf8').includes(exported.refresh));
  assert.ok(!JSON.stringify({audit:restored,cached:restarted.cachedStatus(key)}).includes('fixture-refreshed-token'));
}));

test('a rejected account cannot stop healthy backend refreshes or advance its last successful token timestamp',()=>fixture(async({service,setHandler,advance})=>{
  const other='2110000000000000002';let rejectedGrants=0,healthyGrants=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD'}};
    if(route==='/uc/getUserInfo'){
      const sub=JSON.parse(Buffer.from(config.headers.Authorization.split('.')[1],'base64url')).sub;
      return {code:0,data:{id:sub,totalCoin:500}};
    }
    throw Error('Unexpected setup request');
  });
  const failed=await service.connect({...exported,access:jwt(userId,time/1000+30*86400),refresh:'fixture-bad-refresh'});
  const healthy=await service.connect({...exported,access:jwt(other,time/1000+30*86400),refresh:'fixture-good-refresh'});
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/uc/token/refresh'){
      if(config.headers.Authorization==='Bearer fixture-bad-refresh'){rejectedGrants++;return {code:412};}
      healthyGrants++;return {code:0,data:{access_token:jwt(other,time/1000+60*86400),refresh_token:'fixture-good-refresh'}};
    }
    const sub=JSON.parse(Buffer.from(config.headers.Authorization.split('.')[1],'base64url')).sub;
    if(sub===userId)return {code:412};
    if(route==='/uc/getUserInfo')return {code:0,data:{id:other,totalCoin:500}};
    if(route==='/task/list')return {code:0,data:{total:0}};
    if(route==='/uc/point/summary')return {code:0,data:{billingVersion:'OLD'}};
    throw Error('Unexpected read');
  });
  advance(7200000);
  const results=await Promise.allSettled([service.status(failed.key,{automatic:true}),service.status(healthy.key,{automatic:true})]);
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
  assert.equal(rejectedGrants,1);assert.equal(healthyGrants,1);
  assert.equal(service.sessionAudit(failed.key).lastRenewedAt,null);
  assert.equal(service.sessionAudit(failed.key).reconnectRequired,true);
  assert.equal(service.cachedStatus(failed.key).errorCode,'RH_WEB_REFRESH_REJECTED');
  advance(120000);
  await assert.rejects(service.status(failed.key,{automatic:true}),{code:'RH_WEB_REFRESH_REJECTED'});
  assert.equal(rejectedGrants,1,'An explicitly rejected grant must wait for reconnection or manual Refresh');
  assert.equal(service.sessionAudit(failed.key).lastAutomaticCheckAt,new Date(time+7320000).toISOString());
}));

test('successful preflight flag never replaces the final coin/point decision on create',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  const refusal={code:402,msg:'TASK_CREATE_FAILED_BY_NOT_ENOUGH_POWER_VALUE',data:null};
  let reply={code:0,data:{taskId:renderId}},saved;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid'){
      assert.equal(config.data.instanceType,'plus');
      assert.equal(JSON.parse(config.data.workflowContent).nodes[0].type,'PrimitiveString');
      return {code:0,data:{billingVersion:'NEW',canCreateTask:false}};
    }
    if(route==='/api/workflow/setContent'){saved=config.data.promptContent;return {code:0,data:null};}
    if(route==='/task/create'){
      assert.equal(config.data.promptContent,saved);assert.equal(config.data.instanceType,'plus');
      assert.equal(config.data.usePersonalQueue,false);
      assert.deepEqual(Object.keys(config.data).sort(),['clientId','instanceType','promptContent','usePersonalQueue','workflowId']);
      return reply;
    }
    throw Error('Unexpected native operation');
  });
  let submitted=0;
  const request=()=>service.submit(key,{instanceType:'plus',workflow:{'1':{class_type:'PrimitiveString',inputs:{value:'actual'}}}},
    {onBeforeSubmit:()=>submitted++});
  assert.equal((await request()).data.taskId,renderId,'A code0 preflight flag must not prevent a final provider acceptance');
  reply=refusal;
  assert.deepEqual(await request(),refusal,'A final provider refusal is preserved, not bypassed or retried');
  assert.equal(submitted,2);
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),Array(2).fill([
    '/api/workflow/getContent','/api/user/task/work/valid','/api/workflow/setContent','/task/create']).flat());
}));

test('a nonzero native validation refusal still stops before Save and create',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid')return {code:403,msg:'WORKFLOW_PERMISSION_DENIED'};
    throw Error('No Save or create after a refused validation request');
  });
  let submitted=0;
  await assert.rejects(service.submit(key,{instanceType:'default',workflow:{'1':{class_type:'PrimitiveString',inputs:{value:'actual'}}}},
    {onBeforeSubmit:()=>submitted++}),{code:'RH_WEB_PROVIDER_REJECTED',definitelyRejected:true});
  assert.equal(submitted,0);
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/api/workflow/getContent','/api/user/task/work/valid']);
}));

test('native Save failure is definite pre-submission; chosen mode is never changed',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid'){
      assert.equal(config.data.instanceType,'default');
      return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    }
    if(route==='/api/workflow/setContent')throw Error('Save acknowledgement lost');
    throw Error('No GPU allocation allowed');
  });
  let submitted=0;
  await assert.rejects(service.submit(key,{instanceType:'default',workflow:{'1':{class_type:'PrimitiveString',inputs:{value:'actual'}}}},
    {onBeforeSubmit:()=>submitted++}),{code:'RH_WEB_PREPARATION_FAILED',definitelyRejected:true});
  assert.equal(submitted,0);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,0);
}));

test('concurrent native submissions keep validation, Save and create together for each owned workspace',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  let saved;const sequence=[];
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/api/user/task/work/valid'){
      const editor=JSON.parse(config.data.workflowContent);
      sequence.push('valid:'+editor.nodes[0].widgets_values_named.value);
      await new Promise(resolve=>setImmediate(resolve));
      return {code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    }
    if(route==='/api/workflow/setContent'){
      saved=config.data.promptContent;sequence.push('save:'+JSON.parse(saved).prompt['1'].inputs.value);
      return {code:0,data:null};
    }
    if(route==='/task/create'){
      assert.equal(config.data.promptContent,saved);
      const value=JSON.parse(saved).prompt['1'].inputs.value;
      sequence.push('create:'+value);
      assert.equal(config.data.instanceType,value==='A'?'default':'plus');
      return {code:0,data:{taskId:renderId}};
    }
    throw Error('Unexpected operation');
  });
  await Promise.all(['A','B'].map(value=>service.submit(key,{instanceType:value==='A'?'default':'plus',
    workflow:{'1':{class_type:'PrimitiveString',inputs:{value}}}},
    {onBeforeSubmit:()=>sequence.push('mark:'+value)})));
  assert.deepEqual(sequence,['valid:A','save:A','mark:A','create:A','valid:B','save:B','mark:B','create:B']);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,2);
}));

test('invalid editor ports and graphs fail before any workspace or GPU request',()=>fixture(async({service,calls})=>{
  const {key}=await service.connect(exported);calls.length=0;
  for(const workflow of ['invalid json',{},
    {'1':{class_type:'UnknownNode',inputs:{}}},
    {'1':{class_type:'PrimitiveString',inputs:{value:['999',0]}}},
    {'1':{class_type:'PrimitiveString',inputs:{value:'text'}},'2':{class_type:'PreviewImage',inputs:{images:['1',0]}}}]){
    await assert.rejects(service.submit(key,{workflow,instanceType:'default'}),{code:'RH_WEB_INVALID_GRAPH',definitelyRejected:true});
  }
  assert.equal(calls.length,0,'No provider request after invalid prompt or typed connection');
}));
