import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isRunningHubWebKey} from './runninghub-web-session.js';

// Purge the owner's RunningHub API keys without deleting task history or media.
// Never retain a credential backup, or import deleted keys from old device vaults.
export function migrateRunningHubAccessTokens({dir,encrypt,decrypt,now=()=>Date.now()}){
  const accountFile=path.join(dir,'accounts.enc'),registryFile=path.join(dir,'task-registry.enc');
  const marker=path.join(dir,'runninghub-access-token-migration.json');
  const decode=file=>{
    const data=decrypt(fs.readFileSync(file,'utf8').trim());
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('RunningHub credential migration: unreadable vault');
    return data;
  };
  const atomic=(file,data)=>{
    const temp=file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,encrypt(data),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
    finally{fs.rmSync(temp,{force:true});}
  };
  const oldAccounts=fs.existsSync(accountFile)?decode(accountFile):{accounts:[]};
  if(!Array.isArray(oldAccounts.accounts))throw Error('RunningHub credential migration: invalid account vault');
  const registry=fs.existsSync(registryFile)?decode(registryFile):null;
  if(registry&&!Array.isArray(registry.tasks))throw Error('RunningHub credential migration: invalid task registry');
  const legacyDir=path.join(dir,'account-vaults');
  const legacy=fs.existsSync(legacyDir)?fs.readdirSync(legacyDir)
    .filter(name=>/\.enc(?:[.-].*)?$/.test(name)).map(name=>path.join(legacyDir,name)):[];
  // Validate every permanent vault before changing any of them.
  const recovered=legacy.filter(file=>file.endsWith('.enc')).flatMap(file=>{
    const data=decode(file);
    if(!Array.isArray(data.accounts))throw Error('RunningHub credential migration: invalid legacy vault');
    return data.accounts;
  });
  const allowed=oldAccounts.accounts.filter(account=>isRunningHubWebKey(account?.key));
  const report={version:1,authentication:'access-token',completedAt:new Date(now()).toISOString(),
    removedPoolKeys:oldAccounts.accounts.length-allowed.length,
    removedLegacyKeys:recovered.filter(account=>!isRunningHubWebKey(account?.key)).length,
    removedTaskKeys:0,removedRetiredKeys:0,removedLegacyFiles:legacy.length};
  if(registry){
    for(const task of registry.tasks)if(task.key&&!isRunningHubWebKey(task.key)){
      delete task.key;report.removedTaskKeys++;
      if(!['success','failed'].includes(task.status)){
        task.status='unavailable';
        task.error='API key lama dihapus. Hubungkan access token akun yang sama untuk memulihkan akses task.';
      }
    }
    const retired=Array.isArray(registry.retiredAccounts)?registry.retiredAccounts:[];
    registry.retiredAccounts=retired.filter(account=>isRunningHubWebKey(account?.key));
    report.removedRetiredKeys=retired.length-registry.retiredAccounts.length;
  }
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  // The empty global file also permanently disables old cookie/vault recovery.
  atomic(accountFile,{...oldAccounts,accounts:allowed,updatedAt:report.completedAt});
  if(registry&&(report.removedTaskKeys||report.removedRetiredKeys))atomic(registryFile,registry);
  for(const file of legacy)fs.rmSync(file,{force:true});
  for(const name of fs.readdirSync(dir))if(/^(accounts|task-registry)\.enc[.-]/.test(name))
    fs.rmSync(path.join(dir,name),{force:true});
  if(!fs.existsSync(marker)||Object.entries(report).some(([key,value])=>key.startsWith('removed')&&value))
    fs.writeFileSync(marker,JSON.stringify(report),{mode:0o600});
  return report;
}
