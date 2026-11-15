// Owner-only account diagnosis. This module cannot create, upload, cancel,
// reroute, retire accounts, or infer API spending rights from a total balance.
import {billingScalars} from './runninghub-billing-evidence.js';
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
  const numbers={};
  for(const [name,fieldValue] of Object.entries(value.runValidation?.numericFields||{})){
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||!/coin|point|amount|cost|duration|limit|balance|price|reserve/i.test(name)||/key|token|secret|password|authorization/i.test(name))continue;
    const number=finite(fieldValue);if(number!==null&&number>=0)numbers[name]=number;
  }
  return {configured:value.configured===true,reference:enumValue(value.reference),
    contentCode:finite(value.contentCode),activeListCode:finite(value.activeListCode),
    contentFields:Array.isArray(value.contentFields)?value.contentFields.filter(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x)&&!/key|token|secret|password|authorization/i.test(x)):[],
    ownerMatches:typeof value.ownerMatches==='boolean'?value.ownerMatches:null,
    draft:typeof value.draft==='boolean'?value.draft:null,
    saved:value.saved===true,
    contentNodeCount:finite(value.contentNodeCount),
    ...(value.validatedWorkflow==='motionflyHD'?{validatedWorkflow:'motionflyHD',validatedNodeCount:finite(value.validatedNodeCount),
      validatedGraphSha256:/^[a-f0-9]{64}$/.test(value.validatedGraphSha256||'')?value.validatedGraphSha256:null,
      validationMedia:value.validationMedia==='placeholder-file-names'?'placeholder-file-names':null}:{}),
    runValidation:{instanceType:['default','plus'].includes(value.runValidation?.instanceType)?value.runValidation.instanceType:null,
      code:finite(value.runValidation?.code),
      canCreateTask:typeof value.runValidation?.canCreateTask==='boolean'?value.runValidation.canCreateTask:null,
      billingVersion:enumValue(value.runValidation?.billingVersion),
      providerMessage:typeof value.runValidation?.providerMessage==='string'&&/^[A-Z][A-Z0-9_]{0,119}$/.test(value.runValidation.providerMessage)?value.runValidation.providerMessage:null,
      responseFields:Array.isArray(value.runValidation?.responseFields)?value.runValidation.responseFields.filter(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x)&&!/key|token|secret|password|authorization/i.test(x)):[],numericFields:numbers},
    workflowState:finite(value.workflowState)??enumValue(value.workflowState),
    contentPresent:value.contentPresent===true,activeMatch:value.activeMatch===true,
    vantaWorkspaces:Array.isArray(value.vantaWorkspaces)?value.vantaWorkspaces.slice(0,10).map(x=>({reference:enumValue(x.reference),cachedMatch:x.cachedMatch===true})):[]};
}
export async function auditRunningHubAccounts({accounts,request,instanceType='default',workflowAudit=null,includeBilling=false,now=()=>new Date()}){
  if(!['default','plus'].includes(instanceType))throw Error('Mode audit tidak valid.');
  const rows=await Promise.all(accounts.map(async account=>{
    const base={accountId:account.id,accountName:account.name};
    try{
      const reply=await request('/uc/openapi/accountStatus',account.key,{apikey:account.key,inspectWorkspace:true,instanceType,
        ...(workflowAudit?{workflowAudit}:{}),...(includeBilling?{inspectBilling:true}:{})},20000);
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
        currency:enumValue(data.currency),balances,...(includeBilling?{billingEvidence:billingScalars(data.billingEvidence)}:{}),
        responseFields:Object.keys(data).filter(field=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)&&
          !/key|token|secret|password|authorization/i.test(field)).sort()};
    }catch{return {...base,status:'unavailable'};}
  }));
  return {checkedAt:now().toISOString(),readOnly:true,instanceType,accounts:rows};
}
