// Legacy RH-only eligibility remains available for older callers. Access-token
// accounts use verified web sessions, with actual funding validated by RunningHub.
export const MIN_ELIGIBLE_CREDITS=100;

const balanceOf=status=>{
  if(!status||status.error||status.remainCoins==null)return null;
  const credits=Number(status.remainCoins);
  return Number.isFinite(credits)?credits:null;
};

export function canGenerateWithAccount(status,minimum=MIN_ELIGIBLE_CREDITS){
  // A web token can spend points or use web benefits even when old RH coins
  // are zero. RunningHub validates actual funding when it receives the task.
  if(status?.apiType==='WEB_SESSION')return !status.error&&status.sessionVerified===true&&!status.billingConverting;
  const credits=balanceOf(status);
  return credits!==null&&credits>=minimum;
}

function timeOf(value){
  const date=Date.parse(value||'');
  return Number.isFinite(date)?date:0;
}

// Higher balances first within each unit (RH or points); at equal balance,
// newly added keys take precedence, then accounts not used before, then fewer tasks.
// This never mutates vault storage order and does not change RunningHub task identity.
export function rankGenerationAccounts(checked,minimum=MIN_ELIGIBLE_CREDITS){
  return checked.filter(x=>x?.account&&canGenerateWithAccount(x.status,minimum))
    .sort((x,y)=>{
      const points=s=>s?.billingVersion==='NEW';
      const a=points(x.status)?x.status.balancePoint:x.status.remainCoins;
      const b=points(y.status)?y.status.balancePoint:y.status.remainCoins;
      const positive=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>0;
      if(positive(a)!==positive(b))return Number(positive(b))-Number(positive(a));
      // Compare balances within the same unit; never invent a points/RH rate.
      const creditDiff=points(x.status)===points(y.status)?Number(b)-Number(a):0;
      if(Number.isFinite(creditDiff)&&creditDiff)return creditDiff;
      const ageDiff=timeOf(y.account.addedAt)-timeOf(x.account.addedAt);
      if(ageDiff)return ageDiff;
      const unusedDiff=Number(!y.account.lastUsedAt)-Number(!x.account.lastUsedAt);
      if(unusedDiff)return unusedDiff;
      const tasksDiff=Number(x.status.currentTaskCounts||0)-Number(y.status.currentTaskCounts||0);
      if(tasksDiff)return tasksDiff;
      return String(x.account.id).localeCompare(String(y.account.id));
    });
}
