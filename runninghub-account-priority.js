// RunningHub generation policy only. Account retention and existing tasks stay independent.
// All verified balances above the minimum are eligible; no upper credit limit.
export const MIN_ELIGIBLE_CREDITS=100;

const balanceOf=status=>{
  if(!status||status.error||status.remainCoins==null)return null;
  const credits=Number(status.remainCoins);
  return Number.isFinite(credits)?credits:null;
};

export function canGenerateWithAccount(status,minimum=MIN_ELIGIBLE_CREDITS){
  const credits=balanceOf(status);
  return credits!==null&&credits>=minimum;
}

function timeOf(value){
  const date=Date.parse(value||'');
  return Number.isFinite(date)?date:0;
}

// Higher eligible RH balance first (including balances above 600); at equal balance,
// newly added keys take precedence, then accounts not used before, then fewer tasks.
// This never mutates vault storage order and does not change RunningHub task identity.
export function rankGenerationAccounts(checked,minimum=MIN_ELIGIBLE_CREDITS){
  return checked.filter(x=>x?.account&&canGenerateWithAccount(x.status,minimum))
    .sort((x,y)=>{
      const creditDiff=Number(y.status.remainCoins)-Number(x.status.remainCoins);
      if(creditDiff)return creditDiff;
      const ageDiff=timeOf(y.account.addedAt)-timeOf(x.account.addedAt);
      if(ageDiff)return ageDiff;
      const unusedDiff=Number(!y.account.lastUsedAt)-Number(!x.account.lastUsedAt);
      if(unusedDiff)return unusedDiff;
      const tasksDiff=Number(x.status.currentTaskCounts||0)-Number(y.status.currentTaskCounts||0);
      if(tasksDiff)return tasksDiff;
      return String(x.account.id).localeCompare(String(y.account.id));
    });
}
