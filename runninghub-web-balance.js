// RunningHub's own web client reads /uc/getUserInfo and /uc/point/summary.
// OLD accounts use RH coins; NEW accounts display points. Keep both ledgers
// separate, and keep absent/invalid numbers unknown rather than inventing zero.
function webDecimalNumber(value){
  if(typeof value==='string'){
    value=value.trim();
    // Match native decimal values, including BigDecimal exponent strings.
    // Commas are supported only as complete thousands groups, never decimals.
    if(value.includes(',')){
      if(!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(value))return null;
      value=value.replaceAll(',','');
    }
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))return null;
    value=Number(value);
  }
  return typeof value==='number'&&Number.isFinite(value)?(value===0?0:value):null;
}

// Counters and reward quantities stay nonnegative; a ledger can be negative.
export function webBalanceNumber(value){
  const parsed=webDecimalNumber(value);
  return parsed!==null&&parsed>=0?parsed:null;
}
export function webLedgerBalanceNumber(value){return webDecimalNumber(value);}

export function webBalanceEncoding(value){
  if(value===null)return 'null';
  if(value===undefined)return 'missing';
  if(typeof value==='number')return !Number.isFinite(value)?'non_finite_number':value<0?'negative_number':'number';
  if(typeof value!=='string')return typeof value;
  if(!value.trim())return 'empty_string';
  if(webLedgerBalanceNumber(value)===null)return 'unsupported_string';
  return /[eE]/.test(value)?'scientific_string':'decimal_string';
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
    balancePoint:webLedgerBalanceNumber(summary?.balancePoint),
    paidPoint:webBalanceNumber(summary?.paidPoint),
    bonusPoint:webBalanceNumber(summary?.bonusPoint),
    activityPoint:webBalanceNumber(summary?.activityPoint),
    transitionCoinRemained:webBalanceNumber(summary?.transitionCoinRemained),
    walletBalance:webBalanceNumber(wallet?.balance),currency,
    accountReference:String(profile?.id||profile?.userId||'').slice(-6)
  };
}
