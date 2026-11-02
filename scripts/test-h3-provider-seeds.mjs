import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {H3_REVISION,H3_DEFAULT_PROFILE,h3PhotoPlan,h3GraphForInputs} from '../minimax-h3-motion.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const begin=server.indexOf('async function createTask('),end=server.indexOf('const upload = multer(',begin);
const file='api-lora-usa/'+'a'.repeat(32)+'.safetensors';let payload;const provisioned=[];
const context={workflowGraphs:{minimaxH3:{revision:H3_REVISION}},h3GraphForInputs,runningHubInstanceType,
  h3AppearanceModel:{ensure:async()=>{provisioned.push('ffp');return file;}},
  h3CharacterModel:{ensure:async()=>{provisioned.push('character');return file;}},
  uploadToRunningHub:async(key,f)=>'api/'+f.originalname,
  rhJson:async(route,key,data)=>{payload=data;return {code:0,data:{taskId:'2113333333333333333'}};}};
vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
await context.createTask({apiKey:'fixture-only',workflowId:'owner-workflow',workflowKey:'minimaxH3',mode:'plus',
  imageFile:{originalname:'reference.png'},h3Source:{...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,
    hasAudio:true,sceneCuts:[],inferenceProfile:'guide-dmad4-ffp',file:{originalname:'guide.mp4'}}});
assert.equal(payload.nodeInfoList.length,0,'An explicit noise_seed override became str and failed the final GPU sampler');
const graph=JSON.parse(payload.workflow);assert.equal(graph['7'].class_type,'RHLoraLoader');assert.equal(graph['7'].inputs.file_name,file);
const noise=Object.entries(graph).filter(([,n])=>n.class_type==='RandomNoise');
assert.equal(noise.length,3);
for(const [id,n] of noise)assert.equal(typeof n.inputs.noise_seed,'number',id+' must keep an integer JSON seed');
assert.equal(typeof graph['1068'].inputs.noise_seed,'number','The reported final sampler must never receive a string seed');
await context.createTask({apiKey:'fixture-only',workflowId:'owner-workflow',workflowKey:'minimaxH3',mode:'plus',
  imageFile:{originalname:'new-reference.png'},h3Source:{...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,
    hasAudio:true,sceneCuts:[],inferenceProfile:H3_DEFAULT_PROFILE,file:{originalname:'guide.mp4'}}});
const character=JSON.parse(payload.workflow);assert.equal(payload.nodeInfoList.length,0);
assert.equal(character['7'].inputs.file_name,file);assert.equal(character['30'].inputs.image,'api/new-reference.png');
assert.deepEqual(character['86'].inputs.image,['30',0]);assert.deepEqual(character['1004'].inputs.prompt,['86',0]);
assert.deepEqual(provisioned,['ffp','character'],'The production default provisions the character model rather than reusing the previous task model');
await context.createTask({apiKey:'fixture-only',workflowId:'owner-workflow',workflowKey:'minimaxH3',mode:'plus',
  imageFile:{originalname:'native-photo.jpg'},h3Source:{...h3PhotoPlan(1143,2048),fps:24,totalFrames:361,
    hasAudio:true,sceneCuts:[],inferenceProfile:'native-fun-pose4-caption',file:{originalname:'guide.mp4'}}});
const pose=JSON.parse(payload.workflow);assert.equal(payload.nodeInfoList.length,0);
assert.equal(pose['13'].class_type,'ModelPatchLoader');assert.deepEqual(pose['1008'].inputs.control_video,['1007',0]);
assert.deepEqual(provisioned,['ffp','character'],'Native ControlNet is not a character/FFP LoRA upload');
assert.equal(Object.values(pose).filter(n=>n.class_type==='SamplerCustomAdvanced').length,3);
for(const node of Object.values(pose).filter(n=>n.class_type==='RandomNoise'))assert.equal(typeof node.inputs.noise_seed,'number');
console.log('PASS: actual FFP provider payload, three numeric RandomNoise seeds, no type-coercing API overrides, and server-only LoRA provisioning');
