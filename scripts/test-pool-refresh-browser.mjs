import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright-core',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));

const app=express();let manualRequests=0,lastToken='2026-11-11T10:00:00Z';
const snapshot=()=>({accounts:[
  {id:'fixture-ready',name:'Account 01',canGenerate:true,status:{apiType:'WEB_SESSION',sessionVerified:true,
    billingVersion:'NEW',balancePoint:30,transitionCoinRemained:600,currentTaskCounts:0,
    sessionRenewal:{state:'automatic',refreshedAt:lastToken}}},
  {id:'fixture-reconnect',name:'Account 02',canGenerate:false,status:{error:'RunningHub menolak refresh token akun ini (kode 412). Hubungkan ulang sesi akun ini sekali.'}}
],poolRefresh:{automatic:true,checkIntervalSeconds:120,renewIntervalSeconds:3600,
  lastAutomaticCheckAt:'2026-11-11T11:00:00Z',lastTokenRefreshAt:lastToken,reconnectRequired:1}});
app.get('/api/session',(_req,res)=>res.json(snapshot()));
app.get('/api/accounts/status',(_req,res)=>res.json(snapshot()));
app.post('/api/accounts/refresh',(_req,res)=>{
  manualRequests++;lastToken='2026-11-11T11:01:00Z';
  res.json({...snapshot(),tokenRenewal:{requested:2,renewed:1,failed:1}});
});
app.get('/api/tasks/history',(_req,res)=>res.json({tasks:[]}));
app.use('/api',(_req,res)=>res.json({accounts:[],models:[],tasks:[],restoredIds:[]}));
app.use(express.static(new URL('../public/',import.meta.url).pathname));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const executablePath=['/usr/bin/google-chrome','/usr/bin/chromium',chromium.executablePath()].find(p=>fs.existsSync(p));
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,375,430,768,1280]){
    lastToken='2026-11-11T10:00:00Z';const before=manualRequests;
    const page=await browser.newPage({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**',route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('poolCount').textContent==='1 akun siap');
    if(await page.locator('#menuBtn').isVisible())await page.locator('#menuBtn').click();
    await page.locator('[data-nav-group="accounts"]').click();
    await page.locator('[data-view="accounts"]').click();
    await page.getByText('Refresh otomatis aktif',{exact:true}).waitFor();
    assert.equal(manualRequests,before,'Loading and opening Pool must only read the backend snapshot');
    assert.match(await page.locator('#poolLastChecked').innerText(),/18[.:]00 WIB/);
    assert.match(await page.locator('#poolLastTokenRefresh').innerText(),/17[.:]00 WIB/);
    const boxes=await page.locator('.pool-refresh-controls').evaluate(element=>{
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
      return {control:rect(element),status:rect(element.querySelector('.pool-refresh-status')),button:rect(element.querySelector('button'))};
    });
    assert.ok(boxes.control.left>=0&&boxes.control.right<=width+1,'Refresh status must stay within the viewport at '+width);
    assert.ok(boxes.status.right+8<=boxes.button.left,'Text and Refresh button must not overlap at '+width);
    assert.ok(boxes.button.width>=44,'Refresh button retains its touch target');
    await page.locator('#refreshAccounts').click();
    await page.waitForFunction(()=>document.getElementById('poolLastTokenRefresh').textContent.includes('18.01'));
    assert.equal(manualRequests,before+1);assert.match(await page.locator('#poolLastChecked').innerText(),/18[.:]00 WIB/);
    assert.deepEqual(errors,[]);
    if([375,1280].includes(width)){
      fs.mkdirSync('/tmp/vanta-backend-refresh',{recursive:true});
      await page.screenshot({path:'/tmp/vanta-backend-refresh/pool-'+width+'.png',fullPage:true});
    }
    await page.close();
  }
  console.log('PASS: Pool status and token timestamps fit 320–1280px, cached reads do not renew, and real Refresh clicks update only the correct timestamp.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
