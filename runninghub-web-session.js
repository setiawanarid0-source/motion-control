// The consumer editor protocol is separate from OpenAPI. A web credential is
// an opaque reference into this encrypted store, never an API key substitute.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import FormData from 'form-data';
import axios from 'axios';

export const RH_WEB_ORIGIN='https://www.runninghub.ai';
export const isRunningHubWebKey=key=>/^rhweb:[a-f0-9]{64}$/.test(String(key||''));
const taskId=value=>/^\d{10,25}$/.test(String(value||''));
const recordList=data=>Array.isArray(data)?data:Array.isArray(data?.records)?data.records:[];
const authFailure=response=>[401,412].includes(Number(response?.code));
const error=(message,code='RH_WEB_ERROR',definite=false)=>Object.assign(new Error(message),{code,definitelyRejected:definite});
function token(value){
  if(typeof value!=='string')return '';
  value=value.trim().replace(/^Bearer\s+/i,'');
  if(value.startsWith('"')){try{value=JSON.parse(value);}catch{return '';}}
  return typeof value==='string'&&value.length>=12&&value.length<=16384&&/^[A-Za-z0-9._~+\/=:-]+$/.test(value)?value:'';
}
function claim(access){try{return JSON.parse(Buffer.from(access.split('.')[1],'base64url').toString());}catch{return {};}}
function cookies(value){
  const out=Object.create(null);
  if(typeof value!=='string')return out;
  for(const pair of value.split(';')){
    const at=pair.indexOf('=');if(at<0)continue;
    const name=pair.slice(0,at).trim().toLowerCase();
    if(!['rh-accesstoken','rh-refreshtoken','rh-identify','rh-comfy-auth'].includes(name))continue;
    try{out[name]=decodeURIComponent(pair.slice(at+1).trim());}catch{}
  }
  return out;
}
export function parseRunningHubSession(input){
  if(typeof input==='string'&&!input.trim().startsWith('{'))input={site:'runninghub.ai',access:input};
  try{if(typeof input==='string'&&input.length<=98304)input=JSON.parse(input);}catch{}
  if(!input||typeof input!=='object'||Array.isArray(input)||!['runninghub.ai','www.runninghub.ai'].includes(input.site))
    throw error('Tempel access token atau JSON dari popup RunningHub.','RH_WEB_INVALID_SESSION',true);
  if(JSON.stringify(input).length>98304)throw error('Data sesi terlalu besar.','RH_WEB_INVALID_SESSION',true);
  const cookie=cookies(input.cookies),stores=[input.localStorage,input.sessionStorage].filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  const find=name=>{
    if(cookie[name.toLowerCase()])return cookie[name.toLowerCase()];
    for(const store of stores)for(const key of Object.keys(store))if(key.toLowerCase()===name.toLowerCase())return store[key];
    return '';
  };
  // The website gives its exact auth cookie precedence over stale localStorage.
  const access=token(cookie['rh-accesstoken']||input.access||find('Rh-Accesstoken'));
  const refresh=token(cookie['rh-refreshtoken']||input.refresh||find('Rh-Refreshtoken'));
  if(!access||/^javascript:/i.test(access))throw error('Access token tidak ditemukan. Login RunningHub lalu salin ulang token.','RH_WEB_INVALID_SESSION',true);
  const identify=String(input.identify||find('Rh-Identify')||'');
  if(identify&&!/^[A-Za-z0-9_-]{1,128}$/.test(identify))throw error('Identitas sesi tidak valid.','RH_WEB_INVALID_SESSION',true);
  const payload=claim(access);
  return {access,refresh,identify,comfyAuth:token(input.comfyAuth||find('Rh-Comfy-Auth')),
    expiresAt:Number.isFinite(Number(payload.exp))?Number(payload.exp)*1000:null};
}
const METHODS=new Set(['/uc/getUserInfo','/uc/token/refresh','/api/instance/access/auth',
  '/api/workflow/create','/task/create','/task/list','/task/cancel','/task/failedReason',
  '/api/output/v2/history']);

export function createRunningHubWebSession({dir,encrypt,decrypt,http=axios,now=()=>Date.now(),minimumCredits=100}){
  const file=path.join(dir,'runninghub-web-sessions.enc'),refreshing=new Map(),creating=new Map(),comfyRefreshing=new Map();
  function read(){
    if(!fs.existsSync(file))return {};
    const value=decrypt(fs.readFileSync(file,'utf8').trim());
    if(value?.version!==1||!value.sessions||Array.isArray(value.sessions)||typeof value.sessions!=='object')
      throw error('Penyimpanan sesi RunningHub tidak dapat dibaca.','RH_WEB_STORAGE_ERROR',true);
    return value.sessions;
  }
  function write(id,value){
    const sessions=read();sessions[id]=value;
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const temp=file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,encrypt({version:1,sessions}),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
    finally{fs.rmSync(temp,{force:true});}
  }
  function get(key){
    if(!isRunningHubWebKey(key))throw error('Referensi sesi tidak valid.','RH_WEB_INVALID_SESSION',true);
    const value=read()[key.slice(6)];
    if(!value)throw error('Sesi RunningHub tidak tersedia. Hubungkan ulang akun.','RH_WEB_AUTH_EXPIRED',true);
    return value;
  }
  function remember(key,patch){const value={...get(key),...patch};write(key.slice(6),value);return value;}
  function redact(text,session){
    let result=String(text||'');
    for(const key of ['access','refresh','comfyAuth'])if(session?.[key])result=result.replaceAll(session[key],'[redacted]');
    return result.slice(0,700);
  }
  async function raw(session,route,data,{timeout=30000,form=false,refresh=false}={}){
    if(!METHODS.has(route)&&route!=='/upload/image')throw error('Operasi sesi web ini belum didukung.','RH_WEB_UNSUPPORTED_OPERATION',true);
    const headers={Authorization:'Bearer '+(refresh?session.refresh:session.access),Accept:'application/json',
      ...(form?data.getHeaders():{'Content-Type':'application/json'})};
    if(route==='/upload/image'){
      headers['Rh-Comfy-Auth']=session.comfyAuth;
      headers['Rh-Identify']=session.identify;
    }
    const url=new URL(route,RH_WEB_ORIGIN);
    if(route==='/upload/image'){
      // The native editor includes its short-lived media auth in both places.
      // No redirect or raw Axios error is exposed with this credentialed URL.
      url.searchParams.set('Rh-Comfy-Auth',session.comfyAuth);
      url.searchParams.set('Rh-Identify',session.identify);
    }
    let response;
    try{response=await http.request({method:'POST',url:url.href,data,headers,
      timeout,maxRedirects:0,maxBodyLength:Infinity,maxContentLength:4*1024*1024,validateStatus:()=>true});}
    catch{throw error(route==='/task/create'
      ?'Koneksi ke RunningHub terputus. Periksa History sebelum mengirim generate lagi.'
      :'Koneksi ke RunningHub belum berhasil. Coba periksa sesi lagi.','RH_WEB_TRANSPORT_ERROR');}
    const result=response.data;
    if(result&&typeof result==='object'&&!Array.isArray(result)){
      if(response.status===401&&!Object.hasOwn(result,'code'))return {code:401,msg:'Session expired'};
      return result;
    }
    throw error('Respons RunningHub tidak valid. Tugas tidak dikirim ulang otomatis.','RH_WEB_PROTOCOL_ERROR');
  }
  async function refresh(session){
    if(!session.refresh)throw error('Sesi RunningHub kedaluwarsa. Login dan tempel sesi baru di Pool.','RH_WEB_AUTH_EXPIRED',true);
    const result=await raw(session,'/uc/token/refresh',{}, {refresh:true});
    const data=result.data,access=token(data?.access_token),next=token(data?.refresh_token)||session.refresh;
    if(Number(result.code)!==0||!access)throw error('Sesi RunningHub tidak dapat diperbarui. Login dan tempel sesi baru.','RH_WEB_AUTH_EXPIRED',true);
    const claims=claim(access);
    return {...session,access,refresh:next,identify:data.identify||session.identify,
      expiresAt:Number.isFinite(Number(claims.exp))?Number(claims.exp)*1000:null};
  }
  async function renew(key){
    if(!refreshing.has(key))refreshing.set(key,(async()=>{
      const old=get(key),next=await refresh(old);
      // Re-importing a session while refresh is in flight must win.
      const latest=get(key);
      if(latest.access!==old.access||latest.refresh!==old.refresh)return latest;
      return remember(key,{access:next.access,refresh:next.refresh,identify:next.identify,expiresAt:next.expiresAt});
    })().finally(()=>refreshing.delete(key)));
    return refreshing.get(key);
  }
  async function post(key,route,data,{retryAuth=true,...options}={}){
    let session=get(key);
    if(session.expiresAt&&session.expiresAt<=now()+60000)session=await renew(key);
    let result=await raw(session,route,data,options);
    if(retryAuth&&authFailure(result)&&!result.data?.taskId&&!result.taskId){
      const latest=get(key);
      session=latest.access!==session.access?latest:await renew(key);
      result=await raw(session,route,data,options);
    }
    return result;
  }
  function requireSuccess(result,session){
    if(Number(result?.code)===0&&result.data!=null)return result.data;
    if(authFailure(result))throw error('Sesi RunningHub kedaluwarsa. Hubungkan ulang akun.','RH_WEB_AUTH_EXPIRED',true);
    throw error('RunningHub menolak permintaan: '+redact(result?.msg||result?.message||result?.code,session),'RH_WEB_PROVIDER_REJECTED',true);
  }
  function balance(data){
    const value=data?.totalCoin;
    const coins=typeof value==='number'?value:typeof value==='string'&&/^\d[\d,]*(?:\.\d+)?$/.test(value.trim())?Number(value.replaceAll(',','')):NaN;
    if(!Number.isFinite(coins))throw error('Saldo RH web belum dapat diverifikasi. Akun dipertahankan.','RH_WEB_BALANCE_UNAVAILABLE',true);
    return coins;
  }
  async function connect(input){
    let session=parseRunningHubSession(input);
    if(session.expiresAt&&session.expiresAt<=now()+60000)session=await refresh(session);
    const user=String(claim(session.access)?.sub||'');
    let result=await raw(session,'/uc/getUserInfo',user?{userId:user}:{});
    if(authFailure(result)){session=await refresh(session);result=await raw(session,'/uc/getUserInfo',{});}
    const profile=requireSuccess(result,session),id=String(profile.id||profile.userId||'');
    if(!/^[A-Za-z0-9_-]{4,128}$/.test(id))throw error('Identitas akun web belum terverifikasi.','RH_WEB_PROTOCOL_ERROR',true);
    const coins=balance(profile);
    if(coins<minimumCredits)throw error('Akun harus memiliki minimal '+minimumCredits+' RH untuk ditambahkan.','RH_WEB_LOW_BALANCE',true);
    const hash=crypto.createHash('sha256').update('runninghub-web-personal:'+id).digest('hex');
    const previous=read()[hash];
    // Retain verified upload/refresh metadata when reconnecting with a raw token.
    const identify=session.identify||profile.identify||claim(session.access)?.identify||previous?.identify||'';
    if(identify&&!/^[A-Za-z0-9_-]{1,128}$/.test(identify))throw error('Identitas token tidak valid.','RH_WEB_INVALID_SESSION',true);
    session={...session,identify,refresh:session.refresh||previous?.refresh||'',comfyAuth:session.comfyAuth||previous?.comfyAuth||''};
    write(hash,{...session,userId:id,workflowId:previous?.workflowId||null,connectedAt:new Date(now()).toISOString()});
    return {key:'rhweb:'+hash,status:{remainCoins:coins,currentTaskCounts:0,apiType:'WEB_SESSION',
      expiresAt:session.expiresAt?new Date(session.expiresAt).toISOString():null}};
  }
  async function status(key){
    const session=get(key),profile=requireSuccess(await post(key,'/uc/getUserInfo',{userId:session.userId}),get(key));
    if(String(profile.id||profile.userId||'')!==session.userId)throw error('Identitas sesi berubah. Hubungkan ulang akun.','RH_WEB_IDENTITY_MISMATCH',true);
    const tasks=requireSuccess(await post(key,'/task/list',{size:1,current:1,taskType:['WORKFLOW','API','CORPAPI','ExclAPI'],taskStatus:['RUNNING','QUEUED']}),get(key));
    if(!Number.isFinite(Number(tasks.total)))throw error('Status task web belum dapat diverifikasi.','RH_WEB_PROTOCOL_ERROR',true);
    return {remainCoins:balance(profile),currentTaskCounts:Number(tasks.total),apiType:'WEB_SESSION',
      expiresAt:get(key).expiresAt?new Date(get(key).expiresAt).toISOString():null};
  }
  async function upload(key,file){
    let session=get(key);
    async function authorize(){
      if(!comfyRefreshing.has(key))comfyRefreshing.set(key,(async()=>{
        const auth=requireSuccess(await post(key,'/api/instance/access/auth',{}),get(key));
        if(!token(auth.accessKey))throw error('Izin upload editor tidak tersedia.','RH_WEB_UPLOAD_AUTH',true);
        return remember(key,{comfyAuth:token(auth.accessKey)});
      })().finally(()=>comfyRefreshing.delete(key)));
      return comfyRefreshing.get(key);
    }
    if(!session.comfyAuth)session=await authorize();
    if(!session.identify)throw error('Data unggah akun belum lengkap. Gunakan kode pengambil token di Pool dan tempel JSON dari popup RunningHub.','RH_WEB_UPLOAD_AUTH',true);
    async function send(){
      const form=new FormData(),stream=fs.createReadStream(file.path);
      form.append('image',stream,{filename:file.originalname,contentType:file.mimetype,knownLength:file.size});form.append('type','input');
      try{return await post(key,'/upload/image',form,{timeout:600000,form:true,retryAuth:false});}
      finally{stream.destroy();}
    }
    let result=await send();
    // Uploads can renew their own expired media credential with a fresh stream;
    // this never replays /task/create or starts inference.
    if(authFailure(result)){await authorize();result=await send();}
    const uploaded=typeof result.name==='string'?result:Number(result.code)===0?result.data:null;
    if(!uploaded?.name||/[\\\x00-\x1f]/.test(uploaded.name))throw error('Upload referensi ke RunningHub gagal.','RH_WEB_UPLOAD_FAILED',true);
    const name=[uploaded.subfolder,uploaded.name].filter(Boolean).join('/');
    if(name.split('/').some(x=>x==='..')||name.startsWith('/'))throw error('Nama file upload tidak valid.','RH_WEB_UPLOAD_FAILED',true);
    return name;
  }
  async function workspace(key){
    if(get(key).workflowId)return get(key).workflowId;
    if(!creating.has(key))creating.set(key,(async()=>{
      const data=requireSuccess(await post(key,'/api/workflow/create',{workflowName:'VANTA Studio'},{retryAuth:false}),get(key));
      const id=String(typeof data==='string'||typeof data==='number'?data:data.workflowId||data.id||'');
      if(!taskId(id))throw error('RunningHub belum mengembalikan ID workspace Vanta.','RH_WEB_PROTOCOL_ERROR',true);
      remember(key,{workflowId:id});return id;
    })().finally(()=>creating.delete(key)));
    return creating.get(key);
  }
  async function create(key,payload){
    const graph=typeof payload.workflow==='string'?JSON.parse(payload.workflow):payload.workflow;
    if(!graph||Array.isArray(graph)||typeof graph!=='object')throw error('Graph generate tidak valid.','RH_WEB_INVALID_GRAPH',true);
    for(const change of payload.nodeInfoList||[]){
      const inputs=graph[String(change.nodeId)]?.inputs;
      if(!inputs||!Object.hasOwn(inputs,change.fieldName))continue;
      const previous=inputs[change.fieldName];
      // Linked values must continue to use their source primitive; the existing
      // builders already point their seed overrides at that primitive.
      if(Array.isArray(previous))continue;
      inputs[change.fieldName]=typeof previous==='number'?Number(change.fieldValue):
        typeof previous==='boolean'?change.fieldValue===true||change.fieldValue==='true':change.fieldValue;
    }
    const workflowId=await workspace(key),clientId=crypto.randomUUID().replaceAll('-','');
    const promptContent=JSON.stringify({client_id:clientId,prompt:graph,extra_data:{extra_pnginfo:{}}});
    // Deliberately no create retry, API fallback, workflow save, retained GPU or
    // implicit paid-balance substitution. The graph is submitted as-is.
    const result=await post(key,'/task/create',{workflowId,promptContent,clientId,
      ...(payload.instanceType?{instanceType:payload.instanceType}:{}),usePersonalQueue:false},{retryAuth:false,timeout:60000});
    // The editor handles 424 as its explicit concurrency-limit rejection.
    if(Number(result.code)===424&&!result.taskId&&!result.data?.taskId)
      return {...result,msg:'TASK_QUEUE_MAXED'};
    return result;
  }
  async function detail(key,id){
    if(!taskId(id))throw error('Task ID tidak valid.','RH_WEB_INVALID_TASK',true);
    const data=requireSuccess(await post(key,'/task/list',{size:1,current:1,taskId:String(id)}),get(key));
    const record=recordList(data).find(x=>String(x.taskId)===String(id));
    return record||null;
  }
  async function outputs(key,id){
    const task=await detail(key,id);
    if(!task)return {code:802,msg:'Task tidak ditemukan pada akun access token ini.'};
    if(['QUEUED','PENDING'].includes(task.taskStatus))return {code:813,msg:'QUEUED'};
    if(['FAILED','ERROR','CANCELED','CANCELLED'].includes(task.taskStatus)){
      const failed=await post(key,'/task/failedReason',{taskId:String(id)});
      return {code:805,msg:'Task web gagal.',data:{failedReason:failed?.data||task.errorMessage||task.errorType}};
    }
    if(task.taskStatus!=='SUCCESS')return {code:804,msg:'RUNNING'};
    let fromId='';
    for(let page=0;page<10;page++){
      const data=requireSuccess(await post(key,'/api/output/v2/history',{size:20,current:1,
        taskType:['WORKFLOW','WEBAPP','API','CORPAPI','ExclAPI'],fromId}),get(key));
      const rows=recordList(data),matches=rows.filter(x=>String(x.taskId)===String(id)&&x.fileUrl);
      if(matches.length)return {code:0,msg:'SUCCESS',data:matches.map(x=>({fileUrl:x.fileUrl,fileType:x.outputType,
        nodeId:x.nodeId==null?'':String(x.nodeId),taskCostTime:task.taskCostTime}))};
      const next=rows.at(-1)?.taskId;
      if(!rows.length||!next||String(next)===fromId)break;
      fromId=String(next);
    }
    // Never substitute another task's result when history pagination is late.
    return {code:804,msg:'Video selesai; file web masih ditunggu.'};
  }
  async function request(route,key,body){
    if(route==='/uc/openapi/accountStatus')return {code:0,data:await status(key)};
    if(route==='/task/openapi/create')return create(key,body);
    if(route==='/task/openapi/outputs')return outputs(key,body.taskId);
    if(route==='/task/openapi/cancel')return post(key,'/task/cancel',{taskId:String(body.taskId)},{retryAuth:false});
    if(route==='/openapi/v2/query'){
      const task=await detail(key,body.taskId);return {code:0,data:task};
    }
    throw error('Operasi RunningHub ini belum mendukung access token. Task belum dikirim.','RH_WEB_UNSUPPORTED_OPERATION',true);
  }
  return {connect,status,upload,request,prepare:workspace,file};
}
