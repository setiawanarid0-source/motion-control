// Official RunningHub API-uploaded LoRA path. Keys never leave the server.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import axios from 'axios';
export const FFP_ASSET=Object.freeze({
  name:'minimax_h3_motion_transfer_ffp_v1.0_ref2va',
  url:'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/8cfc2964aa872e3d18dd90bf7ae5c4cdf8303184/loras/minimax_h3_motion_transfer_ffp_v1.0_ref2va.safetensors',
  sha256:'4c38bb2685af503e890bbae70a0aaa7cfc0241d98166771f637b726f57a09ee8',size:230065752
});
export const CHARACTER_ASSET=Object.freeze({
  name:'minimax_h3_character_swap_v1.1_ref2va_fro',
  url:'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/8cfc2964aa872e3d18dd90bf7ae5c4cdf8303184/loras/minimax_h3_character_swap_v1.1_ref2va_fro.safetensors',
  sha256:'ab21167bed71db99ac09527ad1f26f5f3517687ebf2e1f1bd5e91cc0bdf9b9c3',size:80673112
});
export function validUploadedH3Lora(name){return typeof name==='string'&&/^api-lora-[a-z0-9-]+\/[a-f0-9]{32}\.safetensors$/.test(name);}
async function digest(file,asset){
  const sha=createHash('sha256'),md5=createHash('md5');let size=0;
  for await(const chunk of fs.createReadStream(file)){size+=chunk.length;sha.update(chunk);md5.update(chunk);}
  if(size!==asset.size||sha.digest('hex')!==asset.sha256)throw Error('Checksum model penampilan H3 tidak sesuai.');
  return md5.digest('hex');
}
async function transferDeadline(ms,phase,operation){
  const controller=new AbortController();
  const timer=setTimeout(()=>{
    const error=new Error('Batas waktu '+phase+' model terlampaui. Persiapan belum selesai.');
    error.code='MODEL_TRANSFER_TIMEOUT';controller.abort(error);
  },ms);
  try{return await operation(controller.signal);}
  catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
  finally{clearTimeout(timer);}
}
export function createH3AppearanceModel({dir,request,http=axios,asset=FFP_ASSET,registryFile=null,
  transferTimeouts={downloadMs:180000,uploadMs:300000}}){
  let download=null,downloadState=null;
  const uploaded=new Map(),destinations=new Map(),listeners=new Map(),states=new Map(),downloadWaiters=new Set();
  const keyId=key=>createHash('sha256').update(key).digest('hex');
  function notify(id,value){
    const state={phase:value.phase,loaded:Math.max(0,Math.min(asset.size,Math.trunc(value.loaded||0))),total:asset.size};
    const previous=states.get(id),now=Date.now();
    if(previous?.value.phase===state.phase&&previous.value.loaded===state.loaded)return;
    if(previous?.value.phase===state.phase&&now-previous.at<1500&&state.loaded<asset.size)return;
    states.set(id,{value:state,at:now});
    for(const listener of listeners.get(id)||[])try{listener(state);}catch{}
  }
  function notifyDownload(value){downloadState=value;for(const id of downloadWaiters)notify(id,value);}
  let registry={};
  try{if(registryFile){const value=JSON.parse(fs.readFileSync(registryFile,'utf8'));
    if(value&&typeof value==='object'&&!Array.isArray(value))registry=value;}}catch{}
  let writing=Promise.resolve();
  function persist(){
    if(!registryFile)return Promise.resolve();
    writing=writing.catch(()=>{}).then(async()=>{
      await fs.promises.mkdir(path.dirname(registryFile),{recursive:true,mode:0o700});
      const temp=registryFile+'.tmp-'+randomUUID();
      try{await fs.promises.writeFile(temp,JSON.stringify(registry),{flag:'wx',mode:0o600});await fs.promises.rename(temp,registryFile);}
      finally{await fs.promises.rm(temp,{force:true});}
    });return writing;
  }
  const knownReceipts=()=>Object.values(registry).filter(x=>x?.sha256===asset.sha256&&validUploadedH3Lora(x.name));
  const md5FromName=name=>name.split('/')[1].slice(0,32);
  async function saveReceipt(id,name){
    if(registry[id]?.sha256===asset.sha256&&registry[id]?.name===name)return;
    registry[id]={sha256:asset.sha256,name};await persist();
  }
  async function destination(apiKey,md5){
    const response=await request('/api/openapi/getLoraUploadUrl',apiKey,
      {apiKey,loraName:asset.name||'minimax_h3_motion_transfer_ffp_v1.0_ref2va',md5Hex:md5},60000);
    const name=response?.data?.fileName,url=response?.data?.url;
    if(Number(response?.code)!==0||!validUploadedH3Lora(name)||!name.endsWith('/'+md5+'.safetensors'))
      throw Error('RunningHub belum memberikan lokasi unggah model H3.');
    return {name,url};
  }
  // Read/authorize only: never downloads weights, PUTs bytes or creates inference.
  // Reuse requires the current account to resolve the exact already-uploaded
  // MD5 path, including its region. Different destinations still need an upload.
  async function primeCached(apiKey){
    const id=keyId(apiKey),own=registry[id];
    if(own?.sha256===asset.sha256&&validUploadedH3Lora(own.name))return own.name;
    const known=knownReceipts();if(!known.length)return null;
    const {name}=await destination(apiKey,md5FromName(known[0].name));
    if(!known.some(x=>x.name===name))return null;
    await saveReceipt(id,name);return name;
  }
  async function localModel(){
    await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'appearance-'+asset.sha256+'.safetensors');
    if(fs.existsSync(file)){
      notifyDownload({phase:'verifying',loaded:asset.size});
      return {file,md5:await digest(file,asset)};
    }
    const temp=file+'.tmp-'+randomUUID();
    try{
      const md5=await transferDeadline(transferTimeouts.downloadMs,'unduhan',async signal=>{
        notifyDownload({phase:'downloading',loaded:0});
        const response=await http.get(asset.url,{responseType:'stream',timeout:180000,signal});
        const sha=createHash('sha256'),md5=createHash('md5');let count=0;
        const limit=new Transform({transform(chunk,enc,cb){
          count+=chunk.length;
          if(count>asset.size)return cb(Error('Ukuran model H3 tidak sesuai.'));
          sha.update(chunk);md5.update(chunk);notifyDownload({phase:'downloading',loaded:count});cb(null,chunk);
        }});
        await pipeline(response.data,limit,fs.createWriteStream(temp,{flags:'wx',mode:0o600}),{signal});
        notifyDownload({phase:'verifying',loaded:count});
        if(count!==asset.size||sha.digest('hex')!==asset.sha256)throw Error('Checksum model penampilan H3 tidak sesuai.');
        return md5.digest('hex');
      });
      await fs.promises.rename(temp,file);return {file,md5};
    }finally{await fs.promises.rm(temp,{force:true});}
  }
  async function acquireLocal(id){
    downloadWaiters.add(id);if(downloadState)notify(id,downloadState);
    if(!download)download=localModel().catch(error=>{download=null;throw error;});
    try{return await download;}finally{downloadWaiters.delete(id);}
  }
  async function upload(apiKey,id){
    notify(id,{phase:'checking_cache',loaded:0});
    const cached=await primeCached(apiKey);if(cached)return cached;
    const {file,md5}=await acquireLocal(id),{name,url}=await destination(apiKey,md5);
    let location;try{location=new URL(url);}catch{throw Error('Lokasi unggah model H3 FFP tidak valid.');}
    if(location.protocol!=='https:'||location.username||location.password||
      !/\.(myqcloud\.com|amazonaws\.com)$/.test(location.hostname))throw Error('Host unggah model H3 FFP tidak valid.');
    let target=destinations.get(name);
    if(!target){
      target={listeners:new Set(),state:{phase:'uploading',loaded:0},promise:null};destinations.set(name,target);
      const broadcast=state=>{target.state=state;for(const fn of target.listeners)fn(state);};
      target.promise=transferDeadline(transferTimeouts.uploadMs,'unggahan',async signal=>{
        const stream=fs.createReadStream(file);
        try{
          await http.put(url,stream,{headers:{'Content-Type':'application/octet-stream','Content-Length':asset.size},
            timeout:300000,maxBodyLength:asset.size,maxRedirects:0,signal,
            onUploadProgress:event=>broadcast({phase:event.loaded>=asset.size?'waiting_confirmation':'uploading',loaded:event.loaded})});
        }finally{stream.destroy();}
      }).catch(error=>{destinations.delete(name);throw error;});
    }
    const listener=state=>notify(id,state);target.listeners.add(listener);listener(target.state);
    try{await target.promise;}finally{target.listeners.delete(listener);}
    return name;
  }
  return {primeCached,ensure(apiKey,{onProgress}={}){
    const id=keyId(apiKey);
    if(onProgress){
      if(!listeners.has(id))listeners.set(id,new Set());listeners.get(id).add(onProgress);
      try{if(states.has(id))onProgress(states.get(id).value);}catch{}
    }
    let result;
    if(registry[id]?.sha256===asset.sha256&&validUploadedH3Lora(registry[id]?.name)){
      notify(id,{phase:'ready',loaded:asset.size});result=Promise.resolve(registry[id].name);
    }else{
      if(!uploaded.has(id))uploaded.set(id,upload(apiKey,id).then(async name=>{
        await saveReceipt(id,name);notify(id,{phase:'ready',loaded:asset.size});return name;
      }).catch(error=>{uploaded.delete(id);throw error;}));
      result=uploaded.get(id);
    }
    return result.finally(()=>{if(onProgress){listeners.get(id)?.delete(onProgress);if(!listeners.get(id)?.size)listeners.delete(id);}});
  }};
}
