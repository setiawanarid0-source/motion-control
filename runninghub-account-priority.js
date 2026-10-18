// RunningHub generation policy only. Account retention and existing tasks stay independent.
// Accounts over 600 RH remain visible in the pool but cannot fund NEW generation.
export const MAX_NEW_TASK_CREDITS=600;
export const MIN_ELIGIBLE_CREDITS=100;

const balanceOf=status=>{
  if(!status||status.error||status.remainCoins==null)return null;
  const credits=Number(status.remainCoins);
  return Number.isFinite(credits)?credits:null;
};

export function canGenerateWithAccount(status,minimum=MIN_ELIGIBLE_CREDITS,maximum=MAX_NEW_TASK_CREDITS){
  const credits=balanceOf(status);
  return credits!==null&&credits>=minimum&&credits<=maximum;
}

function timeOf(value){
  const date=Date.parse(value||'');
  return Number.isFinite(date)?date:0;
}

// Higher eligible RH balance first (600 before 599); at equal balance,
// unused/newly added keys take precedence, newest first, then fewer tasks.
// This never mutates vault storage order and does not change RunningHub task identity.
export function rankGenerationAccounts(checked,minimum=MIN_ELIGIBLE_CREDITS,maximum=MAX_NEW_TASK_CREDITS){
  return checked.filter(x=>x?.account&&canGenerateWithAccount(x.status,minimum,maximum))
    .sort((x,y)=>{
      const creditDiff=Number(y.status.remainCoins)-Number(x.status.remainCoins);
      if(creditDiff)return creditDiff;
      const unusedDiff=Number(!y.account.lastUsedAt)-Number(!x.account.lastUsedAt);
      if(unusedDiff)return unusedDiff;
      const ageDiff=timeOf(y.account.addedAt)-timeOf(x.account.addedAt);
      if(ageDiff)return ageDiff;
      const tasksDiff=Number(x.status.currentTaskCounts||0)-Number(y.status.currentTaskCounts||0);
      if(tasksDiff)return tasksDiff;
      return String(x.account.id).localeCompare(String(y.account.id));
    });
}
