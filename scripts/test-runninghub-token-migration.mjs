import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {migrateRunningHubAccessTokens} from '../runninghub-token-migration.js';
import {createTaskRegistry} from '../task-registry.js';

function fixture(run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-token-purge-')),secret=crypto.randomBytes(32);
  const seal=value=>{
    const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,iv);
    const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
    return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');
  };
  const decrypt=value=>{try{
    const raw=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',secret,raw.subarray(0,12));
    d.setAuthTag(raw.subarray(12,28));return JSON.parse(Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString());
  }catch{return null;}};
  const save=(file,value)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),seal(value));};
  const read=file=>decrypt(fs.readFileSync(path.join(dir,file),'utf8'));
  try{return run({dir,encrypt:seal,decrypt,save,read});}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('purges RunningHub keys from pool, retired/active/completed tasks and legacy files; retains media and KIE',()=>fixture(f=>{
  const ref='rhweb:'+'a'.repeat(64),legacy='private-runninghub-api-key';
  f.save('accounts.enc',{accounts:[{id:'old',key:legacy},{id:'token',key:ref}]});
  f.save('account-vaults/device.enc',{accounts:[{id:'device',key:legacy}]});
  f.save('accounts.enc.tmp-crashed',{accounts:[{key:legacy}]});
  f.save('task-registry.enc',{version:2,tasks:[
    {taskId:'2110000000000000001',accountId:'old',key:legacy,status:'running'},
    {taskId:'2110000000000000002',accountId:'old',key:legacy,status:'success',resultUrl:'https://files.runninghub.ai/result.mp4'},
    {taskId:'2110000000000000003',accountId:'token',key:ref,status:'queued'}],
    retiredAccounts:[{id:'old',key:legacy},{id:'token',key:ref}]});
  f.save('kie/accounts.enc',{accounts:[{id:'kie',key:'kie-private-key'}]});
  fs.mkdirSync(path.join(f.dir,'motion-results'));fs.writeFileSync(path.join(f.dir,'motion-results/result.mp4'),'original-video');
  const kie=fs.readFileSync(path.join(f.dir,'kie/accounts.enc'),'utf8');
  const report=migrateRunningHubAccessTokens(f);
  assert.equal(report.removedPoolKeys,1);assert.equal(report.removedTaskKeys,2);assert.equal(report.removedRetiredKeys,1);
  assert.equal(report.removedLegacyKeys,1);
  assert.deepEqual(f.read('accounts.enc').accounts,[{id:'token',key:ref}]);
  const registry=f.read('task-registry.enc');
  assert.equal(registry.tasks[0].key,undefined);assert.equal(registry.tasks[0].status,'unavailable');
  assert.equal(registry.tasks[1].key,undefined);assert.equal(registry.tasks[1].status,'success');
  assert.ok(registry.tasks[1].resultUrl.endsWith('/result.mp4'));
  assert.equal(registry.tasks[2].key,ref);assert.equal(registry.tasks[2].status,'queued');
  assert.deepEqual(registry.retiredAccounts,[{id:'token',key:ref}]);
  assert.equal(fs.existsSync(path.join(f.dir,'account-vaults/device.enc')),false);
  assert.equal(fs.existsSync(path.join(f.dir,'accounts.enc.tmp-crashed')),false);
  assert.equal(fs.readFileSync(path.join(f.dir,'kie/accounts.enc'),'utf8'),kie);
  assert.equal(fs.readFileSync(path.join(f.dir,'motion-results/result.mp4'),'utf8'),'original-video');
  const second=migrateRunningHubAccessTokens(f);assert.equal(second.removedPoolKeys,0);assert.equal(second.removedTaskKeys,0);
  assert.equal(fs.statSync(path.join(f.dir,'accounts.enc')).mode&0o777,0o600);
  const restored=createTaskRegistry(f).add({taskId:'2110000000000000001',accountId:'token',key:ref});
  assert.equal(restored.accountId,'old','Recovered token must preserve historical media ownership');
  assert.equal(f.read('task-registry.enc').tasks[0].key,ref);
}));

test('an empty global vault prevents resurrection of old device/cookie credentials',()=>fixture(f=>{
  f.save('account-vaults/device.enc',{accounts:[{id:'old',key:'deleted-private-api-key'}]});
  migrateRunningHubAccessTokens(f);
  assert.deepEqual(f.read('accounts.enc').accounts,[]);
  assert.deepEqual(fs.readdirSync(path.join(f.dir,'account-vaults')),[]);
}));

test('corrupt permanent vaults stop migration before any credential deletion',()=>fixture(f=>{
  f.save('accounts.enc',{accounts:[{id:'old',key:'do-not-partially-purge'}]});
  fs.writeFileSync(path.join(f.dir,'task-registry.enc'),'corrupt');
  assert.throws(()=>migrateRunningHubAccessTokens(f),/unreadable vault/);
  assert.equal(f.read('accounts.enc').accounts[0].key,'do-not-partially-purge');
}));
