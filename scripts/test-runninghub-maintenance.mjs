import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRunningHubMaintenance,RH_POOL_INTERVAL_MS,RH_RENEW_BEFORE_MS} from '../runninghub-maintenance.js';
const now=Date.UTC(2026,10,16),iso=ms=>new Date(ms).toISOString();
const session={refresh:'fixture',connectedAt:iso(now),expiresAt:now+8*3600000,
  poolSnapshot:{lastAutomaticCheckAt:iso(now)}};
test('new accounts are due immediately; ordinary maintenance is every two hours',()=>{
  assert.equal(nextRunningHubMaintenance({},now),now);
  assert.equal(RH_POOL_INTERVAL_MS,7200000);
  assert.equal(nextRunningHubMaintenance(session,now),now+7200000);
  assert.equal(nextRunningHubMaintenance({...session,refresh:''},now),now+7200000);
});
test('a known earlier access expiry schedules renewal without minute polling',()=>{
  assert.equal(nextRunningHubMaintenance({...session,expiresAt:now+3600000},now),now+3600000-RH_RENEW_BEFORE_MS);
});
test('rejected and transient grants back off instead of making an expired-token timer spin',()=>{
  for(const code of ['RH_WEB_REFRESH_REJECTED','RH_WEB_REFRESH_MISSING','RH_WEB_IDENTITY_MISMATCH','RH_NETWORK_ERROR']){
    const value={...session,expiresAt:now-1,lastRenewal:{outcome:'failed',code,at:iso(now)}};
    assert.equal(nextRunningHubMaintenance(value,now),now+7200000);
  }
});
test('a newly imported credential resets the renewal age; next deadline survives restart',()=>{
  const fresh={...session,connectedAt:iso(now+3600000),lastRenewedAt:iso(now-3600000),
    poolSnapshot:{lastAutomaticCheckAt:iso(now+3600000)}};
  assert.equal(nextRunningHubMaintenance(JSON.parse(JSON.stringify(fresh)),now+3600000),now+10800000);
});
