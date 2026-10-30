import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {partitionAccountRefresh} from '../account-eligibility.js';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const browser=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=server.indexOf('async function refreshPool(req){');
const end=server.indexOf("\napp.post('/api/accounts/refresh'",begin);
assert.ok(begin>0&&end>begin,'Use actual production refreshPool code');
const archiveStart=server.indexOf('function scheduleAccountResultArchiving(accountId){');
const archiveEnd=server.indexOf('\nconst generationQueue=',archiveStart);
assert.ok(archiveStart>0&&archiveEnd>archiveStart);
const code=server.slice(archiveStart,archiveEnd)+'\n'+server.slice(begin,end);

const initial=[
  {id:'acc-0',name:'Empty',key:'a'.repeat(16)},
  {id:'acc-99',name:'Low',key:'b'.repeat(16)},
  {id:'acc-100',name:'Ready',key:'c'.repeat(16)},
  {id:'acc-active',name:'Running',key:'d'.repeat(16)},
  {id:'acc-error',name:'Unknown',key:'e'.repeat(16)}
];
let live=structuredClone(initial);
const statusByKey=new Map([
  ['a'.repeat(16),{remainCoins:0,currentTaskCounts:0}],
  ['b'.repeat(16),{remainCoins:99,currentTaskCounts:0}],
  ['c'.repeat(16),{remainCoins:100,currentTaskCounts:0}],
  ['d'.repeat(16),{remainCoins:12,currentTaskCounts:2}]
]);
const events=[];
const ctx={
  getPersistentAccounts:()=>({deviceId:'global',accounts:structuredClone(live)}),
  accountStatus:async key=>{
    if(!statusByKey.has(key))throw Error('RunningHub temporarily unreachable');
    return statusByKey.get(key);
  },
  partitionAccountRefresh,MIN_POOL_CREDITS:100,
  loadGlobalAccounts:()=>structuredClone(live),
  saveVaultAccounts:(_deviceId,next)=>{events.push('save:'+next.map(x=>x.id).join(','));live=structuredClone(next);},
  taskRegistry:{
    retireAccount:account=>events.push('escrow:'+account.id),
    publicList:()=>[{accountId:'acc-active',status:'success',resultUrl:'https://files.runninghub.ai/video.mp4'}]
  },
  // Real archive scheduler must swallow a failed media scheduling attempt.
  scheduleResultMirror:task=>{
    events.push('archive:'+task.accountId);
    throw Error('Storage unavailable');
  },
  publicAccount:(account,status)=>({id:account.id,status}),
  console:{info:()=>{},warn:message=>events.push('warn:'+message)}
};
vm.runInNewContext(code+'\nthis.runRefresh=refreshPool;',ctx);
const result=await ctx.runRefresh({headers:{},body:{allowRetirement:false}});
assert.equal(result.autoRemovedCount,3,
  '0/99/12 RH must be retired even if legacy allowRetirement=false');
assert.deepEqual(live.map(x=>x.id),['acc-100','acc-error'],
  'Confirmed <100 RH accounts cannot remain in the pool');
assert.deepEqual(events.filter(x=>x.startsWith('escrow:')),
  ['escrow:acc-0','escrow:acc-99','escrow:acc-active'],
  'Save encrypted credential escrow for each retired account');
const saveIndex=events.findIndex(x=>x.startsWith('save:'));
assert.equal(saveIndex,3,'Escrow must be committed before deleting pool entries');
assert.deepEqual(events.filter(x=>x.startsWith('archive:')),
  ['archive:acc-active'],
  'Existing successful outputs continue to be scheduled after account removal');
assert.ok(events.some(x=>x.startsWith('warn:')),
  'Archive failures are logged for retry, without resurrecting low-credit account');
assert.ok(!code.includes('ensureAccountResultsArchived'),
  'Object-storage availability must not block 100-RH rule');
assert.ok(!code.includes('req.body?.allowRetirement'),
  'Browser history-claim flag must never disable low-credit cleanup');
assert.ok(browser.includes("body:'{}'"),'Client must trigger refresh without retirement gate');
assert.ok(!browser.includes('allowRetirement:state.historyClaimed===true'));
assert.ok(server.includes('setInterval(()=>{void checkPoolBalancesInBackground();},2*60*1000)'),
  'Auto cleanup must continue when the VANTA browser is closed');
console.log('PASS: 0/99/12 RH accounts auto-remove (even active tasks), >=100 and unknown balances stay, escrow precedes deletion, archiving does not block.');
