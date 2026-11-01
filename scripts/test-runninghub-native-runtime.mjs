import assert from 'node:assert/strict';
import {summarizeNativeRuntime,createNativeRuntimeInspector} from '../runninghub-native-runtime.js';
const info={ModelAttentionBackend:{input:{required:{attention:[['pytorch attention','comfy kitchen attention']]}}}};
const stats={system:{comfyui_version:'fixture-version',pytorch_version:'fixture-torch',
  argv:['--use-sage-attention','--secret-value=must-not-log']},
  devices:[{type:'cuda',name:'fixture-gpu',vram_total:48*1024**3}]};
const summary=summarizeNativeRuntime(stats,info);
assert.equal(summary.selectedAttention,'comfy kitchen attention');
assert.equal(summary.devices[0].vramGiB,48);
assert.deepEqual(summary.runtimeFlags,['--use-sage-attention']);
assert.ok(!JSON.stringify(summary).includes('must-not-log'));
assert.equal(summarizeNativeRuntime(null,null).selectedAttention,null,'No guessing when native inspection is unavailable');
assert.equal(summarizeNativeRuntime(stats,{ModelAttentionBackend:{input:{required:{attention:[['pytorch attention']]}}}}).selectedAttention,null);
let clock=0;const requests=[];
const inspector=createNativeRuntimeInspector({now:()=>clock,ttl:100,get:async(url,options)=>{
  requests.push({url,options});
  return {status:200,data:url.endsWith('system_stats')?stats:info};
}});
const first=await inspector.inspect('fixture-key');
assert.equal(first.selectedAttention,'comfy kitchen attention');
await inspector.inspect('fixture-key');assert.equal(requests.length,2,'Two read-only capability endpoints are cached');
assert.ok(requests.every(r=>r.url.startsWith('https://www.runninghub.ai/proxy-plus/fixture-key/')));
assert.ok(requests.every(r=>r.options.maxRedirects===0),'Credentials must not follow redirects');
clock=101;await inspector.inspect('fixture-key');assert.equal(requests.length,4);
const failed=createNativeRuntimeInspector({get:async()=>{throw Error('private-url-with-key');}});
const unavailable=await failed.inspect('fixture-key');
assert.equal(unavailable.selectedAttention,null);assert.equal(unavailable.attentionSchemaAvailable,false);
assert.ok(!JSON.stringify(unavailable).includes('private-url-with-key'));
assert.ok(!JSON.stringify(unavailable).includes('fixture-key'));
console.log('PASS: read-only native capability lookup, advertised backend selection, credential-safe summaries, bounded timeout/cache, no redirects and no unverified fallback patch');
