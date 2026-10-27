import { chromium } from 'playwright-core';
import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const app=express();
app.use(express.json());
const mockTasks=[{
  id:'11111111-2222-4333-8444-555555555555',
  instruction:'Inspeksi Worker yang dipantau',
  status:'running_worker',createdAt:new Date().toISOString(),
  scope:{domains:['kie.ai'],actions:['inspect','navigate'],budgetUsd:0},
  workerRun:{startedAt:new Date().toISOString(),steps:2,summary:'',
    timeline:[{at:new Date().toISOString(),kind:'opening',text:'Membuka browser kie.ai',step:0},
      {at:new Date().toISOString(),kind:'navigating',text:'Berpindah ke halaman yang diizinkan',step:2}]}
}];
const empty={events:[],incidents:[],discussions:[],memories:[],skills:[]};
const skillReviews=[];
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

const ownerBrowserActions=[];
const ownerBrowserFrame=id=>({
  sessionId:'test-owner-session-1',taskId:id,domain:'kie.ai',url:'https://kie.ai/login',
  title:'KIE Login',width:960,height:660,blockedRequests:0,image:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCABQAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKKYgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q=='
});
app.post('/api/agent/bridge/v1/tasks/:id/browser/start',(req,res)=>{
  assert.equal(req.body.domain,'kie.ai');
  const task=mockTasks.find(t=>t.id===req.params.id);
  assert.ok(task.scope.actions.includes('login_assisted'));
  res.json({browser:ownerBrowserFrame(task.id)});
});
app.post('/api/agent/bridge/v1/tasks/:id/browser/act',(req,res)=>{
  ownerBrowserActions.push(req.body.action);
  res.json({browser:ownerBrowserFrame(req.params.id)});
});
app.post('/api/agent/bridge/v1/tasks/:id/browser/close',(req,res)=>{
  ownerBrowserActions.push({kind:'close'});
  res.json({browser:{closed:true}});
});

app.get('/api/agent/bridge/v1/tasks/:id/monitor',(req,res)=>{
  const task=mockTasks.find(x=>x.id===req.params.id);
  if(!task)return res.status(404).json({error:'Missing task'});
  const monitor={taskId:task.id,status:task.status,active:task.status==='running_worker',
    steps:task.workerRun?.steps||0,maxSteps:6,summary:task.workerRun?.summary||'',
    timeline:task.workerRun?.timeline||[],frame:null};
  if(req.query.frame==='1'&&monitor.active)monitor.frame={
    image:ownerBrowserFrame(task.id).image,url:'https://kie.ai/',
    capturedAt:new Date().toISOString()};
  res.json({monitor});
});
app.post('/api/agent/bridge/v1/skills',(req,res)=>{
  const skill={id:'11111111-2222-4333-8444-111111111111',...req.body,status:'proposed',screening:null};
  empty.skills.unshift(skill);res.status(201).json({skill});
});
app.post('/api/agent/bridge/v1/skills/:id/:action',(req,res)=>{
  const skill=empty.skills.find(x=>x.id===req.params.id);
  if(!skill)return res.status(404).json({error:'Unknown SOP'});
  if(req.params.action==='screen'){
    skill.screening={passed:true,issues:[],mode:'static_screen_only'};
    skill.status='screened';
  }else if(req.params.action==='verify'&&skill.status==='screened')skill.status='verified';
  else if(req.params.action==='reject')skill.status='rejected';
  else return res.status(409).json({error:'Invalid skill transition'});
  skillReviews.push(req.params.action);
  res.json({skill});
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
   // Ensure completed browser evidence survives refresh and is readable in the task card.
   mockTasks[0].status = 'approved_pending_worker';
   mockTasks[0].checkpoints = [{
     description: JSON.stringify({readOnly:true,finishedAt:new Date().toISOString(),
       status:200,title:'KIE login',mode:'isolated',blockedRequests:2})
   }];
   await page.reload({waitUntil:'networkidle'});
   await page.getByText('Hasil inspeksi browser').first().waitFor();
   assert.ok(await page.getByText(/KIE login/).first().isVisible());
   assert.ok(await page.getByRole('button',{name:'Tes browser (read-only)'}).first().isVisible());
   mockTasks[0].scope.actions.push('login_assisted','click','form_fill');
   await page.reload({waitUntil:'networkidle'});
   const opener=page.getByRole('button',{name:'Buka browser Owner'});
   await opener.click();
   const ownerDialog=page.locator('#ownerBrowserDialog');
   await ownerDialog.waitFor({state:'visible'});
   assert.equal(await page.locator('#ownerBrowserText').getAttribute('type'),'password');
   assert.ok(await page.locator('#ownerBrowserImage').isVisible());
   const rect=await ownerDialog.boundingBox();
   assert.ok(rect.x>=-1 && rect.x+rect.width<=width+1,'Owner browser modal horizontally clipped on mobile');
   await page.locator('#ownerBrowserImage').click({position:{x:30,y:30}});
   await page.getByRole('button',{name:'Tab',exact:true}).click();
   await page.locator('#ownerBrowserText').fill('demo@example.com');
   await page.getByRole('button',{name:'Ketik',exact:true}).click();
   assert.equal(await page.locator('#ownerBrowserText').inputValue(),'');
   await page.locator('#ownerBrowserClose').click();
   await page.waitForFunction(()=>!document.getElementById('ownerBrowserDialog').open);
   assert.ok(ownerBrowserActions.some(a=>a.kind==='click'));
   assert.ok(ownerBrowserActions.some(a=>a.kind==='key' && a.key==='Tab'));
   assert.ok(ownerBrowserActions.some(a=>a.kind==='type' && a.text==='demo@example.com'));
   assert.ok(ownerBrowserActions.some(a=>a.kind==='close'));
  } else {
   await page.locator('#cancelTaskDialog').click();
  }
  await page.locator('[data-tab="knowledge"]').click();
  assert.equal(await page.locator('#tab-knowledge').isVisible(),true);
  await page.locator('.disclosure').last().evaluate(x=>x.open=true);
  assert.equal(await page.locator('#skillForm').isVisible(),true);
  if(width===375){
    await page.locator('#skillOwner').selectOption('worker');
    await page.locator('#skillDomain').selectOption('kie.ai');
    await page.locator('#skillName').fill('Inspect login redirect');
    await page.locator('#skillProcedure').fill('1. Inspect login redirect and observe current status.\n2. Follow approved documentation and confirm destination.');
    await page.locator('#skillEvidence').fill('Owner tested equivalent navigation during browser inspection');
    await page.getByRole('button',{name:'Usulkan SOP'}).click();
    await page.getByRole('button',{name:'Audit SOP'}).first().click();
    await page.getByRole('button',{name:'Verifikasi setelah uji nyata'}).first().click();
    assert.deepEqual(skillReviews.slice(-2),['screen','verify']);
    assert.ok(await page.getByText(/Inspect login redirect · verified/).first().isVisible());
  }

  await page.locator('[data-tab="approvals"]').click();
  assert.equal(await page.locator('#tab-approvals').isVisible(),true);
  await page.locator('[data-tab="tasks"]').click();
  await page.getByRole('button',{name:'Pantau langsung'}).first().click();
  const liveMonitor=page.locator('#workerMonitorDialog');
  await liveMonitor.waitFor({state:'visible'});
  await page.getByText('Membuka browser kie.ai').first().waitFor();
  const monitorRect=await liveMonitor.boundingBox();
  assert.ok(monitorRect.x>=-1 && monitorRect.x+monitorRect.width<=width+1,
    'Worker monitor clipped horizontally at '+width);
  assert.ok(await page.locator('#workerMonitorImage').isVisible());
  assert.equal(await page.locator('#workerMonitorImage').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  assert.ok(await page.getByText('2 / 6 langkah').isVisible());
  if(width===375)await page.screenshot({path:'/tmp/vanta-worker-live-monitor-375.png',fullPage:false});
  await page.locator('#workerMonitorClose').click();
  assert.equal(await liveMonitor.evaluate(x=>x.open),false);
  assert.equal(await page.locator('#workerMonitorImage').getAttribute('src'),null);

  assert.equal(errors.length,0,'Browser errors at '+width+': '+errors.join('; '));
  if(width===320)await page.screenshot({path:'/tmp/vanta-mobile-agent-320.png',fullPage:false});
  if(width===1280)await page.screenshot({path:'/tmp/vanta-agent-desktop.png',fullPage:false});
  console.log('PASS '+width+'px: no page overflow, 4 visible nav targets, task dialog, tabs, memory/skills and zero runtime errors');
  await context.close();
 }
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
