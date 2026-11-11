import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash} from 'node:crypto';
import axios from 'axios';
import {validProviderUrl,MOTION_VIDEO_RETENTION_MS} from './motion-result-bucket.js';
import {selectOriginalVideoArchive} from './runninghub-output.js';

export const ORIGINAL_VIDEO_SOURCE='workflow-zip-v1';
const run=promisify(execFile);
const extractor=fileURLToPath(new URL('./scripts/extract-original-video.py',import.meta.url));
const reserve=64*1024*1024;
function available(dir){const s=fs.statfsSync(dir);return Math.max(0,Number(s.bavail)*Number(s.bsize)-reserve);}

export async function withExtractedOriginal(url,consume,{request=axios.get,tmpRoot=os.tmpdir()}={}){
  if(!validProviderUrl(url))throw Error('URL ZIP RunningHub tidak valid.');
  const dir=await fs.promises.mkdtemp(path.join(tmpRoot,'vanta-original-'));
  let upstream;
  try{
    const zip=path.join(dir,'result.zip'),file=path.join(dir,'original.mp4');
    // Ephemeral disk, never the account volume. Bound actual bytes to free
    // space, leaving room for extraction; no fixed per-video size ceiling.
    const maxZip=Math.floor(available(dir)/2);
    upstream=await request(url,{responseType:'stream',timeout:120000,maxRedirects:3,
      validateStatus:status=>status===200});
    let total=0;
    const limiter=new Transform({transform(chunk,_encoding,done){
      total+=chunk.length;done(total>maxZip?Error('Ruang sementara untuk ZIP tidak cukup.'):null,chunk);
    }});
    await pipeline(upstream.data,limiter,fs.createWriteStream(zip,{flags:'wx',mode:0o600}));
    let receipt;
    try{
      const {stdout}=await run('/usr/bin/python3',[extractor,zip,file,String(available(dir))],
        {timeout:10*60*1000,maxBuffer:32768});
      receipt=JSON.parse(stdout);
    }catch{throw Error('MP4 asli dalam ZIP belum dapat dibaca atau diverifikasi.');}
    return await consume({file,...receipt});
  }finally{
    upstream?.data?.destroy?.();
    await fs.promises.rm(dir,{recursive:true,force:true});
  }
}

export function createOriginalVideoDelivery({registry,bucket,archive,outputs,
  extract=withExtractedOriginal,clock=()=>Date.now()}){
  const pending=new Map();
  async function ensure(taskId){
    const id=String(taskId),task=registry.get(id);
    if(!task||task.status!=='success')return false;
    if(!Number.isFinite(Date.parse(task.finishedAt)))throw Error('Waktu selesai video belum tersedia.');
    if(clock()>=Date.parse(task.finishedAt)+MOTION_VIDEO_RETENTION_MS)throw Error('Masa simpan video sudah berakhir.');
    if(pending.has(id))return pending.get(id);
    const promise=(async()=>{
      if(task.resultSource===ORIGINAL_VIDEO_SOURCE&&
        (bucket.ready?await bucket.exists(task):archive.readOriginal(task)))return true;
      if(task.resultSource==='provider-video-v1'&&!task.resultArchiveUrl)return false;
      let zipUrl=task.resultArchiveUrl;
      if(!zipUrl){
        let descriptors;
        try{descriptors=await outputs(task);}
        catch(error){
          if(task.resultArchiveExpected||/MotionFly.*ZIP/i.test(task.workflow||''))throw error;
          // Legacy videos exported before ZIP support retain their existing
          // independent archive if the retired provider session has expired.
          return false;
        }
        const zip=selectOriginalVideoArchive(descriptors);
        if(!zip){
          if(task.resultArchiveExpected||/MotionFly.*ZIP/i.test(task.workflow||''))
            throw Error('ZIP video asli belum tersedia dari RunningHub. Coba muat ulang sebentar lagi.');
          registry.update(id,{status:'success',resultSource:'provider-video-v1'});
          return false;
        }
        zipUrl=zip.fileUrl;
        registry.update(id,{status:'success',resultArchiveUrl:zipUrl,resultArchiveExpected:true});
      }
      const original={...task,resultSource:ORIGINAL_VIDEO_SOURCE};
      await extract(zipUrl,async receipt=>{
        if(bucket.ready)await bucket.mirror(original,{sourceFile:receipt.file,sha256:receipt.sha256});
        else await archive.storeOriginal(original,receipt.file);
        registry.update(id,{status:'success',resultSource:ORIGINAL_VIDEO_SOURCE,resultArchiveUrl:zipUrl,
          resultOriginalSHA256:receipt.sha256,resultOriginalBytes:receipt.bytes});
      });
      return true;
    })().finally(()=>pending.delete(id));
    pending.set(id,promise);return promise;
  }
  async function verify(taskId){
    await ensure(taskId);
    const task=registry.get(String(taskId));
    if(task?.resultSource!==ORIGINAL_VIDEO_SOURCE)return {source:task?.resultSource||null,verified:false};
    const media=bucket.ready?await bucket.open(task):null;
    const file=!bucket.ready?archive.readOriginal(task):null;
    const body=media?.body||(file?fs.createReadStream(file):null);
    if(!body)throw Error('Arsip video asli belum tersedia.');
    const digest=createHash('sha256');let bytes=0;
    for await(const chunk of body){bytes+=chunk.length;digest.update(chunk);}
    const sha256=digest.digest('hex');
    return {source:task.resultSource,bytes,sha256,verified:sha256===task.resultOriginalSHA256&&bytes===task.resultOriginalBytes};
  }
  return {ensure,verify,pending};
}
