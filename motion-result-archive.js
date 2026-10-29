// Durable on-volume copies of completed RunningHub videos, unrelated to Account Pool.
// A copy is required for true independence from the original RunningHub account.
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import axios from 'axios';

export const RESULT_RETENTION_MS=3*24*60*60*1000;
export const MAX_RESULT_BYTES=250*1024*1024;
const TASK_ID=/^\d{10,25}$/;
function validUrl(raw){
  try{
    const u=new URL(String(raw||''));
    if(u.protocol!=='https:'||!u.hostname||u.username||u.password)return false;
    const host=u.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.localhost')||
       /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)||
       host==='::1'||host.startsWith('['))return false;
    return true;
  }catch{return false;}
}
export function createMotionResultArchive({dir,request=axios.get,clock=()=>Date.now(),
  maxFileBytes=MAX_RESULT_BYTES,ttl=RESULT_RETENTION_MS}={}){
  if(!dir)throw Error('Result archive directory required');
  const pending=new Map();
  const filename=id=>TASK_ID.test(String(id||''))?path.join(dir,String(id)+'.mp4'):null;
  function read(id){
    const file=filename(id);
    if(!file)return null;
    try{
      const st=fs.statSync(file);
      return st.isFile()&&st.size>1024&&st.size<=maxFileBytes&&
        clock()-st.mtimeMs<=ttl ?file:null;
    }catch{return null;}
  }
  async function mirror(id,url){
    const dest=filename(id);
    if(!dest||!validUrl(url))throw Error('Invalid task ID or provider output URL');
    if(read(id))return read(id);
    if(pending.has(id))return pending.get(id);
    const promise=(async()=>{
      await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
      // Avoid filling Hobby disk and disrupting other persistent VANTA state.
      if(typeof fs.statfsSync==='function'){
        const st=fs.statfsSync(dir),available=Number(st.bavail)*Number(st.bsize);
        if(Number.isFinite(available)&&available<maxFileBytes+128*1024*1024)
          throw Error('Insufficient persistent disk space to cache output video');
      }
      const tmp=dest+'.tmp-'+process.pid+'-'+clock();
      let upstream;
      try{
        upstream=await request(url,{responseType:'stream',timeout:120000,
          maxRedirects:2,validateStatus:status=>status===200});
        const announced=Number(upstream.headers?.['content-length']||0);
        if(announced>maxFileBytes)throw Error('Result video exceeds cache size limit');
        let total=0;
        const limiter=new Transform({transform(chunk,enc,callback){
          total+=chunk.length;
          if(total>maxFileBytes)return callback(Error('Result video exceeds cache size limit'));
          callback(null,chunk);
        }});
        await pipeline(upstream.data,limiter,fs.createWriteStream(tmp,{flags:'wx',mode:0o600}));
        if(total<1024)throw Error('Result video was empty');
        await fs.promises.rename(tmp,dest);
        return dest;
      }finally{
        upstream?.data?.destroy?.();
        await fs.promises.rm(tmp,{force:true}).catch(()=>{});
      }
    })().finally(()=>pending.delete(id));
    pending.set(id,promise);
    return promise;
  }
  async function prune(){
    try{for(const name of await fs.promises.readdir(dir)){
      if(!/^\d{10,25}\.mp4$/.test(name))continue;
      const file=path.join(dir,name);
      try{
        const st=await fs.promises.stat(file);
        if(clock()-st.mtimeMs>ttl)await fs.promises.rm(file,{force:true});
      }catch{}
    }}catch(error){if(error?.code!=='ENOENT')throw error;}
  }
  // Removing a Pool account MUST NOT invoke this method. Only an explicit
  // History removal or independent expiry may delete archived media.
  async function remove(id){const file=filename(id);if(file)await fs.promises.rm(file,{force:true});}
  return {read,mirror,prune,remove,pending,dir};
}
