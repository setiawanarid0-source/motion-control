import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';
import {withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS} from '../integrated-rife.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';
import {createRunningHubWebSession,isRunningHubWebKey} from '../runninghub-web-session.js';
import {canSubmitMachineMode,runningHubInstanceType} from '../runninghub-instance.js';

assert.deepEqual(['standard','plus'].filter(canSubmitMachineMode),['standard','plus']);
assert.equal(canSubmitMachineMode('lite'),false,'Lite must not be selectable for new tasks');
assert.equal(runningHubInstanceType('standard'),'default','24 GB Standard must send default');
assert.equal(runningHubInstanceType('plus'),'plus','48 GB Plus must send plus');
assert.equal(runningHubInstanceType('lite'),null,'Already queued Lite tasks retain legacy scheduling');
assert.throws(()=>runningHubInstanceType('ultra'),/tidak dikenali/);

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const queue=fs.readFileSync(new URL('../generation-queue.js',import.meta.url),'utf8');
// Execute the real UI click handlers. Switching any workflow must preserve the
// chosen machine; both buttons remain usable, including all three H3 entries.
const element=dataset=>({dataset,disabled:false,style:{},textContent:'',
  classList:{add(){},remove(){},toggle(){}},querySelector(){return {textContent:''};},addEventListener(){}});
const workflowCards=[...html.matchAll(/data-workflow="([^"]+)"/g)].map(match=>element({workflow:match[1]}));
const modeCards=['standard','plus'].map(mode=>element({mode}));
const ui={state:{mode:'standard'},
  $$:selector=>selector==='.workflow-card'?workflowCards:modeCards,$:()=>element({}),
  readAkatzMode(){},updateEstimates(){},updateGenerate(){},restoreRecentRifeFailure(){}};
vm.createContext(ui);
vm.runInContext(app.slice(app.indexOf("$$('.workflow-card').forEach(b=>b.onclick="),app.indexOf("initDropzone($('#imageDrop')")),ui);
assert.equal(workflowCards.length,6);
for(const selected of modeCards){
  selected.onclick();
  for(const card of workflowCards){
    card.onclick();
    assert.equal(ui.state.mode,selected.dataset.mode,card.dataset.workflow+' preserves '+selected.dataset.mode);
    assert.ok(modeCards.every(button=>!button.disabled),card.dataset.workflow+' enables both machines');
    for(const mode of modeCards){mode.onclick();assert.equal(ui.state.mode,mode.dataset.mode);}
    selected.onclick();
  }
}
console.log('PASS: real UI handlers expose both modes on all six workflows and preserve the user selection');
// Execute both real builders and the real web-session transport with a stubbed
// provider. This compares /task/create, not just the source of the mapping.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-mode-pair-'));
try{
  const clock=Date.UTC(2026,10,15),userId='2110000000000000001',native=[];
  const access='fixture.'+Buffer.from(JSON.stringify({sub:userId,exp:clock/1000+3600})).toString('base64url')+'.signature';
  const web=createRunningHubWebSession({dir,encrypt:JSON.stringify,decrypt:JSON.parse,now:()=>clock,http:{request:async config=>{
    const route=new URL(config.url).pathname;let reply;
    if(route==='/uc/getUserInfo')reply={code:0,data:{id:userId,totalCoin:1001}};
    else if(route==='/uc/point/summary')reply={code:0,data:{billingVersion:'NEW',balancePoint:30}};
    else if(route==='/api/workflow/upload')reply={code:0,data:{id:'2110000000000000100'}};
    else if(route==='/api/workflow/getContent')reply={code:0,data:{userId,workflowContent:'{"nodes":[]}',draft:false}};
    else if(route==='/api/user/task/work/valid')reply={code:0,data:{billingVersion:'NEW',canCreateTask:true}};
    else if(route==='/api/workflow/setContent')reply={code:0,data:null};
    else if(route==='/task/create'){native.push(structuredClone(config.data));reply={code:0,data:{taskId:'2110000000000000999',taskStatus:'RUNNING'}};}
    else throw Error('Unexpected fixture route '+route);
    return {status:200,data:reply};
  }}});
  const {key}=await web.connect({site:'runninghub.ai',access});
  const graph=compileMotionFlyHD(JSON.parse(fs.readFileSync(new URL('../workflows/motionfly-hd-runninghub.json',import.meta.url),'utf8')));
  const context={withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS,withOriginalVideoArchive,isRunningHubWebKey,runningHubInstanceType,
    runningHubWeb:web,workflowGraphs:{motionflyHD:graph},uploadToRunningHub:async(_key,file)=>'uploaded-'+file.originalname,
    rhJson:(route,credential,body)=>web.request(route,credential,body)};
  vm.createContext(context);
  const from=server.indexOf('async function createTask('),to=server.indexOf('const upload = multer(',from);
  vm.runInContext(server.slice(from,to)+'\nthis.createTask=createTask;',context);
  for(const mode of ['standard','plus'])await context.createTask({apiKey:key,workflowKey:'motionflyHD',mode,
    imageFile:{originalname:'reference.png'},videoFile:{originalname:'driver.mp4'}});
  assert.equal(native.length,2);assert.equal(native[0].instanceType,'default');assert.equal(native[1].instanceType,'plus');
  const prompts=native.map(payload=>JSON.parse(payload.promptContent));
  assert.deepEqual(prompts[0].prompt,prompts[1].prompt,'Standard and Plus submit the exact same MotionFly+RIFE graph and overrides');
  assert.equal(prompts[0].prompt['760060'].class_type,'RIFEInterpolation');
  const normalize=payload=>{const copy=structuredClone(payload);delete copy.instanceType;delete copy.clientId;
    copy.promptContent=JSON.parse(copy.promptContent);delete copy.promptContent.client_id;return copy;};
  assert.deepEqual(normalize(native[0]),normalize(native[1]),'Only instanceType and per-request UUIDs differ in native create');
  console.log('PASS: real MotionFly native payload mode pair, identical graph hash '+createHash('sha256').update(JSON.stringify(prompts[0].prompt)).digest('hex')+'; provider stub only');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
const buttonModes=[...html.matchAll(/class="mode-card(?: selected)?" data-mode="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(buttonModes,['standard','plus'],'Only Standard and Plus buttons, in that order');
assert.ok(html.includes('Standard</strong><span>24 GB'));
assert.ok(html.includes('Plus</strong><span>48 GB'));
assert.ok(app.includes("mode: 'standard'"),'Default machine must be Standard');
assert.ok(queue.includes("mode:String(body.mode||'standard')"),'Default submitted job must be Standard');
assert.ok(server.includes('const instanceType=runningHubInstanceType(mode);'),
  'RunningHub payload must use the validated instanceType mapping');
assert.ok(server.includes('if(instanceType)payload.instanceType=instanceType;'));
assert.ok(server.includes('if(!canSubmitMachineMode(String(req.body?.mode||\'standard\')))'),
  'New upload must reject legacy Lite');
assert.ok(app.includes("fd.append('mode',state.mode)"),'Selected machine must reach request');
assert.ok(app.includes('machineLabel(x.mode)'), 'History displays actual RunningHub tier');
const stage=app.slice(app.indexOf('function stageDescription('),app.indexOf('function showSubmissionStage('));
assert.ok(stage.includes('Memulai generate…'));
for(const hidden of ['Menganalisis','Menyiapkan gerakan','Menyimpan media','Memeriksa akun']){
  assert.ok(!stage.includes(hidden),'Internal phase exposed in UI: '+hidden);
}
assert.ok(app.includes('xhr.upload.onprogress='),'Actual upload progress preserved');
assert.ok(app.includes('startPolling();'),'RunningHub task polling preserved');
assert.ok(server.includes('taskRegistry.retireAccount(account)'),'Previously approved Account Pool safety preserved');
console.log('PASS: Standard=default, Plus=plus; Lite only legacy; simple UI without exposing backend phases');
