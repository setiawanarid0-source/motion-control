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
import {TURBO8_ASSET,turbo8GraphForInputs,turbo8SeedNodeInfo} from '../h3-akatz-turbo8.js';
import {rifeGraphForSourceFps,RIFE_TARGET_FPS} from '../rife-video.js';
import {runningHubInstanceType} from '../runninghub-instance.js';
import {compileMotionFlyHD} from '../motionfly-hd-workflow.js';
import {withOriginalVideoArchive} from '../runninghub-output.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-all-token-'));
try{
  const calls=[],created=[];
  const access='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'2110000000000000001',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture-signature';
  const http={request:async config=>{
    calls.push(config);const route=new URL(config.url).pathname;
    assert.equal(config.headers.Authorization,'Bearer '+access);
    assert.ok(!route.includes('/openapi/'),'No request may fall back to API-key transport');
    if(route==='/uc/getUserInfo')return {status:200,data:{code:0,data:{id:'2110000000000000001',totalCoin:'600'}}};
    if(route==='/api/workflow/upload')return {status:200,data:{code:0,data:{workflowId:'2110000000000000100'}}};
    if(route==='/api/workflow/getContent')return {status:200,data:{code:0,data:{userId:'2110000000000000001',workflowContent:'{"nodes":[]}',draft:true}}};
    if(route==='/api/workflow/setContent')return {status:200,data:{code:0,data:null}};
    if(route==='/api/user/task/work/valid')return {status:200,data:{code:0,data:{billingVersion:'NEW',canCreateTask:true}}};
    if(route==='/upload/image'){
      await new Promise((resolve,reject)=>{config.data.on('end',resolve);config.data.on('error',reject);config.data.resume();});
      return {status:200,data:{name:'input-'+calls.length+'.bin'}};
    }
    if(route==='/task/create'){
      const prompt=JSON.parse(config.data.promptContent);created.push(prompt.prompt);
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
  const context={isRunningHubWebKey,runningHubWeb,workflowGraphs,h3GraphForInputs,akatzGraphForInputs,akatzV3,akatzSeedNodeInfo,withOriginalVideoArchive,
    turbo8GraphForInputs,turbo8SeedNodeInfo,h3AkatzTurbo8Model,
    AKATZ_PROFILE,AKATZ_WINDOW_FRAMES,RIFE_TARGET_FPS,rifeGraphForSourceFps,runningHubInstanceType,h3AppearanceModel,h3CharacterModel,h3AkatzModels,
    DATA_DIR:dir,assertH3MotionContextSchema:async()=>{},
    uploadToRunningHub:(credential,file)=>runningHubWeb.upload(credential,file),
    rhJson:(route,credential,body)=>runningHubWeb.request(route,credential,body)};
  vm.createContext(context);vm.runInContext(server.slice(begin,end)+'\nthis.createTask=createTask;',context);
  const filePath=path.join(dir,'source.bin');fs.writeFileSync(filePath,'fixture-original-media');
  const media={path:filePath,originalname:'source.bin',mimetype:'video/mp4',size:22};
  const source={...h3PhotoPlan(1143,2048),fps:24,totalFrames:49,hasAudio:true,sceneCuts:[],driverCanvas:[736,1280],file:media};
  const submitted={};
  for(const workflowKey of Object.keys(workflowGraphs)){
    const h3Source=workflowKey==='minimaxH3'?{...source,inferenceProfile:H3_DEFAULT_PROFILE}:
      workflowKey.startsWith('minimaxH3Akatz')?{...source,inferenceProfile:AKATZ_PROFILE}:undefined;
    const result=await context.createTask({apiKey:key,workflowId:'unused-api-template',workflowKey,mode:'plus',
      imageFile:{...media,mimetype:'image/png'},videoFile:media,sourceFps:30,
      rifeSource:workflowKey==='rife60'?{width:1920,height:1080}:undefined,h3Source});
    assert.match(result.taskId,/^\d{19}$/);assert.ok(result.submittedAt);
    submitted[workflowKey]=created.at(-1);
  }
  assert.equal(created.length,6,'Every active workflow selection must reach the token task transport');
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
  assert.ok(native['5108'],'Token submission includes the three-frame diagnostic archive');
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
  const missing=createH3AppearanceModel({dir,asset:{...FFP_ASSET,name:'missing-pinned-model'},
    request:async()=>{throw Error('No API key fallback');},http:{get:async()=>{throw Error('No speculative download');}}});
  await assert.rejects(missing.ensure(key),error=>error.code==='H3_MODEL_PREPARATION_FAILED');
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  for(const name of Object.keys(workflowGraphs))assert.ok(html.includes('data-workflow="'+name+'"'));
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../h3-akatz-v3-motion.js',import.meta.url))).digest('hex'),
    '91b41ceb399a8ed159b154f18b4305dab043c30eae9fcb9fa77f3b9745a6b40f','The historical v3 source must be preserved');
  console.log('PASS: all 6 real workflow builders submit via access token, including MotionFly HD and H3/Akatz v3; model receipts reused; v3 source preserved. No live inference.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
