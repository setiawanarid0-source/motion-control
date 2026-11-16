export const RH_POOL_INTERVAL_MS=2*60*60*1000;
export const RH_RENEW_BEFORE_MS=10*60*1000;
export const RH_POOL_CACHE_TTL_MS=RH_POOL_INTERVAL_MS+5*60*1000;
export const RH_RECONNECT_CODES=new Set(['RH_WEB_REFRESH_REJECTED','RH_WEB_REFRESH_MISSING','RH_WEB_IDENTITY_MISMATCH']);
const at=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:null;};

// No minute-based polling: wake for the next two-hour check or a known token
// expiry. Failed renewals wait for the next maintenance period; manual Refresh
// can retry sooner. A revoked/missing grant always needs valid credentials.
export function nextRunningHubMaintenance(session,now=Date.now()){
  const checked=at(session.poolSnapshot?.lastAutomaticCheckAt);
  if(checked===null)return now;
  const regular=checked+RH_POOL_INTERVAL_MS;
  if(!session.refresh)return regular;
  const renewed=at(session.lastRenewedAt),connected=at(session.connectedAt);
  const credential=Math.max(renewed??0,connected??0)||checked;
  const failure=session.lastRenewal?.outcome==='failed'?session.lastRenewal:null;
  if(failure&&RH_RECONNECT_CODES.has(failure.code))return regular;
  const failed=at(failure?.at);
  if(failed!==null&&failed>=credential)return Math.min(regular,failed+RH_POOL_INTERVAL_MS);
  const expiry=Number(session.expiresAt);
  return Math.min(regular,credential+RH_POOL_INTERVAL_MS,
    Number.isFinite(expiry)&&expiry>0?expiry-RH_RENEW_BEFORE_MS:Infinity);
}
