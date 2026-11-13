// Tests the userscript in a real isolated MV3 content-script context, with page
// script execution forbidden. This is not a physical Edge Android app test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright-core',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-rh-extension-'));
const extension=path.join(temporary,'extension');fs.mkdirSync(extension);
fs.copyFileSync(new URL('../public/vanta-runninghub-session.user.js',import.meta.url),path.join(extension,'session.js'));
fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Vanta synthetic session test',version:'1.0',
  content_scripts:[{matches:['https://www.runninghub.ai/*','https://runninghub.ai/*'],js:['session.js'],run_at:'document_idle',world:'ISOLATED',all_frames:false}]}));
const context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'chromium',headless:true,
  args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{
  const requests=[],errors=[];
  context.on('request',r=>requests.push(r.url()));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    assert.ok(['www.runninghub.ai','runninghub.ai','unrelated.example'].includes(url.hostname));
    return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:"},
      body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><main>Synthetic RunningHub page</main></body></html>'});
  });
  await context.addInitScript(()=>{
    localStorage.setItem('Rh-Accesstoken','fixture-extension-access');
    localStorage.setItem('Rh-Refreshtoken','fixture-extension-rotated-refresh');
    localStorage.setItem('Rh-Identify','fixture-identify');localStorage.setItem('Rh-Comfy-Auth','fixture-auth');
    localStorage.setItem('unrelated-secret','never-export-this');
  });
  await context.addCookies([{name:'Rh-Refreshtoken',value:'fixture-stale-refresh',domain:'www.runninghub.ai',path:'/',secure:true}]);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const width of [320,430,1280])for(const hostname of ['www.runninghub.ai','runninghub.ai']){
    await page.setViewportSize({width,height:800});await page.goto('https://'+hostname+'/vanta-test');
    const launcher=page.getByRole('button',{name:'Salin sesi ke Vanta',exact:true});await launcher.waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'No session dialog before a user tap');
    await launcher.click();
    const dialog=page.getByRole('dialog',{name:'Hubungkan RunningHub ke Vanta'});await dialog.waitFor();
    const field=dialog.getByRole('textbox',{name:'Data sesi RunningHub'}),data=JSON.parse(await field.inputValue());
    assert.equal(data.access,'fixture-extension-access');assert.equal(data.refresh,'fixture-extension-rotated-refresh');
    assert.deepEqual(Object.keys(data).sort(),['site','access','refresh','identify','comfyAuth'].sort());
    assert.ok(!JSON.stringify(data).includes('never-export-this'));
    await dialog.getByRole('button',{name:'Pilih semua',exact:true}).click();
    assert.equal(await field.evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length),true);
    const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    if(hostname==='www.runninghub.ai')await page.screenshot({path:'/tmp/vanta-rh-extension-'+width+'.png'});
    const handle=await field.elementHandle();await dialog.getByRole('button',{name:'Tutup',exact:true}).click();
    assert.equal(await handle.evaluate(el=>el.value),'');await handle.dispose();
    await launcher.click();assert.equal(await page.getByRole('dialog').count(),1);
    await page.getByRole('button',{name:'Tutup',exact:true}).click();
  }
  await page.goto('https://unrelated.example/vanta-test');
  assert.equal(await page.locator('#vanta-rh-session-launcher').count(),0,'Unrelated origins get no launcher');
  assert.equal(requests.length,7,'Only test page navigations; export sends no request');assert.deepEqual(errors,[]);
  console.log('PASS: real isolated MV3 context, strict page CSP, two RH origins, manual select, clear/reopen, 320/430/1280px. No physical mobile app coverage.');
}finally{await context.close();fs.rmSync(temporary,{recursive:true,force:true});}
