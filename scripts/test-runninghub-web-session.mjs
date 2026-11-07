import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRunningHubWebSession,parseRunningHubSession,isRunningHubWebKey} from '../runninghub-web-session.js';

const time=Date.UTC(2026,10,8),userId='2110000000000000001',renderId='2110000000000000999';
const jwt=(sub=userId,exp=time/1000+3600)=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub,exp})).toString('base64url')+'.fixture-signature';
const exported={site:'runninghub.ai',access:jwt(),refresh:'fixture-refresh-token',identify:'fixture_identify',comfyAuth:'fixture-comfy-token'};
async function fixture(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rh-web-')),calls=[],secret=crypto.randomBytes(32);
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
    if(route==='/uc/token/refresh')return {code:0,data:{access_token:jwt(userId,time/1000+7200),refresh_token:'fixture-refreshed-token'}};
    if(route==='/task/list')return {code:0,data:{total:1,records:config.data.taskId?[{taskId:renderId,taskStatus:'SUCCESS'}]:[]}};
    if(route==='/api/workflow/create')return {code:0,data:{workflowId:'2110000000000000100'}};
    if(route==='/task/create')return {code:0,data:{taskId:renderId,taskStatus:'QUEUED'}};
    if(route==='/api/output/v2/history')return {code:0,data:[
      {taskId:'2110000000000000998',fileUrl:'https://example.com/wrong.mp4',outputType:'mp4',nodeId:'490'},
      {taskId:renderId,fileUrl:'https://example.com/correct.mp4',outputType:'mp4',nodeId:'490'}]};
    throw Error('Unexpected fixture route '+route);
  };
  const http={request:async config=>{
    calls.push(config);return {status:200,data:await handler(config)};
  }};
  const service=createRunningHubWebSession({dir,encrypt,decrypt,http,now:()=>time});
  try{await run({dir,calls,service,encrypt,decrypt,setHandler:fn=>{handler=fn;}});}
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
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/uc/getUserInfo']);
  assert.equal(fs.statSync(service.file).mode&0o777,0o600);
  assert.ok(!fs.readFileSync(service.file,'utf8').includes(exported.access));
  const second=await service.connect({...exported,access:jwt(userId,time/1000+5000)});
  assert.equal(first.key,second.key,'reconnect must not invalidate accepted task credentials');
}));

test('never stores an unverified or below-minimum account',()=>fixture(async({service,setHandler})=>{
  setHandler(async()=>({code:0,data:{id:userId,totalCoin:'99'}}));
  await assert.rejects(service.connect(exported),{code:'RH_WEB_LOW_BALANCE'});
  assert.ok(!fs.existsSync(service.file));
  setHandler(async()=>({code:0,data:{id:userId}}));
  await assert.rejects(service.connect(exported),{code:'RH_WEB_BALANCE_UNAVAILABLE'});
  assert.ok(!fs.existsSync(service.file));
}));

test('expired imported access token uses refresh credentials before verifying the account',()=>fixture(async({service,calls})=>{
  await service.connect({...exported,access:jwt(userId,time/1000-1)});
  assert.equal(new URL(calls[0].url).pathname,'/uc/token/refresh');
  assert.equal(calls[0].headers.Authorization,'Bearer '+exported.refresh);
  assert.equal(new URL(calls[1].url).pathname,'/uc/getUserInfo');
  assert.notEqual(calls[1].headers.Authorization,'Bearer '+exported.access);
}));

test('web create uses the editor body, applies existing input overrides and never saves an existing editor',()=>fixture(async({service,calls})=>{
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
    assert.notEqual(new URL(c.url).pathname,'/api/workflow/setContent');
  }
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
  // The private workspace is reused, including after reconnect.
  await service.connect(exported);
  await service.request('/task/openapi/create',key,{workflow:JSON.stringify(graph)});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/api/workflow/create').length,1);
}));

test('a lost create acknowledgement never causes another paid request or an OpenAPI fallback',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>{
    if(new URL(config.url).pathname==='/api/workflow/create')return {code:0,data:{id:'2110000000000000100'}};
    if(new URL(config.url).pathname==='/task/create')throw Error('Lost response after task acceptance');
    throw Error('unexpected');
  });
  await assert.rejects(service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'}),{code:'RH_WEB_TRANSPORT_ERROR'});
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
  assert.ok(calls.every(c=>!c.url.includes('/openapi/')));
}));

test('provider authentication refusal on create does not replay the create request',()=>fixture(async({service,calls,setHandler})=>{
  const {key}=await service.connect(exported);
  setHandler(async config=>new URL(config.url).pathname==='/api/workflow/create'?{code:0,data:{id:'2110000000000000100'}}:{code:412,msg:'Token expired'});
  const response=await service.request('/task/openapi/create',key,{workflow:'{"1":{"class_type":"Fixture","inputs":{}}}'});
  assert.equal(response.code,412);
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/task/create').length,1);
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
    if(route==='/api/workflow/create')return {code:0,data:{id:'2110000000000000100'}};
    if(route==='/task/list')return {code:0,data:{total:0,records:[]}};
    throw Error('unexpected');
  });
  const check=service.status(key);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finishRefresh,'function');
  await service.prepare(key);
  finishRefresh({code:0,data:{access_token:jwt(userId,time/1000+7200),refresh_token:'fixture-new-refresh'}});
  await check;await service.prepare(key);
  assert.equal(calls.filter(x=>new URL(x.url).pathname==='/api/workflow/create').length,1);
}));

test('export code is one-line JavaScript and contains only the intended session exporter',()=>{
  const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../public/rh-session.js',import.meta.url),'utf8'),context);
  const code=context.window.vantaRunningHubSessionCode;
  assert.ok(code.startsWith('javascript:'));assert.ok(!code.includes('\n'));
  new vm.Script(code.slice('javascript:'.length));
  assert.ok(!code.includes('fetch('));assert.ok(!code.includes('XMLHttpRequest'));
  assert.ok(!code.includes('localStorage.length'));assert.ok(!code.includes('cookies:document.cookie'));
});
