// Provider web history can omit every node ID. Identify the two archive roles
// from ZIP directory metadata instead of relying on response order or names.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectOriginalVideoArchive,selectFrameDiagnosticArchive} from './runninghub-output.js';
const script=fileURLToPath(new URL('./scripts/inspect-output-zip.py',import.meta.url));
const zip=output=>/^(?:application\/)?(?:x-)?zip(?:-compressed)?$/i.test(String(output?.fileType||''))||
  /\.zip(?:\?|$)/i.test(String(output?.fileUrl||''));

export function inspectOutputArchive(url){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.VANTA_MEDIA_PYTHON||'python3',[script],{stdio:['pipe','pipe','ignore']});
    let result='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Direktori ZIP RunningHub belum dapat diperiksa.'));},120000);
    child.on('error',()=>finish(Error('Pemeriksa ZIP belum tersedia.')));
    child.stdout.on('data',chunk=>{result+=chunk;if(result.length>32768){child.kill('SIGKILL');finish(Error('Metadata ZIP tidak valid.'));}});
    child.on('close',code=>{
      if(code!==0)return finish(Error('Direktori ZIP RunningHub belum dapat diperiksa.'));
      try{
        const value=JSON.parse(result);
        if(!['videos','pngs','files'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))throw Error();
        finish(null,value);
      }catch{finish(Error('Metadata ZIP RunningHub tidak valid.'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({url}));
  });
}

export function createOutputArchiveClassifier({validUrl,inspect=inspectOutputArchive}={}){
  const known=new Map(),pending=new Map();
  async function details(url){
    if(!validUrl?.(url))throw Error('Alamat ZIP RunningHub tidak valid.');
    if(known.has(url))return known.get(url);
    if(!pending.has(url))pending.set(url,inspect(url).then(value=>{
      known.set(url,value);while(known.size>200)known.delete(known.keys().next().value);return value;
    }).finally(()=>pending.delete(url)));
    return pending.get(url);
  }
  return async outputs=>{
    if(!Array.isArray(outputs))return outputs;
    const archives=outputs.filter(zip);
    if(archives.length!==2)return outputs;
    let video;try{video=selectOriginalVideoArchive(outputs);}catch{}
    const frames=selectFrameDiagnosticArchive(outputs);
    if(video&&frames)return outputs;
    const roles=await Promise.all(archives.map(async item=>{
      if(item===video)return 'video';if(item===frames)return 'frames';
      const index=await details(item.fileUrl);
      if(index.videos===1)return 'video';
      if(index.videos===0&&index.pngs===3)return 'frames';
      return 'unknown';
    }));
    if(roles.filter(x=>x==='video').length!==1||roles.filter(x=>x==='frames').length!==1)
      throw Error('Arsip video dan tiga PNG belum dapat dibedakan.');
    return outputs.map(item=>{
      const i=archives.indexOf(item);return i<0?item:{...item,nodeId:roles[i]==='video'?'496':'5108'};
    });
  };
}
