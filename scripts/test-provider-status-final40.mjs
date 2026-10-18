import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-final40-state-'));
process.env.VANTA_DATA_DIR=tmp;
const {ensureFinal40,readFinal40}=await import('../final-fps.js');
const id='2109000000000012345';
try{
  assert.equal(readFinal40(id),null);
  const first=ensureFinal40(id,'http://127.0.0.1/unsafe.mp4');
  assert.equal(first.state,'processing','First conversion attempt starts without blocking');
  const stateFile=path.join(tmp,'final-40fps',id,'status.json');
  for(let i=0;i<50&&!fs.existsSync(stateFile);i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).attempts,1);
  // A terminal conversion failure must never keep the video stuck as 'Memproses'.
  fs.writeFileSync(stateFile,JSON.stringify({attempts:2,lastAttempt:Date.now()-300000}));
  for(let i=0;i<50;i++){
    const value=ensureFinal40(id,'http://127.0.0.1/unsafe.mp4');
    if(value.state==='failed')break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(ensureFinal40(id,'http://127.0.0.1/unsafe.mp4').state,'failed');
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const registry=fs.readFileSync(new URL('../task-registry.js',import.meta.url),'utf8');
  assert.ok(server.includes("state:'finalizing',rawCode:code,providerStatus:'SUCCESS'"));
  assert.ok(server.includes("deliveryNote:'RunningHub selesai. Konversi 40 FPS belum berhasil; video asli tersedia.'"));
  assert.ok(server.includes('if(code===813)'),'Queue status must reflect RunningHub');
  assert.ok(server.includes('if(code===804)'),'Running status must reflect RunningHub');
  assert.ok(server.includes('if(code===805||failure)'),'RunningHub failed status must be reported');
  assert.ok(server.includes("if(code===0)return {state:'waiting_output'"),
    'No result should not be shown as still generating');
  assert.ok(registry.includes("'statusDetail','providerCode','deliveryNote'"),
    'Status reason must persist for History');
  assert.ok(app.includes("if(s==='finalizing')return 'Menyiapkan video 40 FPS'"));
  assert.ok(app.includes('x.deliveryNote?'), 'Original-video availability must be visible');
  assert.ok(app.includes("state:'success'")===false||app.includes('deliveryNote:data.deliveryNote||null'),
    'Successful fallback must preserve delivery warning');
  console.log('PASS: RunningHub state separation, bounded 40fps conversion, preserved original result and transparent History status');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
