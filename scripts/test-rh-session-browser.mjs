import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,firefox,webkit}=require(require.resolve('playwright-core',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const type=process.env.RH_TEST_BROWSER||'chromium';
const source=fs.readFileSync(new URL('../public/rh-session.js',import.meta.url),'utf8'),sink={window:{}};
const helpMarkup=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8').match(/<details id="rhSessionBrowserHelp"[\s\S]*?<\/details>/)[0];
vm.runInNewContext(source,sink);const code=sink.window.vantaRunningHubSessionCode;
const access='fixture-access-token-browser',refresh='fixture-rotated-refresh-token';
const engines={chromium,firefox,webkit,edge:chromium};
assert.ok(engines[type],'Unknown test engine');
const options={headless:true};
if(type==='edge')options.channel='msedge';
if(type==='chromium')options.executablePath=['/usr/bin/google-chrome','/usr/bin/chromium',chromium.executablePath()].find(p=>fs.existsSync(p));
const browser=await engines[type].launch(options);
try{
  for(const width of [320,430,1280])for(const blocked of ['none','localStorage','cookie']){
    const context=await browser.newContext({viewport:{width,height:800}}),requests=[];
    context.on('request',r=>requests.push(r.url()));
    await context.route('**/*',route=>{
      assert.equal(route.request().url(),'https://www.runninghub.ai/vanta-test');
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Local RH fixture</title></head><body><main>Original page stays open</main></body></html>'});
    });
    await context.addCookies([{name:'Rh-Accesstoken',value:access,domain:'www.runninghub.ai',path:'/',secure:true},
      {name:'Rh-Refreshtoken',value:'fixture-stale-cookie-token',domain:'www.runninghub.ai',path:'/',secure:true}]);
    const page=await context.newPage();await page.goto('https://www.runninghub.ai/vanta-test');
    await page.evaluate(({code,access,refresh,blocked})=>{
      localStorage.setItem('Rh-Accesstoken',access);localStorage.setItem('Rh-Refreshtoken',refresh);
      localStorage.setItem('Rh-Identify','fixture-identify');localStorage.setItem('Rh-Comfy-Auth','fixture-comfy-auth');
      localStorage.setItem('private-other-data','not-exported');
      if(blocked==='localStorage')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError');}});
      if(blocked==='cookie')Object.defineProperty(document,'cookie',{get(){throw new DOMException('Denied','SecurityError');}});
      const bookmark=document.createElement('a');bookmark.id='fixture-bookmark';bookmark.href=code;
      bookmark.textContent='Run saved code';document.body.appendChild(bookmark);
    },{code,access,refresh,blocked});
    await page.locator('#fixture-bookmark').click();
    const dialog=page.getByRole('dialog',{name:'Hubungkan RunningHub ke Vanta'});
    await dialog.waitFor();assert.equal(await page.locator('#vanta-rh-session-export').count(),1);
    const field=dialog.getByRole('textbox',{name:'Data sesi RunningHub'}),data=JSON.parse(await field.inputValue());
    assert.equal(data.access,access);assert.equal(data.refresh,blocked==='localStorage'?'fixture-stale-cookie-token':refresh);
    assert.deepEqual(Object.keys(data).sort(),['site','access','refresh','identify','comfyAuth'].sort());
    assert.ok(!JSON.stringify(data).includes('not-exported'));
    assert.equal(page.url(),'https://www.runninghub.ai/vanta-test');
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});document.execCommand=()=>false;});
    await dialog.getByRole('button',{name:'Salin token',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'Tekan dan tahan'}).waitFor();
    await dialog.getByRole('button',{name:'Pilih semua',exact:true}).click();
    const selection=await field.evaluate(el=>[el.selectionStart,el.selectionEnd,el.value.length]);
    assert.deepEqual(selection,[0,selection[2],selection[2]]);
    const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
    assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=801,'Popup fits viewport');
    for(const button of await dialog.getByRole('button').all())assert.ok((await button.boundingBox()).height>=44);
    if(blocked==='none')await page.screenshot({path:'/tmp/vanta-rh-export-'+type+'-'+width+'.png'});
    const handle=await field.elementHandle();await dialog.getByRole('button',{name:'Tutup',exact:true}).click();
    assert.equal(await handle.evaluate(el=>el.value),'');await handle.dispose();
    assert.equal(await page.locator('#vanta-rh-session-export').count(),0);
    assert.equal(await page.locator('main').innerText(),'Original page stays open');
    if(blocked==='none'){
      await page.addScriptTag({content:source});
      await page.evaluate(markup=>{
        const host=document.createElement('div');host.innerHTML=markup;document.body.appendChild(host);
        const button=document.createElement('button');button.id='fixture-copy-code';button.textContent='Copy code';
        button.onclick=()=>window.vantaCopyRunningHubCode();document.body.appendChild(button);
        document.getElementById('selectRhSessionCode').onclick=()=>window.vantaSelectRunningHubCode();
        document.getElementById('copyRhBookmarkTestCode').onclick=()=>window.vantaCopyRunningHubBookmarkTest();
      },helpMarkup);
      await page.locator('#fixture-copy-code').click();
      assert.equal(await page.locator('#rhSessionBrowserHelp').evaluate(el=>el.open),true);
      const manual=page.locator('#rhSessionCodeManual');assert.ok((await manual.inputValue()).startsWith('javascript:'));
      await page.locator('#selectRhSessionCode').click();
      const selected=await manual.evaluate(el=>el.selectionEnd-el.selectionStart===el.value.length);
      assert.equal(selected,true,'Vanta code remains manually selectable without clipboard permission');
      await page.getByText('Uji jika bookmark menampilkan “Cannot Run Script”',{exact:true}).click();
      await page.locator('#copyRhBookmarkTestCode').click();
      const diagnostic=page.locator('#rhBookmarkTestCode');
      assert.equal(await diagnostic.inputValue(),"javascript:void(alert('VANTA bookmark berjalan'))");
      assert.equal(await diagnostic.evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length),true);
    }
    assert.equal(requests.length,1,'Session export never sends a request or opens another page');
    await context.close();
  }
  console.log('PASS: '+type+' actual javascript: link navigation, popup, storage denial, manual token/diagnostic code copy and 320/430/1280px layout. Synthetic session only; no physical mobile bookmark coverage.');
}finally{await browser.close();}
