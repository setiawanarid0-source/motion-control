import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {KIE_MODELS} from '../kie-studio.js';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright-core',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const app=express();let generated=0;
app.get('/api/auth/session',(_req,res)=>res.json({authenticated:true,requiresPasswordChange:false}));
app.get('/api/session',(_req,res)=>res.json({accounts:[]}));
app.get('/api/kie/models',(_req,res)=>res.json({models:KIE_MODELS.map(({images,...m})=>m)}));
app.get('/api/kie/accounts',(_req,res)=>res.json({accounts:[{id:'fixture-account',name:'Account 01',credits:50,state:'ready'}]}));
app.post('/api/kie/generate',(_req,res)=>{generated++;res.status(500).json({error:'No generation is allowed by this UI test'});});
app.use('/api',(_req,res)=>res.json({accounts:[],tasks:[],jobs:[],restoredIds:[]}));
app.use(express.static(new URL('../public/',import.meta.url).pathname));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium',chromium.executablePath()].find(p=>fs.existsSync(p));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath,args:['--disable-dev-shm-usage']});
  for(const width of [375,1280]){
    const page=await browser.newPage({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
    if(await page.locator('#menuBtn').isVisible())await page.locator('#menuBtn').click();
    const group=page.locator('[data-nav-group="create"]');
    if(!await group.evaluate(el=>el.closest('.nav-group').classList.contains('expanded')))await group.click();
    await page.locator('[data-view="image-create"]').click();
    await page.locator('#kieModel option[value="seedream55"]').waitFor({state:'attached'});
    assert.equal(await page.locator('#kieModel option').count(),13);
    const options=selector=>page.locator(selector+' option').evaluateAll(nodes=>nodes.map(n=>n.value));
    for(const id of ['seedream55','flare26','sunburst26','economy26','grok2']){
      const model=KIE_MODELS.find(m=>m.id===id);
      await page.locator('#kieModel').selectOption(id);
      assert.deepEqual(await options('#kieAspect'),model.aspectRatios);
      assert.deepEqual(await options('#kieResolution'),model.resolutions);
      assert.equal(await page.locator('#kiePrompt').getAttribute('maxlength'),String(model.promptMaxLength||12000));
      if(id==='economy26'){
        assert.equal(await page.locator('#kieResolutionField').isVisible(),false);
        assert.match(await page.locator('#kieModelHint').innerText(),/1K/);
      }
    }
    await page.locator('#kieModel').selectOption('seedream55');
    await page.locator('[data-image-mode="edit"]').click();
    assert.ok((await options('#kieAspect')).includes('auto'));
    await page.locator('#kieAspect').selectOption('auto');
    await page.locator('[data-image-mode="create"]').click();
    assert.ok(!(await options('#kieAspect')).includes('auto'));
    assert.equal(await page.locator('#kieAspect').inputValue(),'1:1');
    await page.locator('#kiePrompt').fill('test');
    await page.locator('#kieGenerateBtn').click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('5.000'));
    assert.equal(generated,0,'Prompt validation runs before submission');
    assert.deepEqual(errors,[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);
    await page.screenshot({path:'/tmp/vanta-kie-models-'+width+'.png',fullPage:true});
    await page.close();
  }
  console.log('PASS: Seedream 5.5 and GPT Image 2.6 controls at mobile/desktop widths, preserved Grok ratios, mode-specific Auto and prompt validation. No generation.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
