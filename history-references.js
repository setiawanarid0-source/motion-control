// Private History previews. Production media live in the existing object bucket;
// the local path remains a fallback for legacy records and offline checks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import os from 'node:os';
import {PRIVATE_MEDIA_PREFIX,PRIVATE_MEDIA_RETENTION,privateMediaKey,privateMediaOwner} from './private-media-bucket.js';

const run=promisify(execFile);
const ROOT=path.join(process.env.VANTA_DATA_DIR||'/data','history-references');
const LEGACY=path.join(process.env.VANTA_DATA_DIR||'/data','camera-r15');
const THREE_DAYS=3*86400*1000;
const TEMP=path.join(os.tmpdir(),'vanta-reference-previews');
let remote=null;const remoteIndex=new Map();
export function configureReferenceMedia(store){remote=store?.ready?store:null;remoteIndex.clear();}
const idOk=id=>/^\d{10,25}$/.test(String(id||''));
const target=(id,kind)=>path.join(ROOT,String(id),kind==='image'?'reference.jpg':'driving.mp4');
const present=p=>{try{return fs.statSync(p).size>500;}catch{return false;}};

export function referenceAvailability(id){
  if(!idOk(id))return {image:false,video:false,legacy:false};
  const image=present(target(id,'image'));
  const modern=present(target(id,'video'));
  const legacy=!modern&&present(path.join(LEGACY,String(id),'source.mp4'));
  return {image,video:modern||legacy,legacy};
}
export function referenceFile(id,kind){
  if(!idOk(id)||!['image','video'].includes(kind))return null;
  const modern=target(id,kind);
  if(present(modern))return modern;
  if(kind==='video'){
    const legacy=path.join(LEGACY,String(id),'source.mp4');
    if(present(legacy))return legacy;
  }
  return null;
}
async function encodePreview(destination,kind,input){
  if(!['image','video'].includes(kind)||!input?.path)throw Error('Invalid reference source');
  const temp=destination+'.tmp-'+process.pid+'-'+Date.now();
  try{
    const args=kind==='image'
      ?['-hide_banner','-loglevel','error','-nostdin','-y','-i',input.path,'-frames:v','1',
         '-vf','scale=1280:-2','-q:v','4','-update','1','-f','image2',temp]
      :['-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-i',input.path,
         '-map','0:v:0','-map','0:a?','-vf','scale=576:-2',
         '-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','64k','-movflags','+faststart','-f','mp4',temp];
    await run('ffmpeg',args,{timeout:kind==='video'?180000:40000,maxBuffer:32768});
    const size=(await fs.promises.stat(temp)).size;
    if(size<500||size>(kind==='video'?35:12)*1024*1024)
      throw Error('Reference preview exceeds storage limit');
    await fs.promises.rename(temp,destination);
    return size;
  }finally{await fs.promises.rm(temp,{force:true}).catch(()=>{});}
}

// Preflight both reference previews BEFORE the paid RunningHub task is submitted.
// A storage/encoding failure must stop generation without spending credits.
export async function stageReferences(image,video,{videoOnly=false}={}){
  if(!video?.path||(!videoOnly&&!image?.path))throw Error('Required generation references are missing');
  const root=remote?TEMP:ROOT;
  await fs.promises.mkdir(root,{recursive:true,mode:0o700});
  const stageId=crypto.randomUUID(),expiresAt=Date.now()+PRIVATE_MEDIA_RETENTION;
  const staging=path.join(root,'.pending-'+stageId),files=[];
  await fs.promises.mkdir(staging,{mode:0o700});
  try{
    if(!videoOnly)await encodePreview(path.join(staging,'reference.jpg'),'image',image);
    await encodePreview(path.join(staging,'driving.mp4'),'video',video);
    if(remote){
      for(const kind of videoOnly?['video']:['image','video']){
        const name=kind==='image'?'reference.jpg':'driving.mp4';
        const receipt=await remote.putFile(privateMediaKey('staged',stageId,expiresAt,name),path.join(staging,name),
          kind==='image'?'image/jpeg':'video/mp4');files.push({...receipt,kind});
      }
      return {storage:'bucket',stageId,expiresAt,files};
    }
    return staging;
  }catch(error){
    await fs.promises.rm(staging,{recursive:true,force:true}).catch(()=>{});
    if(remote)await Promise.allSettled(files.map(x=>remote.remove(x.key)));
    const full=/ENOSPC|No space left on device/i.test(String(error.code||'')+' '+error.message);
    console.warn('Reference preparation failed',JSON.stringify({storageFull:full,errorClass:String(error.code||error.name||'Error').slice(0,50)}));
    throw Error('Referensi gagal disimpan sebelum generate: '+(full?
      'ruang penyimpanan server penuh. Task belum dikirim ke RunningHub.':
      'penyimpanan atau pemrosesan pratinjau belum berhasil. Task belum dikirim ke RunningHub.'));
  }finally{if(remote)await fs.promises.rm(staging,{recursive:true,force:true}).catch(()=>{});}
}
function isStagingDir(dir){
  return typeof dir==='string'&&path.dirname(dir)===ROOT&&
    /^\.pending-[0-9a-f-]{36}$/.test(path.basename(dir));
}
export async function commitReferences(staging,taskId,{videoOnly=false}={}){
  if(remote&&staging?.storage==='bucket'){
    if(!idOk(taskId)||!validRemoteStage(staging)||!staging.files.some(x=>x.kind==='video')||
      (!videoOnly&&!staging.files.some(x=>x.kind==='image')))throw Error('Invalid staged reference task');
    const files=[];
    for(const file of staging.files){const name=file.kind==='image'?'reference.jpg':'driving.mp4';
      files.push({...await remote.copy(file,privateMediaKey('references',String(taskId),staging.expiresAt,name)),kind:file.kind});}
    const manifest={taskId:String(taskId),expiresAt:staging.expiresAt,files};
    const key=privateMediaKey('references',String(taskId),staging.expiresAt,'manifest.json');
    await remote.putJson(key,manifest);
    const verified=await remote.getJson(key);
    if(JSON.stringify(verified)!==JSON.stringify(manifest))throw Error('Reference manifest verification failed');
    remoteIndex.set(String(taskId),manifest);await discardReferences(staging);
    return {image:files.some(x=>x.kind==='image'),video:true,legacy:false};
  }
  if(!isStagingDir(staging)||!idOk(taskId))throw Error('Invalid staged reference task');
  if(!present(path.join(staging,'driving.mp4'))||(!videoOnly&&!present(path.join(staging,'reference.jpg'))))
    throw Error('Incomplete staged references');
  const dest=path.join(ROOT,String(taskId));
  // Same-volume atomic rename: never publish just one of the reference inputs.
  await fs.promises.rename(staging,dest);
  const current=referenceAvailability(taskId);
  if(!current.video||(!videoOnly&&!current.image))throw Error('Reference commit incomplete');
  return current;
}
export async function discardReferences(staging){
  if(remote&&staging?.storage==='bucket'){
    if(validRemoteStage(staging))await Promise.allSettled(staging.files.map(x=>remote.remove(x.key)));
    return;
  }
  if(isStagingDir(staging))await fs.promises.rm(staging,{recursive:true,force:true});
}
function validRemoteStage(stage){return Number.isSafeInteger(stage.expiresAt)&&stage.expiresAt>Date.now()&&
  Array.isArray(stage.files)&&stage.files.length>=1&&stage.files.length<=2&&
  stage.files.every(x=>['image','video'].includes(x.kind)&&privateMediaOwner(x.key,'staged',stage.stageId));}
async function remoteManifest(id){
  if(!remote||!idOk(id))return null;
  const cached=remoteIndex.get(String(id));if(cached?.expiresAt>Date.now())return cached;
  remoteIndex.delete(String(id));
  const keys=await remote.list(PRIVATE_MEDIA_PREFIX+'references/'+String(id)+'/');
  for(const key of keys.filter(k=>k.endsWith('/manifest.json')).reverse()){
    const m=await remote.getJson(key);
    if(m?.taskId!==String(id)||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=Date.now()||
      !Array.isArray(m.files)||m.files.length<1||m.files.length>2||
      m.files.some(x=>!['image','video'].includes(x.kind)||!privateMediaOwner(x.key,'references',String(id))))continue;
    remoteIndex.set(String(id),m);return m;
  }return null;
}
export async function resolvedReferenceAvailability(id){
  const local=referenceAvailability(id);if(!remote)return local;
  let m;try{m=await remoteManifest(id);}catch(e){if(local.image||local.video)return local;throw e;}
  if(!m)return local;
  return {image:local.image||m.files.some(x=>x.kind==='image'),video:local.video||m.files.some(x=>x.kind==='video'),
    legacy:local.legacy&&!m.files.some(x=>x.kind==='video')};
}
export async function openRemoteReference(id,kind,range){
  if(!['image','video'].includes(kind))return null;
  const m=await remoteManifest(id),file=m?.files.find(x=>x.kind===kind);
  return file?remote.open(file.key,range):null;
}
// Move existing previews without re-encoding. Local copies are removed only
// after both uploaded files and the published manifest have been verified.
export async function migrateReferences(){
  const result={migratedTasks:0,movedBytes:0,deferred:0};if(!remote)return result;
  await fs.promises.mkdir(ROOT,{recursive:true,mode:0o700});
  for(const id of await fs.promises.readdir(ROOT)){
    if(!idOk(id)||!present(target(id,'video')))continue;
    const dir=path.join(ROOT,id),info=await fs.promises.stat(dir),expiresAt=Math.floor(info.mtimeMs)+THREE_DAYS;
    if(expiresAt<=Date.now())continue;
    try{
      const files=[];
      for(const kind of ['image','video'])if(present(target(id,kind))){
        const name=kind==='image'?'reference.jpg':'driving.mp4';
        files.push({...await remote.putFile(privateMediaKey('references',id,expiresAt,name),target(id,kind),
          kind==='image'?'image/jpeg':'video/mp4'),kind});
      }
      const m={taskId:id,expiresAt,files},key=privateMediaKey('references',id,expiresAt,'manifest.json');
      await remote.putJson(key,m);
      if(JSON.stringify(await remote.getJson(key))!==JSON.stringify(m))throw Error('Reference migration verification failed');
      remoteIndex.set(id,m);await fs.promises.rm(dir,{recursive:true,force:true});
      result.migratedTasks++;result.movedBytes+=files.reduce((n,f)=>n+f.size,0);
    }catch{result.deferred++;}
  }return result;
}
export async function saveReference(id,kind,input){
  if(!idOk(id)||!['image','video'].includes(kind)||!input?.path)
    throw Error('Invalid reference upload');
  const dir=path.join(ROOT,String(id));
  await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
  return encodePreview(target(id,kind),kind,input);
}
export async function pruneReferences(){
  for(const [id,m]of remoteIndex)if(m.expiresAt<=Date.now())remoteIndex.delete(id);
  await fs.promises.mkdir(ROOT,{recursive:true,mode:0o700});
  for(const name of await fs.promises.readdir(ROOT)){
    if(name.startsWith('.pending-')){
      const staging=path.join(ROOT,name);
      try{const info=await fs.promises.stat(staging);
        if(info.isDirectory()&&Date.now()-info.mtimeMs>4*60*60*1000)
          await fs.promises.rm(staging,{recursive:true,force:true});}catch{}
      continue;
    }
    if(!idOk(name))continue;
    const dir=path.join(ROOT,name);
    try{
      const info=await fs.promises.stat(dir);
      if(info.isDirectory()&&Date.now()-info.mtimeMs>THREE_DAYS)
        await fs.promises.rm(dir,{recursive:true,force:true});
    }catch{}
  }
}
