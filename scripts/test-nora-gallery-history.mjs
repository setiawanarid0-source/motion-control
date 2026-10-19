import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createTaskRegistry} from '../task-registry.js';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const image=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const gallery=fs.readFileSync(new URL('../public/history-gallery.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/history-gallery.css',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const kie=fs.readFileSync(new URL('../kie-studio.js',import.meta.url),'utf8');

for(const id of ['motionGalleryGrid','kieHistoryGrid','noraGalleryViewer','noraViewerStage',
'noraViewerPrev','noraViewerNext','noraViewerCounter','noraViewerPrompt','noraViewerCopy',
'noraViewerActions','noraViewerClose','motionGalleryRefresh','historyBody'])
  assert.ok(html.includes('id="'+id+'"'),'Missing Nora Gallery component '+id);
assert.ok(html.includes('history-gallery.js?v=')&&html.includes('history-gallery.css?v='));
assert.ok(html.indexOf('kie-ui.js?v=')<html.indexOf('history-gallery.js?v='),
  'Gallery must initialize after both apps expose their data adapters');
assert.ok(main.includes('window.vantaGallery?.renderMotion(items);'));
assert.ok(main.includes('window.vantaMotionGallery={'));
assert.ok(main.includes('renderLiveTaskDuration();'),'Existing RunningHub Live Task timer intact');
assert.ok(image.includes('window.vantaImageGallery={'));
assert.ok(image.includes('window.vantaGallery.renderImage(tasks)'));
assert.ok(image.includes("fd.append('mode',kie.mode)"),'kie generation must not change');
assert.ok(kie.includes("router.delete('/tasks/:id'"),'Image deletion must be server-side');
assert.ok(kie.includes("if(!['success','failed'].includes(item.status))"),
  'Active kie.ai tasks cannot be deleted');
assert.ok(server.includes("app.delete('/api/tasks/:taskId/history'"),
  'Motion deletion must be server-side');
assert.ok(server.includes("taskRegistry.removeCompleted(id,accountId)"),
  'No RunningHub provider delete/cancel calls allowed');
assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'),
  'Mobile Nora gallery must be three columns');
assert.ok(css.includes('.nora-viewer-image')&&css.includes('object-fit:contain'),
  'Viewer must show full image without cropping');
assert.ok(gallery.includes("e.key==='ArrowRight'")&&gallery.includes("e.key==='ArrowLeft'"));
assert.ok(gallery.includes("addEventListener('touchend'"));
assert.ok(!gallery.includes('createTask')&&!gallery.includes('submitImage('),
  'Gallery itself must never submit paid generation calls');

const components=new Map();
function fakeEl(id){
  if(!components.has(id)){
    const classes=new Set(['noraGalleryViewer'].includes(id)?['hidden']:[]);
    components.set(id,{id,innerHTML:'',textContent:'',hidden:false,disabled:false,
      value:'',isConnected:true,events:{},
      classList:{
        add(v){classes.add(v);},remove(v){classes.delete(v);},
        contains(v){return classes.has(v);},toggle(v){return classes.has(v)?(classes.delete(v),false):(classes.add(v),true);}
      },
      addEventListener(event,fn){this.events[event]=fn;},
      querySelectorAll(){return[];},
      querySelector(selector){return selector==='[data-nora-close]'?{addEventListener(){}}:null;},
      focus(){},
    });
  }
  return components.get(id);
}
const document={
  activeElement:{isConnected:true,focus(){}},
  body:{classList:{add(){},remove(){}}},
  getElementById:id=>fakeEl(id),
  addEventListener(){},
};
const clipboard=[];
const win={vantaImageGallery:{redraw(){},async remove(item){win.removed=item.id;}},
  vantaMotionGallery:{redraw(){},videoUrl:t=>t.resultUrl,referenceUrl:()=>null,
    elapsed:()=>5000,formatDuration:()=> '00:00:05'}};
const context={window:win,document,location:{origin:'https://vanta.test'},
URL,Date,Number,Math,String,JSON,console,
navigator:{clipboard:{writeText:async s=>clipboard.push(s)}},
confirm:()=>true,alert(){},setTimeout};
vm.createContext(context);
assert.doesNotThrow(()=>vm.runInContext(gallery,context),'Real Gallery module must execute');
const entries=[
{id:'a',status:'success',modelName:'WAN Image Pro',model:'wan',mode:'edit',
  createdAt:'2026-10-18T12:05:00Z',prompt:'Very long sample prompt <img onerror=evil>',
  accountName:'Account 02',resultUrls:['https://cdn.example.com/a.jpg'],creditsConsumed:12},
{id:'b',status:'success',modelName:'Nano Banana',mode:'create',
  createdAt:'2026-10-18T12:04:00Z',prompt:'Second prompt',
  accountName:'Account 01',resultUrls:['https://cdn.example.com/b.jpg']},
{id:'c',status:'generating',modelName:'Seedream',mode:'create',
  createdAt:'2026-10-18T12:03:00Z',prompt:'Waiting',accountName:'Account 04',resultUrls:[]},
];
win.vantaGallery.renderImage(entries);
const grid=fakeEl('kieHistoryGrid').innerHTML;
assert.equal((grid.match(/class="nora-gallery-tile"/g)||[]).length,3);
assert.ok(!grid.includes('Very long sample prompt'),'Full prompt must only appear in viewer');
assert.ok(!grid.includes('onerror=evil'),'Untrusted content must not be rendered as markup');
assert.ok(grid.includes('data-gallery-open="a"'));
win.vantaGallery.open('image','a');
assert.equal(fakeEl('noraViewerTitle').textContent,'WAN Image Pro');
assert.equal(fakeEl('noraViewerCounter').textContent,'1 / 3');
assert.equal(fakeEl('noraViewerPrompt').textContent,entries[0].prompt);
assert.ok(fakeEl('noraViewerActions').innerHTML.includes('data-nora-action="edit"'));
assert.ok(fakeEl('noraViewerActions').innerHTML.includes('data-nora-action="delete"'));
fakeEl('noraViewerNext').events.click();
assert.equal(fakeEl('noraViewerTitle').textContent,'Nano Banana');
fakeEl('noraViewerPrev').events.click();
assert.equal(fakeEl('noraViewerTitle').textContent,'WAN Image Pro');
await fakeEl('noraViewerCopy').events.click();
assert.deepEqual(clipboard,[entries[0].prompt],'Copy prompt must use actual full prompt');
win.vantaGallery.open('image','c');
assert.ok(!fakeEl('noraViewerActions').innerHTML.includes('data-nora-action="delete"'),
  'Active paid task cannot be deleted');
assert.ok(fakeEl('noraViewerActions').innerHTML.includes('data-nora-action="refresh"'));
win.vantaGallery.close();
win.vantaGallery.renderMotion([
  {taskId:'2109126366731984898',status:'processing',workflow:'Current Workflow',
    startedAt:'2026-10-18T12:10:00Z',account:'Account 05'},
  {taskId:'2109126366731984899',status:'success',workflow:'R4 Full',
    resultUrl:'https://vanta.test/api/video.mp4',startedAt:'2026-10-18T11:10:00Z',account:'Account 03'}
]);
const motionGrid=fakeEl('motionGalleryGrid').innerHTML;
assert.ok(motionGrid.includes('data-gallery-provider="motion"'));
assert.ok(!motionGrid.includes('<video '),'Motion gallery must never preload heavy MP4 thumbnail streams');
win.vantaGallery.open('motion','2109126366731984899');
assert.ok(fakeEl('noraViewerMedia').innerHTML.includes('<video '),
  'Motion video loads on explicit viewer open, not before');
win.vantaGallery.close();
assert.ok(motionGrid.includes('Memproses'),'Active Motion must clearly show status');
assert.equal((motionGrid.match(/class="nora-gallery-tile"/g)||[]).length,2);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vanta-gallery-delete-'));
try{
  const vault=createTaskRegistry({dir:tmp,encrypt:JSON.stringify,decrypt:JSON.parse});
  const id='2109126366731984998';
  vault.add({taskId:id,key:'secret',accountId:'acc',workflow:'Current'});
  assert.throws(()=>vault.removeCompleted(id,'acc'),/masih diproses/);
  assert.equal(vault.get(id).key,'secret','Active task escrow remains intact');
  vault.update(id,{status:'success',resultUrl:'https://example.com/video.mp4'});
  assert.throws(()=>vault.removeCompleted(id,'different'),/tidak cocok/);
  assert.equal(vault.removeCompleted(id,'acc'),true);
  assert.equal(vault.get(id),null);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('PASS: Nora Gallery grids, lazy on-demand video preview, viewer arrows, prompt copy, terminal delete guard, active status, generators unchanged');
