import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import {h3PhotoPlan} from '../minimax-h3-motion.js';
import {turbo8GraphForInputs,turbo8EditorForFrames,turbo8NodeClass,TURBO8_ASSET,TURBO8_EDITOR_FILENAME} from '../h3-akatz-turbo8.js';
import {parseAkatzOptions,AKATZ_RETIRED_FLAGS,AKATZ_RETIRED_REVISIONS} from '../h3-akatz-options.js';
import {installAkatzEditorDownload} from '../h3-runninghub-export.js';

const models={characterLoraFile:'api-lora-usa/'+'0'.repeat(32)+'.safetensors',turboLoraFile:TURBO8_ASSET.publishedUpload.name};
const source=c=>({...h3PhotoPlan(c.width,c.height),fps:24,totalFrames:c.frames,hasAudio:c.audio});
const build=s=>turbo8GraphForInputs({...models,source:s,imageName:'photo.png',videoName:'video.mp4'});
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/akatz-expression-baselines.json',import.meta.url)));
for(const c of fixtures.cases){
  const g=build(source(c)),sha=crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex');
  assert.equal(sha,c.sha256,'Retirement must preserve the accepted baseline payload');
  assert.ok(!Object.values(g).some(n=>/LivePortrait|ControlNet|SAM3|MaskToLatentSpace/.test(n.class_type)));
}
for(const flag of AKATZ_RETIRED_FLAGS){
  assert.throws(()=>parseAkatzOptions('minimaxH3Akatz',{[flag]:'true'}),{code:'AKATZ_VARIANT_RETIRED',statusCode:410,definitelyRejected:true});
  assert.throws(()=>build({...source({width:1080,height:1920,frames:1201,audio:true}),[flag]:true}),{code:'AKATZ_VARIANT_RETIRED'});
  assert.throws(()=>turbo8EditorForFrames({...models,frames:124,[flag]:true}),{code:'AKATZ_VARIANT_RETIRED'});
  assert.equal(parseAkatzOptions('minimaxH3Akatz',{[flag]:'false'})[flag],false,'Old baseline clients remain accepted');
  for(const value of ['yes',['true'],{},1])assert.throws(()=>parseAkatzOptions('minimaxH3Akatz',{[flag]:value}));
}
for(const revision of AKATZ_RETIRED_REVISIONS)
  assert.equal(turbo8NodeClass('1011',{revision,nodeClasses:{1011:'SamplerCustomAdvanced'}}),'SamplerCustomAdvanced',
    'Existing History and accepted provider tasks retain node classification');

const app=express();let receipts=0,graphs=0;
installAkatzEditorDownload({app,validateRequest:req=>parseAkatzOptions('minimaxH3Akatz',req.query),
  getModelFiles:()=>{receipts++;return models;},filename:TURBO8_EDITOR_FILENAME,
  buildWorkflow:()=>{graphs++;return turbo8EditorForFrames({...models,frames:124});}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
  for(const flag of AKATZ_RETIRED_FLAGS){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/minimaxH3Akatz/runninghub?${flag}=true`);
    assert.equal(response.status,410);assert.match((await response.json()).error,/sudah dihapus/);
  }
  assert.equal(receipts,0,'Retired exports stop before model receipts or a provider operation');assert.equal(graphs,0);
  const baseline=await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/minimaxH3Akatz/runninghub`);
  assert.equal(baseline.status,200);assert.ok((await baseline.json()).nodes.length>0);
}finally{await new Promise(resolve=>server.close(resolve));}

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const browser=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const serverCode=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.ok(!/Mask subjek|ControlNet wajah|Uji mimik|id="akatzExpression"/.test(html));
assert.ok(!/akatzSubjectMask|akatzFaceControl|akatzExpression|readAkatzMode/.test(browser));
assert.ok(serverCode.includes('parseAkatzOptions(workflowKey,req.body);'),'Stale queued requests are rejected before media preparation and submission');
for(const name of ['h3-akatz-expression.js','h3-akatz-face-control.js','h3-akatz-subject-mask.js'])
  assert.equal(fs.existsSync(new URL('../'+name,import.meta.url)),false,'Obsolete generator must be removed');
console.log('PASS: 60 baseline payloads unchanged; failed experiments removed; old tabs/queued builders/exports rejected before provider work; legacy History readable.');
