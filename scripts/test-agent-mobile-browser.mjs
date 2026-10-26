import { chromium } from 'playwright-core';
import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const app=express();
app.use(express.json());
const mockTasks=[];
const empty={events:[],incidents:[],discussions:[],memories:[],skills:[]};
app.get('/api/agent/bridge/v1/status',(_req,res)=>res.json({worker:'not_installed',
  supervisor:'not_installed',browser:'ready_readonly',executionEnabled:false}));
app.get('/api/agent/bridge/v1/tasks',(_req,res)=>res.json({tasks:mockTasks}));
for(const [route,key] of [['audit','events'],['incidents','incidents'],['discussions','discussions'],
  ['memories','memories'],['skills','skills']]){
 app.get('/api/agent/bridge/v1/'+route,(_req,res)=>res.json({[key]:empty[key]}));
}
app.post('/api/agent/bridge/v1/tasks',(req,res)=>{
 const task={id:'c7d9ef00-1111-4444-a333-123456789012',instruction:req.body.instruction,
   scope:req.body.scope,createdAt:new Date().toISOString(),status:'awaiting_approval'};
 mockTasks.unshift(task);
 res.status(201).json({task});
});
app.use(express.static(new URL('../public/',import.meta.url).pathname));
const server=createServer(app);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const executablePath = ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if (!executablePath) throw new Error('Chrome or Chromium is required for responsive smoke tests');
const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [320,375,430,768,1280]){
  const context=await browser.newContext({viewport:{width,height:850},deviceScaleFactor:1,
    isMobile:width<640,hasTouch:width<640});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/ai-agent.html',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.getElementById('browser').textContent.includes('Siap'));
  let layout=await page.evaluate(()=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top}};
    return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,
      body:document.body.scrollWidth,nav:[...document.querySelectorAll('.tabs button')].map(rect),
      create:rect(document.getElementById('openTaskDialog')),status:document.getElementById('browser').textContent};
  });
  assert.ok(layout.scroll<=width+1&&layout.body<=width+1,'Horizontal clipping at '+width+': '+JSON.stringify(layout));
  assert.equal(layout.nav.length,4);
  for(const bounds of layout.nav){
    assert.ok(bounds.left>=-1&&bounds.right<=width+1,
      'Bottom/desktop navigation must be reachable at '+width+': '+JSON.stringify(bounds));
  }
  assert.ok(layout.create.right<=width+1,'New task button clipped at '+width);
  if(width<640){
   assert.ok(layout.nav.every(x=>x.bottom>720),'Mobile dock must be visible at '+width);
  }
  const dialog=page.locator('#taskDialog');
  await page.locator('#openTaskDialog').click();
  assert.equal(await dialog.evaluate(x=>x.open),true);
  const dialogRect=await dialog.boundingBox();
  assert.ok(dialogRect.x>=-1&&dialogRect.x+dialogRect.width<=width+1,
    'Task sheet exceeds viewport at '+width);
  if(width===375){
   await page.screenshot({path:'/tmp/vanta-mobile-agent-375.png',fullPage:false});
   await page.locator('#instruction').fill('Periksa halaman login kie.ai saja.');
   await page.getByRole('button',{name:'Simpan tugas'}).click();
   await page.waitForFunction(()=>!document.getElementById('taskDialog').open);
   assert.equal(mockTasks[0].instruction,'Periksa halaman login kie.ai saja.');
  } else {
   await page.locator('#cancelTaskDialog').click();
  }
  await page.locator('[data-tab="knowledge"]').click();
  assert.equal(await page.locator('#tab-knowledge').isVisible(),true);
  await page.locator('.disclosure').last().evaluate(x=>x.open=true);
  assert.equal(await page.locator('#skillForm').isVisible(),true);
  await page.locator('[data-tab="approvals"]').click();
  assert.equal(await page.locator('#tab-approvals').isVisible(),true);
  assert.equal(errors.length,0,'Browser errors at '+width+': '+errors.join('; '));
  if(width===320)await page.screenshot({path:'/tmp/vanta-mobile-agent-320.png',fullPage:false});
  if(width===1280)await page.screenshot({path:'/tmp/vanta-agent-desktop.png',fullPage:false});
  console.log('PASS '+width+'px: no page overflow, 4 visible nav targets, task dialog, tabs, memory/skills and zero runtime errors');
  await context.close();
 }
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
