// Private, short-lived reference previews saved on the existing Railway volume.
// The original upload remains owned by RunningHub; previews are optimized for History.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

const run=promisify(execFile);
const ROOT=path.join(process.env.VANTA_DATA_DIR||'/data','history-references');
const LEGACY=path.join(process.env.VANTA_DATA_DIR||'/data','camera-r15');
const THREE_DAYS=3*86400*1000;
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
  await fs.promises.mkdir(ROOT,{recursive:true,mode:0o700});
  const staging=path.join(ROOT,'.pending-'+crypto.randomUUID());
  await fs.promises.mkdir(staging,{mode:0o700});
  try{
    if(!videoOnly)await encodePreview(path.join(staging,'reference.jpg'),'image',image);
    await encodePreview(path.join(staging,'driving.mp4'),'video',video);
    return staging;
  }catch(error){
    await fs.promises.rm(staging,{recursive:true,force:true}).catch(()=>{});
    throw Error('Referensi gagal disimpan sebelum generate: '+error.message);
  }
}
function isStagingDir(dir){
  return typeof dir==='string'&&path.dirname(dir)===ROOT&&
    /^\.pending-[0-9a-f-]{36}$/.test(path.basename(dir));
}
export async function commitReferences(staging,taskId,{videoOnly=false}={}){
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
  if(isStagingDir(staging))await fs.promises.rm(staging,{recursive:true,force:true});
}
export async function saveReference(id,kind,input){
  if(!idOk(id)||!['image','video'].includes(kind)||!input?.path)
    throw Error('Invalid reference upload');
  const dir=path.join(ROOT,String(id));
  await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
  return encodePreview(target(id,kind),kind,input);
}
export async function pruneReferences(){
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
