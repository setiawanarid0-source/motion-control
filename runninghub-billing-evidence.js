import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {compileMotionFlyHD} from './motionfly-hd-workflow.js';
import {withIntegratedRife60,withIntegratedRife60Editor} from './integrated-rife.js';
import {withOriginalVideoArchive} from './runninghub-output.js';

// Keep numeric rules and short policy enums, never account identifiers,
// credentials, URLs, contact details, free text, or arbitrary response objects.
const unsafe=/token|key|secret|password|authorization|signature|cookie|session|private|email|phone|mobile|nick|avatar|address|url|(?:^|\.)(?:userId|id)(?:\.|$)|(?:order|transaction)(?:Id|No|Code|Number)/i;
export function billingScalars(source){
  const result={};
  function visit(value,path,depth){
    if(depth>8||Object.keys(result).length>=1500||unsafe.test(path)||path.split(/[.\[]/).some(part=>/(?:Id|ID)$|^(?:id|uid)$/i.test(part)&&!/^paid$/i.test(part)))return;
    if(typeof value==='boolean'){result[path]=value;return;}
    if(typeof value==='number'&&Number.isFinite(value)){result[path]=value;return;}
    if(typeof value==='string'){
      if(/code|type|mode|scope|currency|unit|status|priority|strategy|order$/i.test(path)&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value))result[path]=value;
      else if(/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value)))result[path]=Number(value);
      return;
    }
    if(Array.isArray(value)){value.slice(0,64).forEach((v,i)=>visit(v,`${path}[${i}]`,depth+1));return;}
    if(!value||typeof value!=='object')return;
    for(const [name,item] of Object.entries(value))if(/^[A-Za-z][A-Za-z0-9_.\[\]-]{0,179}$/.test(name))visit(item,path?`${path}.${name}`:name,depth+1);
  }
  visit(source,'',0);return result;
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>k!=='_meta').sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function motionFlyBillingWorkflow(){
  const base=JSON.parse(fs.readFileSync(new URL('./workflows/motionfly-hd-runninghub.json',import.meta.url),'utf8'));
  const editor=structuredClone(base),image='vanta-billing-reference.png',video='vanta-billing-driver.mp4';
  for(const node of editor.nodes){
    if(node.type==='LoadImage')node.widgets_values[0]=image;
    if(node.type==='VHS_LoadVideo')node.widgets_values.video=video;
    if(node.id===331)node.widgets_values[0]=50;
    if(node.widgets_values&&!Array.isArray(node.widgets_values))node.widgets_values_named=structuredClone(node.widgets_values);
  }
  editor.extra||={};
  const workflow=withIntegratedRife60Editor(editor);
  const actual=compileMotionFlyHD(workflow);
  const expected=withOriginalVideoArchive(withIntegratedRife60(compileMotionFlyHD(base)));
  expected['30'].inputs.image=image;expected['33'].inputs.video=video;expected['331'].inputs.seed=50;
  const normalized=JSON.stringify(canonical(actual));
  if(normalized!==JSON.stringify(canonical(expected)))throw Error('Graf audit MotionFly tidak sesuai produksi.');
  return {name:'motionflyHD',workflowContent:JSON.stringify(workflow),nodeCount:workflow.nodes.length,
    graphSha256:createHash('sha256').update(normalized).digest('hex'),media:'placeholder-file-names'};
}
