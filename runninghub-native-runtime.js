import axios from 'axios';
import {createHash} from 'node:crypto';

// Read-only native API documented by RunningHub. Never log the API-key path,
// request errors, command-line values or raw responses, and never submit a job.
export function summarizeNativeRuntime(stats,info){
  const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,100):null;
  const system=stats?.system||{},schema=info?.ModelAttentionBackend;
  const options=schema?.input?.required?.attention?.[0]||schema?.input?.optional?.attention?.[0];
  const supported=Array.isArray(options)?options.filter(x=>
    ['pytorch attention','comfy kitchen attention'].includes(x)):[];
  const flags=new Set(['--use-ck-attention','--use-pytorch-cross-attention','--use-sage-attention',
    '--use-flash-attention','--lowvram','--normalvram','--highvram']);
  return {source:'native_proxy',statsAvailable:Boolean(stats?.system),attentionSchemaAvailable:Boolean(schema?.input),
    comfyuiVersion:clean(system.comfyui_version),
    pytorchVersion:clean(system.pytorch_version),
    // The proxy describes capabilities; it is not proof of the GPU used by a past task.
    devices:Array.isArray(stats?.devices)?stats.devices.slice(0,4).map(d=>({
      type:clean(d.type),name:clean(d.name),
      vramGiB:Number.isFinite(d.vram_total)?Math.round(d.vram_total/1024**3*10)/10:null})):[],
    runtimeFlags:Array.isArray(system.argv)?system.argv.filter(x=>flags.has(x)):[],
    modelAttentionBackends:supported,
    selectedAttention:supported.includes('comfy kitchen attention')?'comfy kitchen attention':null};
}
export function createNativeRuntimeInspector({get=axios.get,now=()=>Date.now(),ttl=30*60*1000}={}){
  const cache=new Map();
  return {async inspect(apiKey,mode='plus'){
    if(typeof apiKey!=='string'||!apiKey||mode!=='plus')return summarizeNativeRuntime(null,null);
    const key=createHash('sha256').update(apiKey).digest('hex');
    const previous=cache.get(key);
    if(previous&&now()-previous.at<ttl)return previous.promise;
    const promise=(async()=>{
      const base='https://www.runninghub.ai/proxy-plus/'+encodeURIComponent(apiKey)+'/';
      const read=async path=>{
        try{
          const r=await get(base+path,{timeout:8000,maxContentLength:2*1024*1024,
            maxRedirects:0,headers:{Authorization:'Bearer '+apiKey},validateStatus:()=>true});
          return r?.status===200&&r.data&&typeof r.data==='object'?r.data:null;
        }catch{return null;}
      };
      const [stats,info]=await Promise.all([read('system_stats'),read('object_info/ModelAttentionBackend')]);
      return summarizeNativeRuntime(stats,info);
    })();
    cache.set(key,{at:now(),promise});
    if(cache.size>64)cache.delete(cache.keys().next().value);
    return promise;
  }};
}
