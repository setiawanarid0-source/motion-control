import {webBalanceNumber} from './runninghub-web-balance.js';
import {RH_POOL_INTERVAL_MS} from './runninghub-maintenance.js';

// The native welfare store uses Asia/Shanghai for its reward-day boundary.
export const RH_REWARD_TIMEZONE='Asia/Shanghai';
const dayFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:RH_REWARD_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function runningHubRewardDay(time){
  const parts=Object.fromEntries(dayFormatter.formatToParts(new Date(time)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const states=new Set(['claimed','already_claimed','unavailable','pending','failed','requires_action']);
export function publicDailyCredit(value){
  if(!value||!states.has(value.state))return null;
  return {state:value.state,day:/^\d{4}-\d{2}-\d{2}$/.test(value.day||'')?value.day:null,
    checkedAt:value.checkedAt||null,claimedAt:value.claimedAt||null,attemptedAt:value.attemptedAt||null,
    amount:webBalanceNumber(value.amount),providerCode:Number.isFinite(value.providerCode)?value.providerCode:null};
}

export function createRunningHubDailyCredit({get,remember,post,now}){
  const checking=new Map();
  const snapshot=key=>publicDailyCredit(get(key).dailyCredit);
  async function readSummary(key){
    // issue:false is the native read-only mode; do not issue other welfare
    // coupons, claim membership allocations, or change a subscription.
    const reply=await post(key,'/api/welfare/summary',{issue:false});
    if(Number(reply.code)!==0||!reply.data||typeof reply.data!=='object')
      throw Object.assign(new Error('Daily credit status unavailable'),{code:'RH_DAILY_STATUS_UNAVAILABLE',providerCode:Number(reply.code)});
    return reply.data;
  }
  async function claim(key){
    if(!checking.has(key))checking.set(key,(async()=>{
      const previous=snapshot(key),day=runningHubRewardDay(now());
      if(previous?.day===day&&['claimed','already_claimed'].includes(previous.state))
        return {receipt:previous,attempted:false};
      const save=(state,patch={})=>{
        const receipt=publicDailyCredit({...(previous?.day===runningHubRewardDay(now())?previous:{}),
          state,day:runningHubRewardDay(now()),checkedAt:new Date(now()).toISOString(),...patch});
        // Patch only this receipt; never write an old credential snapshot back.
        remember(key,{dailyCredit:receipt});return receipt;
      };
      let summary;
      try{summary=await readSummary(key);}
      catch(cause){return {receipt:save('failed',{providerCode:Number.isFinite(cause.providerCode)?cause.providerCode:null}),attempted:false};}
      const gift=summary.dailyGift;
      if(summary.enabled!==true||!gift||typeof gift.granted!=='boolean')
        return {receipt:save('unavailable'),attempted:false};
      if(gift.granted)return {receipt:save('already_claimed',{amount:webBalanceNumber(gift.amount)}),attempted:false};
      // The native Claim button is available when enabled and not granted.
      // Re-read status before retrying an unconfirmed attempt; back off for two
      // hours, including after process restarts. Explicit challenges stay manual.
      if(previous?.day===day&&(previous.state==='requires_action'||
        now()-Date.parse(previous.attemptedAt||'')<RH_POOL_INTERVAL_MS))
        return {receipt:previous,attempted:false};
      const attemptedAt=new Date(now()).toISOString();
      save('pending',{attemptedAt});
      let failure;
      try{
        const reply=await post(key,'/api/welfare/daily-gift/claim',{}, {retryAuth:false});
        if(Number(reply.code)!==0)failure={providerCode:Number.isFinite(Number(reply.code))?Number(reply.code):null,
          challenge:/captcha|challenge|verification|required.?verify/i.test(String(reply.msg||reply.message||''))};
      }catch{failure={providerCode:null};}
      // A success acknowledgement alone is not proof of a granted reward.
      // This also reconciles an acknowledgement lost after a successful claim.
      try{summary=await readSummary(key);}
      catch{return {receipt:save('pending',{attemptedAt,providerCode:failure?.providerCode??null}),attempted:true};}
      if(summary.dailyGift?.granted===true)return {receipt:save('claimed',{
        attemptedAt,claimedAt:new Date(now()).toISOString(),amount:webBalanceNumber(summary.dailyGift.amount),providerCode:0}),attempted:true};
      return {receipt:save(failure?.challenge?'requires_action':failure?'failed':'pending',{
        attemptedAt,providerCode:failure?.providerCode??null}),attempted:true};
    })().finally(()=>checking.delete(key)));
    return checking.get(key);
  }
  return {claim,snapshot};
}
