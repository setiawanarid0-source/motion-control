// Official RunningHub API-uploaded LoRA path. Keys never leave the server.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import axios from 'axios';
export const FFP_ASSET=Object.freeze({
  url:'https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/8cfc2964aa872e3d18dd90bf7ae5c4cdf8303184/loras/minimax_h3_motion_transfer_ffp_v1.0_ref2va.safetensors',
  sha256:'4c38bb2685af503e890bbae70a0aaa7cfc0241d98166771f637b726f57a09ee8',size:230065752
});
export function validUploadedH3Lora(name){return typeof name==='string'&&/^api-lora-[a-z0-9-]+\/[a-f0-9]{32}\.safetensors$/.test(name);}
async function digest(file,asset){
  const sha=createHash('sha256'),md5=createHash('md5');let size=0;
  for await(const chunk of fs.createReadStream(file)){size+=chunk.length;sha.update(chunk);md5.update(chunk);}
  if(size!==asset.size||sha.digest('hex')!==asset.sha256)throw Error('Checksum model H3 FFP tidak sesuai.');
  return md5.digest('hex');
}
export function createH3AppearanceModel({dir,request,http=axios,asset=FFP_ASSET,registryFile=null}){
  let download=null;const uploaded=new Map();
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
  async function localModel(){
    await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'motion-ffp-'+asset.sha256+'.safetensors');
    if(fs.existsSync(file))return {file,md5:await digest(file,asset)};
    const temp=file+'.tmp-'+randomUUID();
    const response=await http.get(asset.url,{responseType:'stream',timeout:180000});
    let count=0;const limit=new Transform({transform(chunk,enc,cb){
      count+=chunk.length;cb(count>asset.size?Error('Ukuran model H3 FFP tidak sesuai.'):null,chunk);
    }});
    try{
      await pipeline(response.data,limit,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
      const md5=await digest(temp,asset);await fs.promises.rename(temp,file);return {file,md5};
    }finally{await fs.promises.rm(temp,{force:true});}
  }
  async function upload(apiKey){
    if(!download)download=localModel().catch(error=>{download=null;throw error;});
    const {file,md5}=await download;
    const response=await request('/api/openapi/getLoraUploadUrl',apiKey,
      {apiKey,loraName:'minimax_h3_motion_transfer_ffp_v1.0_ref2va',md5Hex:md5},60000);
    const name=response?.data?.fileName,url=response?.data?.url;
    if(Number(response?.code)!==0||!validUploadedH3Lora(name)||!name.endsWith('/'+md5+'.safetensors'))
      throw Error('RunningHub belum memberikan lokasi unggah model H3 FFP.');
    let location;try{location=new URL(url);}catch{throw Error('Lokasi unggah model H3 FFP tidak valid.');}
    if(location.protocol!=='https:'||location.username||location.password||
      !/\.(myqcloud\.com|amazonaws\.com)$/.test(location.hostname))throw Error('Host unggah model H3 FFP tidak valid.');
    await http.put(url,fs.createReadStream(file),{headers:{'Content-Type':'application/octet-stream','Content-Length':asset.size},
      timeout:300000,maxBodyLength:asset.size,maxRedirects:0});
    return name;
  }
  return {ensure(apiKey){
    const id=createHash('sha256').update(apiKey).digest('hex');
    if(registry[id]?.sha256===asset.sha256&&validUploadedH3Lora(registry[id]?.name))return Promise.resolve(registry[id].name);
    if(!uploaded.has(id))uploaded.set(id,upload(apiKey).then(async name=>{
      registry[id]={sha256:asset.sha256,name};await persist();return name;
    }).catch(error=>{delete registry[id];uploaded.delete(id);throw error;}));
    return uploaded.get(id);
  }};
}
