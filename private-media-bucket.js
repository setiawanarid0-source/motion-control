// Private input/reference media, separate from completed motion-results/v1/.
// Only verified receipts are persisted on /data; media expire after 72 hours.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {S3Client,HeadObjectCommand,GetObjectCommand,PutObjectCommand,CopyObjectCommand,
  DeleteObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';

export const PRIVATE_MEDIA_PREFIX='motion-inputs/v1/';
export const PRIVATE_MEDIA_RETENTION=3*86400000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TASK=/^\d{10,25}$/;
const NAMES=new Set(['reference.bin','driving.bin','reference.jpg','driving.mp4','manifest.json']);
function parse(key){
  if(typeof key!=='string'||!key.startsWith(PRIVATE_MEDIA_PREFIX))return null;
  const [scope,id,expiry,name,...extra]=key.slice(PRIVATE_MEDIA_PREFIX.length).split('/');
  return !extra.length&&NAMES.has(name)&&/^\d{13}$/.test(expiry)&&
    (scope==='references'?TASK.test(id):['queue','staged'].includes(scope)&&UUID.test(id))?
    {scope,id,expiresAt:Number(expiry),name}:null;
}
export function privateMediaKey(scope,id,expiresAt,name){
  const key=PRIVATE_MEDIA_PREFIX+[scope,id,expiresAt,name].join('/');
  if(!parse(key))throw Error('Invalid private media key');return key;
}
export const privateMediaOwner=(key,scope,id)=>{const p=parse(key);return !!p&&p.scope===scope&&p.id===id;};
const missing=e=>['NotFound','NoSuchKey'].includes(e?.name)||e?.$metadata?.httpStatusCode===404;
export function createPrivateMediaBucket({env=process.env,client,clock=()=>Date.now(),
  upload=options=>new Upload(options)}={}){
  const endpoint=env.VANTA_RESULTS_BUCKET_ENDPOINT,bucket=env.VANTA_RESULTS_BUCKET_NAME||'test-media';
  const configured=endpoint&&env.VANTA_RESULTS_BUCKET_NAME&&env.VANTA_RESULTS_BUCKET_ACCESS_KEY_ID&&env.VANTA_RESULTS_BUCKET_SECRET_ACCESS_KEY;
  const ready=!!(client||configured);
  const s3=client||(configured?new S3Client({endpoint,region:env.VANTA_RESULTS_BUCKET_REGION||'auto',
    forcePathStyle:false,maxAttempts:2,requestHandler:{connectionTimeout:10000,requestTimeout:60000},
    credentials:{accessKeyId:env.VANTA_RESULTS_BUCKET_ACCESS_KEY_ID,
      secretAccessKey:env.VANTA_RESULTS_BUCKET_SECRET_ACCESS_KEY}}):null);
  function requireKey(key,{expired=false}={}){
    const p=parse(key);if(!ready||!p||(!expired&&p.expiresAt<=clock()))throw Error('Private media unavailable');return p;
  }
  async function head(key){
    requireKey(key);try{return await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));}
    catch(e){if(missing(e))return null;throw e;}
  }
  async function verify(receipt){
    const h=await head(receipt.key);
    if(h?.ContentLength!==receipt.size||h?.Metadata?.sha256!==receipt.sha256)
      throw Error('Private media verification failed');
    return receipt;
  }
  async function putFile(key,file,contentType){
    const p=requireKey(key),sha=createHash('sha256');let size=0;
    for await(const chunk of fs.createReadStream(file)){size+=chunk.length;sha.update(chunk);}
    if(!size)throw Error('Private media is empty');
    const receipt={key,size,sha256:sha.digest('hex'),contentType};
    const old=await head(key);
    if(old?.ContentLength===size&&old?.Metadata?.sha256===receipt.sha256)return receipt;
    const stream=fs.createReadStream(file),operation=upload({client:s3,params:{Bucket:bucket,Key:key,Body:stream,ContentLength:size,
      ContentType:contentType,Metadata:{sha256:receipt.sha256,expiresat:String(p.expiresAt)}},
      queueSize:2,partSize:8*1024*1024,leavePartsOnError:false});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void operation.abort().catch(()=>{});},180000);
    try{await operation.done();if(timedOut)throw Error('Private media upload timed out');return await verify(receipt);}
    catch(error){await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>{});throw error;}
    finally{clearTimeout(timer);stream.destroy();}
  }
  async function copy(receipt,key){
    requireKey(receipt.key);requireKey(key);
    await s3.send(new CopyObjectCommand({Bucket:bucket,Key:key,CopySource:bucket+'/'+receipt.key}));
    return verify({...receipt,key});
  }
  async function putJson(key,value){
    requireKey(key);const body=JSON.stringify(value);
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'application/json'}));
  }
  async function open(key,range){
    const p=parse(key);if(!ready||!p||p.expiresAt<=clock())return null;
    try{const r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key,...(range?{Range:range}:{})}));
      return {body:r.Body,contentType:r.ContentType,contentLength:r.ContentLength,contentRange:r.ContentRange,status:r.ContentRange?206:200};
    }catch(e){if(missing(e))return null;throw e;}
  }
  async function getJson(key){
    const r=await open(key);if(!r)return null;const chunks=[];let size=0;
    try{for await(const chunk of r.body){size+=chunk.length;if(size>32768)throw Error('Private media manifest too large');chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{r.body.destroy?.();}
  }
  async function list(prefix=PRIVATE_MEDIA_PREFIX){
    if(!ready)return [];
    if(!prefix.startsWith(PRIVATE_MEDIA_PREFIX)||prefix.includes('..'))throw Error('Invalid private media prefix');
    const keys=[];let token;
    do{const r=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,...(token?{ContinuationToken:token}:{})}));
      keys.push(...(r.Contents||[]).map(x=>x.Key).filter(k=>parse(k)));token=r.IsTruncated?r.NextContinuationToken:null;
    }while(token);return keys;
  }
  async function remove(key){requireKey(key,{expired:true});await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}
  async function download(receipt,destination){
    const r=await open(receipt.key);if(!r)throw Error('Media upload tidak tersedia. Unggah ulang referensi untuk percobaan baru.');
    const sha=createHash('sha256');let size=0;
    const check=new Transform({transform(chunk,enc,cb){size+=chunk.length;
      if(size>receipt.size)return cb(Error('Private media size mismatch'));sha.update(chunk);cb(null,chunk);}});
    try{await fs.promises.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
      await pipeline(r.body,check,fs.createWriteStream(destination,{flags:'wx',mode:0o600}),{signal:AbortSignal.timeout(180000)});
      if(size!==receipt.size||sha.digest('hex')!==receipt.sha256)throw Error('Private media checksum mismatch');
    }catch(e){await fs.promises.rm(destination,{force:true});throw e;}
    finally{r.body.destroy?.();}
  }
  async function prune(){
    let removed=0;for(const key of await list())if(parse(key).expiresAt<=clock()){await remove(key);removed++;}return removed;
  }
  async function verifyAccess(){
    if(!ready)return {checked:false};
    const temp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'vanta-storage-check-'));
    const expiry=clock()+60*60*1000,keys=[privateMediaKey('staged',randomUUID(),expiry,'driving.bin'),
      privateMediaKey('staged',randomUUID(),expiry,'driving.bin')];
    const data=Buffer.alloc(4096,71),input=path.join(temp,'input.bin'),output=path.join(temp,'output.bin');
    try{
      await fs.promises.writeFile(input,data,{mode:0o600});
      const original=await putFile(keys[0],input,'application/octet-stream'),copied=await copy(original,keys[1]);
      await download(copied,output);
      const partial=await open(keys[1],'bytes=0-31'),chunks=[];
      if(!partial||partial.status!==206)throw Error('Private media range verification failed');
      for await(const chunk of partial.body)chunks.push(chunk);
      if(!Buffer.concat(chunks).equals(data.subarray(0,32)))throw Error('Private media range verification failed');
      return {checked:true,verifiedBytes:data.length,copy:true,range:true};
    }finally{await Promise.allSettled(keys.map(remove));await fs.promises.rm(temp,{recursive:true,force:true});}
  }
  return {ready,putFile,copy,putJson,getJson,open,list,remove,download,prune,verifyAccess};
}
