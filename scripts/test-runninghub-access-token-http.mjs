import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';

test('real HTTP routes authenticate token imports, reject API keys and purge existing credentials at startup',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-token-http-'));
  const password='token-http-owner-fixture-password',master='token-http-encryption-fixture';
  const cipherKey=crypto.createHash('sha256').update(master).digest();
  const encrypt=value=>{
    const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',cipherKey,iv);
    const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
    return [iv,c.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');
  };
  const decrypt=value=>{
    const [iv,tag,body]=value.split('.').map(x=>Buffer.from(x,'base64url'));
    const d=crypto.createDecipheriv('aes-256-gcm',cipherKey,iv);d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(body),d.final()]).toString());
  };
  const legacy='legacy-rh-api-key-fixture-delete',userId='2110000000000000001';
  const access='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:userId,exp:Date.now()/1000+3600})).toString('base64url')+'.fixture-signature';
  const lowUserId='2110000000000000002';
  const lowAccess='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:lowUserId,exp:Date.now()/1000+3600})).toString('base64url')+'.fixture-signature';
  const lowBalanceFile=path.join(dir,'low-balance.json');fs.writeFileSync(lowBalanceFile,'0');
  fs.writeFileSync(path.join(dir,'accounts.enc'),encrypt({accounts:[{id:'old',key:legacy}]}));
  fs.writeFileSync(path.join(dir,'task-registry.enc'),encrypt({version:2,tasks:[
    {taskId:'2110000000000000021',accountId:'old',key:legacy,status:'success',resultUrl:'https://files.runninghub.ai/original.mp4',finishedAt:new Date().toISOString()}
  ],retiredAccounts:[{id:'old',key:legacy}]}));
  const axiosUrl=new URL('../node_modules/axios/index.js',import.meta.url).href;
  const preload=path.join(dir,'provider-fixture.mjs'),calls=path.join(dir,'provider-calls.jsonl');
  fs.writeFileSync(preload,`
    import axios from ${JSON.stringify(axiosUrl)};
    import fs from 'node:fs';
    let currentAccess=${JSON.stringify(access)},currentRefresh='fixture-refresh-token',renewalCount=0;
    axios.request=async config=>{
      const route=new URL(config.url).pathname;
      if(route==='/uc/token/refresh'){
        if(config.headers.Authorization!=='Bearer '+currentRefresh||config.headers.client!=='WEB')throw Error('Unexpected refresh grant');
        renewalCount++;
        currentAccess='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:${JSON.stringify(userId)},exp:Math.floor(Date.now()/1000)+7200+renewalCount})).toString('base64url')+'.fixture-new-signature';
        currentRefresh='fixture-rotated-refresh-'+renewalCount;
        fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:config.method,route})+'\\n');
        return {status:200,data:{code:0,data:{access_token:currentAccess,refresh_token:currentRefresh}}};
      }
      const low=config.headers.Authorization===${JSON.stringify('Bearer '+lowAccess)};
      if(!low&&config.headers.Authorization!=='Bearer '+currentAccess&&config.headers.Authorization!==${JSON.stringify('Bearer '+access)})throw Error('Unexpected fixture authentication');
      fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:config.method,route})+'\\n');
      if(route==='/uc/getUserInfo')return {status:200,data:{code:0,data:{id:low?${JSON.stringify(lowUserId)}:${JSON.stringify(userId)},
        totalCoin:low?fs.readFileSync(${JSON.stringify(lowBalanceFile)},'utf8'):'600'}}};
      if(route==='/uc/point/summary')return {status:200,data:{code:0,data:{billingVersion:low?'NEW':'OLD',converting:false,
        balancePoint:low?'427.5':'0',paidPoint:0,bonusPoint:low?'427.5':'0',activityPoint:0}}};
      if(route==='/task/list')return {status:200,data:{code:0,data:{total:0,records:config.data.taskId==='2110000000000000021'
        ?[{taskId:'2110000000000000021',taskStatus:'RUNNING'}]:[]}}};
      throw Error('Unexpected provider request: '+route);
    };
  `);
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const server=spawn(process.execPath,['--import',preload,'server.js'],{cwd:new URL('..',import.meta.url).pathname,
    env:{...process.env,PORT:String(port),VANTA_DATA_DIR:dir,APP_MASTER_KEY:master,
      AGENT_INTERNAL_TOKEN:'token-http-internal-fixture-at-least-thirty-two',VANTA_AGENT_OWNER_KEY:password,
      VANTA_RESULTS_BUCKET_ENDPOINT:'',VANTA_RESULTS_BUCKET_NAME:'',VANTA_RESULTS_BUCKET_ACCESS_KEY_ID:'',VANTA_RESULTS_BUCKET_SECRET_ACCESS_KEY:'',
      VANTA_H3_LONG_BENCHMARK:'',VANTA_H3_SAFE_BENCHMARK:'',VANTA_REFERENCE_AUDIT_TASK:''},stdio:['ignore','pipe','pipe']});
  let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  const base='http://127.0.0.1:'+port;
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(server.exitCode!==null)throw Error('Fixture server exited: '+output.slice(-500));
      try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(ready,'Fixture server should start');
    assert.equal((await (await fetch(base+'/health')).json()).runningHubAuthentication,'access-token');
    const headers={'Content-Type':'application/json','X-Vanta-Auth':'1','X-Vanta-Device':'fixture-device-01234567890'};
    const post=(route,body,h=headers)=>fetch(base+route,{method:'POST',headers:h,body:JSON.stringify(body)});
    assert.equal((await post('/api/runninghub/access-token',{session:access})).status,401);
    let response=await post('/api/auth/login',{password});assert.equal(response.status,200);
    headers.Cookie=response.headers.get('set-cookie').split(';')[0];
    response=await post('/api/auth/change-password',{oldPassword:password,newPassword:'changed-fixture-owner-password'});
    assert.equal(response.status,200);headers.Cookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/api/accounts',{apiKey:legacy})).status,410);
    response=await fetch(base+'/api/session',{headers:{...headers,Cookie:headers.Cookie+'; vanta_session_v2='+encrypt({accounts:[{id:'resurrect',key:legacy}]})}});
    assert.deepEqual((await response.json()).accounts,[]);
    assert.ok(response.headers.get('set-cookie').includes('vanta_session_v2=;'));
    response=await post('/api/runninghub/access-token',{session:{site:'runninghub.ai',access,refresh:'fixture-refresh-token',identify:'fixture-identify'}});
    assert.equal(response.status,200);const first=await response.json();
    assert.equal(first.account.connectionMode,'access-token');assert.equal(first.updated,false);
    assert.ok(!JSON.stringify(first).includes(access));
    response=await post('/api/accounts',{accessToken:access});assert.equal(response.status,200);
    const again=await response.json();assert.equal(again.updated,true);assert.equal(again.account.id,first.account.id);
    response=await post('/api/accounts/refresh',{});assert.equal(response.status,200);
    const refreshedFirst=await response.json();
    assert.equal(refreshedFirst.accounts[0].status.remainCoins,600);
    assert.deepEqual(refreshedFirst.tokenRenewal,{requested:1,renewed:1,failed:0});
    assert.equal(refreshedFirst.accounts[0].status.sessionRenewal.state,'renewed');
    assert.equal((await fetch(base+'/api/runninghub/session-audit')).status,401);
    response=await fetch(base+'/api/runninghub/session-audit',{headers});assert.equal(response.status,200);
    const metadata=await response.json();assert.equal(metadata.accounts[0].lastRenewal.outcome,'renewed');
    assert.equal(metadata.accounts[0].refreshAvailable,true);
    assert.doesNotMatch(JSON.stringify(metadata),/fixture-refresh|fixture-rotated|fixture-new-signature/);
    assert.equal((await fetch(base+'/api/accounts/status')).status,401);
    const providerBefore=fs.readFileSync(calls,'utf8');
    response=await fetch(base+'/api/accounts/status',{headers});assert.equal(response.status,200);
    const snapshot=await response.json();
    assert.equal(snapshot.poolRefresh.automatic,true);
    assert.equal(snapshot.poolRefresh.checkIntervalSeconds,120);assert.equal(snapshot.poolRefresh.renewIntervalSeconds,3600);
    assert.equal(snapshot.poolRefresh.lastTokenRefreshAt,metadata.accounts[0].lastRenewedAt);
    assert.equal(snapshot.accounts[0].status.currentTaskCounts,0);
    assert.equal(fs.readFileSync(calls,'utf8'),providerBefore,'Reading the Pool receipt must not trigger refresh or provider polling');
    assert.doesNotMatch(JSON.stringify(snapshot),/fixture-refresh|fixture-rotated|fixture-new-signature/);
    response=await post('/api/accounts/refresh',{});
    assert.equal((await response.json()).tokenRenewal.renewed,1,'Refresh must acquire a new token even while the current one is still valid');
    response=await post('/api/runninghub/access-token',{session:access},{...headers,Origin:'https://attacker.example'});
    assert.equal(response.status,403);
    const stored=decrypt(fs.readFileSync(path.join(dir,'accounts.enc'),'utf8'));
    assert.equal(stored.accounts.length,1);assert.match(stored.accounts[0].key,/^rhweb:[a-f0-9]{64}$/);
    const history=decrypt(fs.readFileSync(path.join(dir,'task-registry.enc'),'utf8'));
    assert.equal(history.tasks[0].key,undefined);assert.equal(history.tasks[0].status,'success');
    assert.deepEqual(history.retiredAccounts,[]);
    response=await post('/api/tasks/2110000000000000022/recover',{});
    assert.equal(response.status,404,'A task absent from this account cannot acquire its credentials');
    response=await post('/api/tasks/2110000000000000021/recover',{});
    assert.equal(response.status,200);assert.equal((await response.json()).accountId,'old');
    const restored=decrypt(fs.readFileSync(path.join(dir,'task-registry.enc'),'utf8'));
    assert.equal(restored.tasks[0].key,stored.accounts[0].key);
    assert.equal((await fetch(base+'/api/tasks/2110000000000000021/audit')).status,401);
    assert.equal((await fetch(base+'/api/tasks/2110000000000000022/audit',{headers})).status,404);
    response=await fetch(base+'/api/tasks/2110000000000000021/audit',{headers});
    assert.equal(response.status,200);
    const diagnosis=await response.json();assert.equal(diagnosis.found,true);assert.equal(diagnosis.taskStatus,'RUNNING');
    assert.ok(!JSON.stringify(diagnosis).includes(access));
    // These are real authenticated HTTP endpoints, including the immediate
    // refresh/reload used by the Connect button. Only the provider is mocked.
    let lowAccountId;
    const importRoutes=['/api/runninghub/access-token','/api/accounts','/api/runninghub/web-session'];
    for(const [index,coins]of [0,0.25,99].entries()){
      fs.writeFileSync(lowBalanceFile,String(coins));
      response=await post(importRoutes[index],{session:lowAccess});
      assert.equal(response.status,200,'A valid low-balance token must be accepted');
      const connected=await response.json();
      assert.equal(connected.updated,index!==0);assert.equal(connected.account.status.remainCoins,coins);
      assert.equal(connected.account.canGenerate,true,'A verified web session is not blocked by old RH-coin balance');
      assert.equal(connected.account.status.balancePoint,427.5);
      assert.equal(connected.account.status.balanceUnit,'POINTS');
      assert.ok(!JSON.stringify(connected).includes(lowAccess));
      if(lowAccountId)assert.equal(connected.account.id,lowAccountId,'Reconnect must update the same account');
      lowAccountId=connected.account.id;
      response=await fetch(base+'/api/session',{headers});
      assert.ok((await response.json()).accounts.some(a=>a.id===lowAccountId),'Token must survive a session reload');
      for(let check=0;check<2;check++){
        response=await post('/api/accounts/refresh',{});assert.equal(response.status,200);
        const refreshed=await response.json();
        const account=refreshed.accounts.find(a=>a.id===lowAccountId);
        assert.ok(account,'Refresh must not immediately remove a new low-balance import');
        assert.equal(account.status.remainCoins,coins);assert.equal(account.status.currentTaskCounts,0);
        assert.equal(refreshed.autoRemovedCount,0);assert.equal(refreshed.accounts.length,2);
      }
      const persisted=decrypt(fs.readFileSync(path.join(dir,'accounts.enc'),'utf8'));
      assert.ok(persisted.accounts.some(a=>a.id===lowAccountId),'The token account must persist in the encrypted vault');
    }
    // Changing the obsolete RH-coin ledger must never delete a funded points account.
    fs.writeFileSync(lowBalanceFile,'100');response=await post('/api/accounts/refresh',{});
    const eligible=await response.json();assert.equal(eligible.accounts.find(a=>a.id===lowAccountId).canGenerate,true);
    const qualified=decrypt(fs.readFileSync(path.join(dir,'accounts.enc'),'utf8'));
    assert.equal(qualified.accounts.find(a=>a.id===lowAccountId).lowBalanceImportAt,undefined);
    fs.writeFileSync(lowBalanceFile,'99');response=await post('/api/accounts/refresh',{});
    const retired=await response.json();assert.equal(retired.autoRemovedCount,0);
    assert.ok(retired.accounts.some(a=>a.id===lowAccountId),'Web points accounts cannot be retired using the RH-only threshold');
    assert.ok(!fs.readFileSync(path.join(dir,'runninghub-web-sessions.enc'),'utf8').includes(access));
    const routes=fs.readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x).route);
    assert.ok(routes.every(route=>['/uc/getUserInfo','/uc/point/summary','/uc/token/refresh','/task/list'].includes(route)),'Connecting or refreshing an account must never start inference or call OpenAPI');
  }finally{
    server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});
