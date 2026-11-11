// Owner-only account diagnosis. This module cannot create, upload, cancel,
// reroute, retire accounts, or infer API spending rights from a total balance.
const BALANCE_FIELDS=new Set([
  'remainCoins','remainMoney','totalCoins','availableCoins','availableBalance',
  'paidCoins','freeCoins','paidRHCoins','freeRHCoins','remainPaidCoins',
  'remainFreeCoins','paidCoinBalance','freeCoinBalance','paidBalance','freeBalance',
  'balancePoint','paidPoint','bonusPoint','activityPoint','transitionCoinRemained','walletBalance','virtualCoin','virtualCoinDaily'
]);
const finite=value=>value!==null&&value!==''&&typeof value!=='boolean'&&
  ['number','string'].includes(typeof value)&&Number.isFinite(Number(value))?Number(value):null;
const enumValue=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(value)?value:null;
function workspaceAudit(value){
  if(!value||typeof value!=='object')return null;
  return {configured:value.configured===true,reference:enumValue(value.reference),
    contentCode:finite(value.contentCode),activeListCode:finite(value.activeListCode),
    contentFields:Array.isArray(value.contentFields)?value.contentFields.filter(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x)&&!/key|token|secret|password|authorization/i.test(x)):[],
    ownerMatches:typeof value.ownerMatches==='boolean'?value.ownerMatches:null,
    draft:typeof value.draft==='boolean'?value.draft:null,
    saved:value.saved===true,
    runValidation:{code:finite(value.runValidation?.code),
      canCreateTask:typeof value.runValidation?.canCreateTask==='boolean'?value.runValidation.canCreateTask:null,
      billingVersion:enumValue(value.runValidation?.billingVersion)},
    workflowState:finite(value.workflowState)??enumValue(value.workflowState),
    contentPresent:value.contentPresent===true,activeMatch:value.activeMatch===true,
    vantaWorkspaces:Array.isArray(value.vantaWorkspaces)?value.vantaWorkspaces.slice(0,10).map(x=>({reference:enumValue(x.reference),cachedMatch:x.cachedMatch===true})):[]};
}
export async function auditRunningHubAccounts({accounts,request,now=()=>new Date()}){
  const rows=await Promise.all(accounts.map(async account=>{
    const base={accountId:account.id,accountName:account.name};
    try{
      const reply=await request('/uc/openapi/accountStatus',account.key,{apikey:account.key,inspectWorkspace:true},20000);
      if(!reply||Number(reply.code)!==0||!reply.data||typeof reply.data!=='object')
        return {...base,status:'unavailable'};
      const data=reply.data,balances={};
      for(const field of BALANCE_FIELDS){
        const value=finite(data[field]);if(value!==null)balances[field]=value;
      }
      return {...base,status:'verified',apiType:enumValue(data.apiType),
        billingVersion:enumValue(data.billingVersion),balanceUnit:enumValue(data.balanceUnit),
        ...(data.apiType==='WEB_SESSION'?{sessionVerified:data.sessionVerified===true,
          billingSummaryVerified:data.billingSummaryVerified===true,billingConverting:data.billingConverting===true,
          accountReference:enumValue(data.accountReference),workspace:workspaceAudit(data.workspace)}:{}),
        currency:enumValue(data.currency),balances,
        responseFields:Object.keys(data).filter(field=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)&&
          !/key|token|secret|password|authorization/i.test(field)).sort()};
    }catch{return {...base,status:'unavailable'};}
  }));
  return {checkedAt:now().toISOString(),readOnly:true,accounts:rows};
}
