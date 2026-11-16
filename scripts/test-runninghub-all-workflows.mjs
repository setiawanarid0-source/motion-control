import {withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS} from '../integrated-rife.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRunningHubWebSession,isRunningHubWebKey} from '../runninghub-web-session.js';
import {createH3AppearanceModel,FFP_ASSET,CHARACTER_ASSET} from '../h3-appearance-model.js';
import {h3PhotoPlan,h3GraphForInputs,H3_DEFAULT_PROFILE} from '../minimax-h3-motion.js';
import {AKATZ_PROFILE,AKATZ_WINDOW_FRAMES,AKATZ_ASSET,AKATZ_TURBO_ASSET,akatzGraphForInputs,akatzSeedNodeInfo} from '../h3-akatz-motion.js';
import * as akatzV3 from '../h3-akatz-v3-motion.js';
import {TURBO8_ASSET,turbo8GraphForInputs,turbo8SeedNodeInfo,turbo8TemporalPlan} from '../h3-akatz-turbo8.js';
import {remakeGraphForInputs,REMAKE_RECIPE} from '../h3-akatz-remake.js';
import {rifeGraphForSourceFps,RIFE_TARGET_FPS} from '../rife-video.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-all-token-'));
try{
  const calls=[],created=[],nativeCalls=[];let validated=null,saved=null;
  const access='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'2110000000000000001',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture-signature';
  const http={request:async config=>{
    calls.push(config);const route=new URL(config.url).pathname;
    assert.equal(config.headers.Authorization,'Bearer '+access);
    assert.ok(!route.includes('/openapi/'),'No request may fall back to API-key transport');
    if(route==='/uc/getUserInfo')return {status:200,data:{code:0,data:{id:'2110000000000000001',totalCoin:'1001'}}};
    if(route==='/uc/point/summary')return {status:200,data:{code:0,data:{billingVersion:'NEW',balancePoint:0,paidPoint:0,bonusPoint:0,activityPoint:0,transitionCoinRemained:1001}}};
    if(route==='/api/workflow/upload')return {status:200,data:{code:0,data:{workflowId:'2110000000000000100'}}};
    if(route==='/api/workflow/getContent')return {status:200,data:{code:0,data:{userId:'2110000000000000001',workflowContent:'{"nodes":[]}',draft:true}}};
    if(route==='/api/workflow/setContent'){saved=structuredClone(config.data);return {status:200,data:{code:0,data:null}};}
    if(route==='/api/user/task/work/valid'){validated=structuredClone(config.data);return {status:200,data:{code:0,data:{billingVersion:'NEW',canCreateTask:false}}};}
    if(route==='/upload/image'){
      await new Promise((resolve,reject)=>{config.data.on('end',resolve);config.data.on('error',reject);config.data.resume();});
      return {status:200,data:{name:'input-'+calls.length+'.bin'}};
    }
    if(route==='/task/create'){
      const prompt=JSON.parse(config.data.promptContent);created.push(prompt.prompt);nativeCalls.push(structuredClone(config.data));
      assert.equal(saved.promptContent,config.data.promptContent,'Native Save and create use the same executable prompt');
      assert.equal(saved.workflowContent,validated.workflowContent,'Native validation and Save use the actual editor');
      assert.equal(validated.instanceType,config.data.instanceType,'Validation must use the selected machine');
      const editor=JSON.parse(saved.workflowContent),byId=new Map(editor.nodes.map(n=>[String(n.id),n]));
      assert.deepEqual(prompt.extra_data.extra_pnginfo.workflow,editor);
      assert.equal(editor.nodes.length,Object.keys(prompt.prompt).length,'No empty or placeholder billing graph');
      for(const [id,node] of Object.entries(prompt.prompt)){
        const ui=byId.get(id);assert.equal(ui.type,node.class_type);
        for(const [field,value] of Object.entries(node.inputs)){
          if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])){
            const slot=ui.inputs.findIndex(p=>p.name===field),input=ui.inputs[slot];
            const link=editor.links.find(l=>l[0]===input.link);
            assert.deepEqual(link.slice(1,5),[Number(value[0]),value[1],Number(id),slot],id+'.'+field);
            assert.ok(byId.get(value[0]).outputs[value[1]].links.includes(link[0]));
          }else assert.deepEqual(ui.widgets_values_named[field],value,id+'.'+field);
        }
      }
      assert.ok(!JSON.stringify(config.data).includes(access));assert.equal(config.data.apiKey,undefined);
      return {status:200,data:{code:0,data:{taskId:'2110000000000000'+String(created.length).padStart(3,'0')}}};
    }
    throw Error('Unexpected provider route '+route);
  }};
  const runningHubWeb=createRunningHubWebSession({dir,encrypt:JSON.stringify,decrypt:JSON.parse,http});
  const {key}=await runningHubWeb.connect({site:'runninghub.ai',access,identify:'fixture-identify',comfyAuth:'fixture-comfy-credential'});
  const model=(asset,index)=>{
    const file=path.join(dir,'model-'+index+'.json'),name='api-lora-usa/'+String(index).repeat(32)+'.safetensors';
    fs.writeFileSync(file,JSON.stringify({oldAccountReceipt:{sha256:asset.sha256,name}}));
    return createH3AppearanceModel({dir,registryFile:file,asset,request:async()=>{throw Error('Model cache must not require an old API key');},
      http:{get:async()=>{throw Error('Known weights must not download again');},put:async()=>{throw Error('Known weights must not upload again');}}});
  };
  const h3AppearanceModel=model(FFP_ASSET,1),h3CharacterModel=model(CHARACTER_ASSET,2);
  const h3AkatzModels={character:model(AKATZ_ASSET,3),turbo:model(AKATZ_TURBO_ASSET,4)};
  const h3AkatzTurbo8Model=model(TURBO8_ASSET,5);
  const files={current:'current-api.json',rife60:'rife60-api.json',minimaxH3:'minimax-h3-motion-control.json'};
  const workflowGraphs=Object.fromEntries(Object.entries(files).map(([name,file])=>[name,JSON.parse(fs.readFileSync(new URL('../workflows/'+file,import.meta.url),'utf8'))]));
  workflowGraphs.motionflyHD=compileMotionFlyHD(JSON.parse(fs.readFileSync(new URL('../workflows/motionfly-hd-runninghub.json',import.meta.url),'utf8')));
  workflowGraphs.minimaxH3Akatz={};workflowGraphs.minimaxH3AkatzV3={};
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const begin=server.indexOf('async function createTask('),end=server.indexOf('const upload = multer(',begin);
  const context={withIntegratedRife60,INTEGRATED_RIFE_WORKFLOWS,isRunningHubWebKey,runningHubWeb,workflowGraphs,h3GraphForInputs,akatzGraphForInputs,akatzV3,akatzSeedNodeInfo,withOriginalVideoArchive,
    turbo8GraphForInputs,turbo8SeedNodeInfo,h3AkatzTurbo8Model,remakeGraphForInputs,
    AKATZ_PROFILE,AKATZ_WINDOW_FRAMES,RIFE_TARGET_FPS,rifeGraphForSourceFps,runningHubInstanceType,h3AppearanceModel,h3CharacterModel,h3AkatzModels,
    DATA_DIR:dir,assertH3MotionContextSchema:async()=>{},
    uploadToRunningHub:(credential,file)=>runningHubWeb.upload(credential,file),
    rhJson:(route,credential,body)=>runningHubWeb.request(route,credential,body)};
  vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
  const filePath=path.join(dir,'source.bin');fs.writeFileSync(filePath,'fixture-original-media');
  const media={path:filePath,originalname:'source.bin',mimetype:'video/mp4',size:22};
  const source={...h3PhotoPlan(1143,2048),fps:24,totalFrames:49,hasAudio:true,sceneCuts:[],driverCanvas:[736,1280],file:media};
  const submitted={},pairs={};
  for(const workflowKey of Object.keys(workflowGraphs))for(const mode of ['standard','plus']){
    const h3Source=workflowKey==='minimaxH3'?{...source,inferenceProfile:H3_DEFAULT_PROFILE}:
      workflowKey.startsWith('minimaxH3Akatz')?{...source,inferenceProfile:AKATZ_PROFILE}:undefined;
    const result=await context.createTask({apiKey:key,workflowId:'unused-api-template',workflowKey,mode,
      imageFile:{...media,mimetype:'image/png'},videoFile:media,sourceFps:30,
      rifeSource:workflowKey==='rife60'?{width:1920,height:1080}:undefined,h3Source});
    assert.match(result.taskId,/^\d{19}$/);assert.ok(result.submittedAt);
    assert.equal(nativeCalls.at(-1).instanceType,mode==='standard'?'default':'plus');
    (pairs[workflowKey]||={})[mode]=created.at(-1);
    submitted[workflowKey]=created.at(-1);
  }
  assert.equal(created.length,12,'All six workflows reach native create on both machines with 1001 RH, zero points and advisory canCreateTask=false');
  const normalize=graph=>JSON.parse(JSON.stringify(graph).replace(/input-\d+\.bin/g,'input-fixture.bin'));
  for(const [name,pair] of Object.entries(pairs)){
    const standard=normalize(pair.standard),plus=normalize(pair.plus);
    if(name==='rife60'){
      assert.equal(standard['2'].inputs.batch_size,2,'Standard preserves the existing low-memory standalone RIFE batch');
      assert.equal(plus['2'].inputs.batch_size,8,'Plus preserves the existing adaptive RIFE batch');
      plus['2'].inputs.batch_size=standard['2'].inputs.batch_size;
    }
    assert.deepEqual(standard,plus,name+' recipe, links and output must be preserved between machines');
  }
  assert.deepEqual([...INTEGRATED_RIFE_WORKFLOWS],['current','motionflyHD'],'Only KOH and MotionFly retain automatic RIFE');
  for(const [name,graph] of Object.entries(submitted)){
    const nodes=Object.values(graph).filter(n=>n.class_type==='RIFEInterpolation');
    assert.equal(nodes.length,INTEGRATED_RIFE_WORKFLOWS.has(name)||name==='rife60'?1:0,name+' interpolation stage');
    if(INTEGRATED_RIFE_WORKFLOWS.has(name))assert.equal(graph['490'].inputs.frame_rate,60);
  }
  assert.equal(submitted.rife60['2'].inputs.batch_size,8,'Actual Plus token payload receives the adaptive batch');
  for(const graph of Object.values(submitted)){
    const zip=Object.values(graph).find(n=>n.class_type==='CompressImages');
    assert.ok(zip,'All six active workflows must export their original MP4 in a ZIP');
    const select=graph[zip.inputs['images or video_path'][0]];
    assert.equal(select.class_type,'VHS_SelectFilename');assert.equal(select.inputs.index,-1);
    const video=graph[select.inputs.filenames[0]];
    assert.equal(video.class_type,'VHS_VideoCombine');assert.equal(video.inputs.save_output,false);
    const final=graph['490']||graph['3'];
    for(const field of ['images','audio','frame_rate','crf','pix_fmt','format'])
      assert.deepEqual(video.inputs[field],final.inputs[field],field+' must retain the final video recipe');
  }
  const native=submitted.minimaxH3Akatz,v3=submitted.minimaxH3AkatzV3,hd=submitted.motionflyHD;
  assert.equal(native['7'].inputs.file_name,'api-lora-usa/'+'3'.repeat(32)+'.safetensors');
  assert.equal(v3['7'].inputs.file_name,native['7'].inputs.file_name);
  assert.equal(v3['6'].inputs.file_name,'api-lora-usa/'+'4'.repeat(32)+'.safetensors','v3 keeps its original Turbo4 receipt');
  assert.equal(native['6'].inputs.file_name,'api-lora-usa/'+'5'.repeat(32)+'.safetensors','the main Akatz option uses the distinct Turbo8 receipt');
  assert.equal(native['41'].inputs.steps,8);assert.equal(native['40'].inputs.sampler_name,'er_sde');
  assert.match(native['30'].inputs.image,/^input-\d+\.bin$/,'Photo input remains dynamic in the actual token payload');
  assert.deepEqual(native['32'].inputs.image,['30',0]);assert.deepEqual(native['1008'].inputs.image,['32',0]);
  assert.deepEqual(native['1008'].inputs.vae,['3',0]);assert.deepEqual(native['1010'].inputs.positive,['1008',0]);
  assert.equal(native['1008'].inputs.frame_idx,0);
  assert.ok(native['5108'],'Token submission includes the three-frame diagnostic archive');
  assert.equal(native['490'].inputs.frame_rate,24,'Akatz rollback exports native 24 FPS');
  assert.equal(Object.values(native).filter(n=>n.class_type==='RIFEInterpolation').length,0);
  for(const id of ['493','5100','5103','5104','5105']){
    const node=native[id];
    assert.deepEqual(node.inputs.images??node.inputs.image,native['490'].inputs.images,'Akatz MP4/PNG share native frames: '+id);
    if(node.class_type==='VHS_VideoCombine')assert.equal(node.inputs.frame_rate,24);
  }
  assert.equal(v3['490'].inputs.crf,16,'Akatz v3 must retain its historical encoding recipe');
  assert.equal(v3['490'].inputs.frame_rate,24);
  assert.ok(v3['10'],'Akatz v3 must retain the original attention node');
  assert.match(hd['30'].inputs.image,/^input-\d+\.bin$/,'Uploaded image must replace the source editor filename');
  assert.match(hd['33'].inputs.video,/^input-\d+\.bin$/,'Uploaded video must replace the source editor filename');
  assert.equal(hd['33'].inputs.force_rate,24);assert.equal(hd['331'].inputs.steps,6);
  assert.equal(hd['308'].inputs.keep_proportion,'total_pixels');
  assert.deepEqual(hd['89'].inputs.width,['308',1]);
  assert.deepEqual(hd['497'].inputs.image,['30',0]);
  assert.deepEqual(hd['489'].inputs.width,['497',1]);
  assert.deepEqual(hd['496'].inputs['images or video_path'],['494',0]);
  for(const [frames,samplers] of [[482,5],[2401,21]]){
    const priorCount=created.length;
    await context.createTask({apiKey:key,workflowId:'unused-api-template',workflowKey:'minimaxH3Akatz',mode:'plus',
      imageFile:{...media,mimetype:'image/png'},videoFile:media,
      h3Source:{...source,totalFrames:frames,inferenceProfile:AKATZ_PROFILE}});
    assert.equal(created.length,priorCount+1,'Long Akatz still creates exactly one provider task');
    const long=created.at(-1);
    assert.equal(Object.values(long).filter(n=>n.class_type==='SamplerCustomAdvanced').length,samplers);
    assert.equal(Object.values(long).filter(n=>n.class_type==='RIFEInterpolation').length,0);
    assert.equal(long['490'].inputs.frame_rate,24);
    assert.deepEqual(Object.entries(long).filter(([,n])=>n.class_type==='MiniMaxH3AddGuide'&&n.inputs.image).map(([id])=>id),['1008']);
  }
  for(const flag of ['akatzExpression','akatzFaceControl','akatzSubjectMask'])for(const frames of [49,463,2401]){
    const before=created.length;
    await assert.rejects(context.createTask({apiKey:key,workflowId:'unused-api-template',workflowKey:'minimaxH3Akatz',mode:'plus',
      imageFile:{...media,mimetype:'image/png'},videoFile:media,
      h3Source:{...source,totalFrames:frames,inferenceProfile:AKATZ_PROFILE,[flag]:true}}),{code:'AKATZ_VARIANT_RETIRED'});
    assert.equal(created.length,before,'Retired variants must never submit a provider task');
  }
  const missing=createH3AppearanceModel({dir,asset:{...FFP_ASSET,name:'missing-pinned-model'},
    request:async()=>{throw Error('No API key fallback');},http:{get:async()=>{throw Error('No speculative download');}}});
  await assert.rejects(missing.ensure(key),error=>error.code==='H3_MODEL_PREPARATION_FAILED');
  const oldModels=context.h3AkatzModels,oldTurbo=context.h3AkatzTurbo8Model;
  const unused={ensure:async()=>{throw Error('Source recipe must not prepare old CharacterSwap/Turbo receipts');}};
  context.h3AkatzModels={character:unused,turbo:unused};context.h3AkatzTurbo8Model=unused;
  for(const mode of ['standard','plus'])for(const frames of [49,482]){
    const before=created.length;
    await context.createTask({apiKey:key,workflowId:'unused-api-template',workflowKey:'minimaxH3Akatz',mode,
      imageFile:{...media,mimetype:'image/png'},videoFile:media,
      h3Source:{...source,totalFrames:frames,inferenceProfile:AKATZ_PROFILE,akatzRecipe:'remake',driverCanvas:[source.canvasWidth,source.canvasHeight]}});
    assert.equal(created.length,before+1,'Source Remake uses exactly one native provider submission');
    const graph=created.at(-1);
    assert.equal(nativeCalls.at(-1).instanceType,mode==='standard'?'default':'plus');
    assert.equal(graph['1'].inputs.unet_name,REMAKE_RECIPE.model);
    assert.equal(graph['7'].class_type,'LoraLoaderBypassModelOnly');
    assert.deepEqual(graph['41'].inputs.sigmas.split(',').map(Number),REMAKE_RECIPE.sigmas);
    assert.equal(Object.values(graph).filter(n=>n.class_type==='SamplerCustomAdvanced').length,frames===49?1:5);
    assert.ok(!Object.values(graph).some(n=>n.class_type==='RHLoraLoader'||n.class_type==='RIFEInterpolation'));
    assert.ok(Object.values(graph).filter(n=>n.class_type==='RemakeNoise').every(n=>typeof n.inputs.seed==='number'));
  }
  context.h3AkatzModels=oldModels;context.h3AkatzTurbo8Model=oldTurbo;
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  for(const name of Object.keys(workflowGraphs))assert.ok(html.includes('data-workflow="'+name+'"'));
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../h3-akatz-v3-motion.js',import.meta.url))).digest('hex'),
    '91b41ceb399a8ed159b154f18b4305dab043c30eae9fcb9fa77f3b9745a6b40f','The historical v3 source must be preserved');
  console.log('PASS: all 12 workflow/machine pairs use native validation, Save and exactly one token submission, with 1001 RH, zero points and preflight flag false; model receipts reused; v3 source preserved. No live inference.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
