// VANTA Motion Control: archive output videos for exactly 72h from completion.
// S3-compatible Railway bucket is separate from the 256MB application volume.
// No arbitrary per-video 128MB limit. Multipart streaming avoids loading media
// into memory or into /data. A separate scheduler deletes objects on expiry.
import axios from 'axios';
import fs from 'node:fs';
import {S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';

export const MOTION_VIDEO_RETENTION_MS=72*60*60*1000;
export const RESULT_BUCKET_PREFIX='motion-results/v1/';
const TASK_ID=/^\d{10,25}$/;
const isNotFound=e=>e?.$metadata?.httpStatusCode===404||
  e?.name==='NotFound'||e?.name==='NoSuchKey';
export function validProviderUrl(raw){
  try{
    const u=new URL(String(raw||''));
    if(u.protocol!=='https:'||u.username||u.password)return false;
    const h=u.hostname.toLowerCase();
    if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.internal')||
       h==='::1'||h.startsWith('[')||/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h))return false;
    return true;
  }catch{return false;}
}
function bucketVariables(env){
  const endpoint=env.VANTA_RESULTS_BUCKET_ENDPOINT;
  const name=env.VANTA_RESULTS_BUCKET_NAME;
  const region=env.VANTA_RESULTS_BUCKET_REGION||'auto';
  const accessKeyId=env.VANTA_RESULTS_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey=env.VANTA_RESULTS_BUCKET_SECRET_ACCESS_KEY;
  if(!endpoint||!name||!accessKeyId||!secretAccessKey)return null;
  return {endpoint,name,region,accessKeyId,secretAccessKey};
}
export function createMotionResultBucket({env=process.env,client,request=axios.get,
  uploader=options=>new Upload(options).done(),clock=()=>Date.now()}={}){
  const config=bucketVariables(env);
  const ready=!!(config||client);
  const bucket=config?.name||env.VANTA_RESULTS_BUCKET_NAME||'vanta-test';
  const s3=client|| (config?new S3Client({
    region:config.region,endpoint:config.endpoint,forcePathStyle:false,
    credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey}
  }):null);
  const pending=new Map();
  function key(task,{allowExpired=false}={}){
    if(!TASK_ID.test(String(task?.taskId||'')))return null;
    const finished=Date.parse(task.finishedAt||'');
    if(!Number.isFinite(finished))return null;
    const expires=finished+MOTION_VIDEO_RETENTION_MS;
    if(!allowExpired&&clock()>=expires)return null;
    return RESULT_BUCKET_PREFIX+task.taskId+'/'+expires+
      (task.resultSource==='workflow-zip-v1'?'-original':'')+'.mp4';
  }
  async function exists(task){
    const objectKey=key(task);
    if(!objectKey||!ready)return false;
    try{await s3.send(new HeadObjectCommand({Bucket:bucket,Key:objectKey}));return true;}
    catch(error){if(isNotFound(error))return false;throw error;}
  }
  async function mirror(task,{sourceFile,sha256}={}){
    if(!ready)throw Error('Railway Motion Results bucket is not configured');
    const objectKey=key(task);
    if(!objectKey)throw Error('Video has already expired or has invalid completion time');
    if(!sourceFile&&!validProviderUrl(task.resultUrl))throw Error('Invalid RunningHub result URL');
    if(task.resultSource==='workflow-zip-v1'&&!sourceFile)
      throw Error('Original ZIP video requires verified extracted MP4 bytes');
    if(pending.has(objectKey))return pending.get(objectKey);
    const promise=(async()=>{
      if(await exists(task))return objectKey;
      const upstream=sourceFile?{headers:{'content-type':'video/mp4'},data:fs.createReadStream(sourceFile)}:await request(task.resultUrl,{
        responseType:'stream',timeout:120000,maxRedirects:3,
        validateStatus:status=>status===200
      });
      try{
        const mime=String(upstream.headers?.['content-type']||'').toLowerCase();
        if(mime.includes('text/html')||mime.includes('application/json'))throw Error('Provider returned non-video content');
        if(clock()>=Date.parse(task.finishedAt)+MOTION_VIDEO_RETENTION_MS)
          throw Error('Video completed more than 72 hours ago');
        await uploader({client:s3,params:{
          Bucket:bucket,Key:objectKey,Body:upstream.data,ContentType:'video/mp4',
          Metadata:{completedat:String(Date.parse(task.finishedAt)),
            ...(sourceFile?{source:'workflow-zip-v1',originalsha256:String(sha256||'')}: {})}
        },queueSize:2,partSize:8*1024*1024,leavePartsOnError:false});
        return objectKey;
      }finally{upstream.data?.destroy?.();}
    })().finally(()=>pending.delete(objectKey));
    pending.set(objectKey,promise);
    return promise;
  }
  async function open(task,range){
    if(!ready)return null;
    const objectKey=key(task);
    if(!objectKey)return null;
    try{
      const result=await s3.send(new GetObjectCommand({
        Bucket:bucket,Key:objectKey,...(range?{Range:range}:{})
      }));
      return {body:result.Body,contentType:result.ContentType||'video/mp4',
        contentLength:result.ContentLength,contentRange:result.ContentRange,
        status:result.ContentRange?206:200};
    }catch(error){if(isNotFound(error))return null;throw error;}
  }
  async function remove(task){
    if(!ready)return;
    for(const resultSource of ['provider-video-v1','workflow-zip-v1']){
      const objectKey=key({...task,resultSource},{allowExpired:true});
      if(objectKey)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey}));
    }
  }
  async function prune(){
    if(!ready)return 0;
    let removed=0,token;
    do{
      const page=await s3.send(new ListObjectsV2Command({
        Bucket:bucket,Prefix:RESULT_BUCKET_PREFIX,
        ...(token?{ContinuationToken:token}:{})
      }));
      for(const object of page.Contents||[]){
        const match=String(object.Key||'').match(/^motion-results\/v1\/\d{10,25}\/(\d+)(?:-original)?\.mp4$/);
        if(match&&clock()>=Number(match[1])){
          await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:object.Key}));
          removed++;
        }
      }
      token=page.IsTruncated?page.NextContinuationToken:null;
    }while(token);
    return removed;
  }
  return {ready,exists,mirror,open,remove,prune,key,pending};
}
