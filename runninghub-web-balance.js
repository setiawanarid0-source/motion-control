// RunningHub's own web client reads /uc/getUserInfo and /uc/point/summary.
// OLD accounts use RH coins; NEW accounts display points. Keep both ledgers
// separate, and keep absent/invalid numbers unknown rather than inventing zero.
export function webBalanceNumber(value){
  if(typeof value==='string'){
    value=value.trim().replaceAll(',','');
    if(!/^\d+(?:\.\d+)?$/.test(value))return null;
    value=Number(value);
  }
  return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
}

export function runningHubWebBalance(profile,summary){
  const version=['OLD','NEW'].includes(summary?.billingVersion)?summary.billingVersion:'UNKNOWN';
  const wallet=profile?.walletInfo;
  const currency=['USD','CNY'].includes(wallet?.currency)?wallet.currency:null;
  return {
    apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:version,billingSummaryVerified:version!=='UNKNOWN',
    billingConverting:summary?.converting===true,
    balanceUnit:version==='NEW'?'POINTS':version==='OLD'?'RH':'UNKNOWN',
    remainCoins:webBalanceNumber(profile?.totalCoin),
    virtualCoin:webBalanceNumber(profile?.virtualCoin),
    virtualCoinDaily:webBalanceNumber(profile?.virtualCoinDaily),
    balancePoint:webBalanceNumber(summary?.balancePoint),
    paidPoint:webBalanceNumber(summary?.paidPoint),
    bonusPoint:webBalanceNumber(summary?.bonusPoint),
    activityPoint:webBalanceNumber(summary?.activityPoint),
    transitionCoinRemained:webBalanceNumber(summary?.transitionCoinRemained),
    walletBalance:webBalanceNumber(wallet?.balance),currency,
    accountReference:String(profile?.id||profile?.userId||'').slice(-6)
  };
}
