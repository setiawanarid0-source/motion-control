import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRunningHubWebSession,parseRunningHubSession,isRunningHubWebKey} from '../runninghub-web-session.js';
import {runningHubWebBalance,webBalanceNumber} from '../runninghub-web-balance.js';
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
    '1':{class_type:'VHS_LoadVideo',inputs:{video:'old.mp4'}}};
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
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/workflow/setContent').length,1,'Reconnecting must retain initialization of the VANTA-only workspace');
}));

test('a lost create acknowledgement never causes another paid request or an OpenAPI fallback',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>{
    if(new URL(config.url).pathname==='/api/workflow/upload')return {code:0,data:{id:'2110000000000000100'}};
    if(new URL(config.url).pathname==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(new URL(config.url).pathname==='/task/create')throw Error('Lost response after task acceptance');
    throw Error('unexpected');
  });
  await assert.rejects(service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'}),{code:'RH_WEB_TRANSPORT_ERROR'});
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
  setHandler(async config=>new URL(config.url).pathname==='/api/workflow/getContent'?{code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}}:{code:412,msg:'Token expired'});
  const response=await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'});
  assert.equal(response.code,412);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
}));

test('only an explicit taskless missing-workflow refusal invalidates the cached reference, without replaying',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);await service.prepare(key);calls.length=0;
  let reply;
  setHandler(async config=>{
    const route=new URL(config.url).pathname;
    if(route==='/api/workflow/getContent')return {code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    if(route==='/task/create')return reply;
    throw Error('No automatic re-import or create replay');
  });
  for(reply of [{msg:'WORKFLOW_NOT_EXISTS'},{code:0,msg:'WORKFLOW_NOT_EXISTS'},
    {code:380,msg:'WORKFLOW_NOT_EXISTS',data:{taskId:renderId}}]){
    await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'});
    assert.equal(await service.prepare(key),'2110000000000000100');
  }
  reply={code:380,msg:'WORKFLOW_NOT_EXISTS'};
  await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'});
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
  new vm.Script(code.slice('javascript:'.length));
  assert.ok(!code.includes('fetch('));assert.ok(!code.includes('XMLHttpRequest'));
  assert.ok(!code.includes('localStorage.length'));assert.ok(!code.includes('cookies:document.cookie'));
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

test('backend renews hourly without browser requests and persists separate check and token timestamps across restarts',()=>fixture(async({service,calls,advance,reopen,dir})=>{
  const {key}=await service.connect({...exported,access:jwt(userId,time/1000+30*86400)});
  await service.status(key,{automatic:true});
  assert.equal(service.sessionAudit(key).lastAutomaticCheckAt,new Date(time).toISOString());
  assert.equal(service.sessionAudit(key).lastRenewedAt,null,'A balance check must not claim that a token was renewed');
  advance(60*60*1000);
  await service.status(key,{automatic:true});
  const audit=service.sessionAudit(key),renewedAt=new Date(time+3600000).toISOString();
  assert.equal(audit.lastRenewedAt,renewedAt);assert.equal(audit.lastAutomaticRenewedAt,renewedAt);
  assert.equal(audit.lastRenewal.source,'automatic');
  const grants=()=>calls.filter(c=>new URL(c.url).pathname==='/uc/token/refresh').length;
  assert.equal(grants(),1);
  advance(2*60*1000);await service.status(key,{automatic:true});
  assert.equal(grants(),1,'Two-minute checks must not rotate the token on every tick');
  const before=calls.length,restarted=reopen(),restored=restarted.sessionAudit(key);
  assert.equal(restored.lastRenewedAt,renewedAt);
  assert.equal(restored.lastAutomaticCheckAt,new Date(time+3720000).toISOString());
  assert.equal(restarted.cachedStatus(key).currentTaskCounts,1);
  assert.equal(restarted.cachedStatus(key).stale,false);
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
  advance(3600000);
  const results=await Promise.allSettled([service.status(failed.key,{automatic:true}),service.status(healthy.key,{automatic:true})]);
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
  assert.equal(rejectedGrants,1);assert.equal(healthyGrants,1);
  assert.equal(service.sessionAudit(failed.key).lastRenewedAt,null);
  assert.equal(service.sessionAudit(failed.key).reconnectRequired,true);
  assert.equal(service.cachedStatus(failed.key).errorCode,'RH_WEB_REFRESH_REJECTED');
  advance(120000);
  await assert.rejects(service.status(failed.key,{automatic:true}),{code:'RH_WEB_REFRESH_REJECTED'});
  assert.equal(rejectedGrants,1,'An explicitly rejected grant must wait for reconnection or manual Refresh');
  assert.equal(service.sessionAudit(failed.key).lastAutomaticCheckAt,new Date(time+3720000).toISOString());
}));
