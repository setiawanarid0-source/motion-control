// Additional conditioning from the same original photo; no generated-frame edit.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const MODEL_SHA='8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4';
const MODEL_PATH=new URL('./models/h3-identity/yunet-2023mar.onnx',import.meta.url).pathname;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validIdentityCrop(face,width,height){
  return !!face&&['x','y','width','height'].every(k=>Number.isSafeInteger(face[k]))&&
    face.x>=0&&face.y>=0&&face.width>=32&&face.height>=32&&face.width%32===0&&face.height%32===0&&
    face.x+face.width<=width&&face.y+face.height<=height;
}
export async function identityModel(file=MODEL_PATH){
  if(digest(await fs.readFile(file))!==MODEL_SHA)throw Error('Identity detector checksum mismatch');
  return file;
}
export async function detectIdentityFocus(file,{width,height,getModel=()=>identityModel(),execute=run}={}){
  try{
    const model=await getModel();
    const {stdout}=await execute(process.env.VANTA_MEDIA_PYTHON||'python3',[
      new URL('./scripts/h3-face-focus.py',import.meta.url).pathname,file.path,model],
      {timeout:30000,maxBuffer:16384});
    const {face}=JSON.parse(stdout);
    return validIdentityCrop(face,width,height)&&Number.isFinite(face.confidence)&&face.confidence>=.75&&face.confidence<=1?face:null;
  }catch{return null;}
}
