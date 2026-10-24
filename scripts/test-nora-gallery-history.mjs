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
assert.ok(css.includes('.nora-image-fullscreen-trigger')&&css.includes('.nora-viewer.image-fullscreen'),
  'Fullscreen control must overlay image and use a same-page immersive layout');
assert.ok(css.includes('.nora-viewer-photo{position:static;')&&
  /\.nora-image-fullscreen-trigger\{position:absolute;right:9px;bottom:14px;z-index:5;/.test(css)&&
  css.includes('width:32px;height:32px'),
  'Fullscreen button must be small and anchored to the stage right-bottom, not the portrait image');
assert.ok(css.includes('.nora-image-fullscreen-trigger svg{width:16px;height:16px}'),
  'Fullscreen icon must be compact');
assert.ok(html.includes('/history-gallery.js?v=20261024-image-fullscreen-v1')&&
  html.includes('/history-gallery.css?v=20261024-image-fullscreen-stage-v2'),
  'Mobile browsers must receive fresh viewer JS and CSS');
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
assert.ok(fakeEl('noraViewerMedia').innerHTML.includes('data-nora-fullscreen'),
  'Completed image displays fullscreen control on picture itself');
const fullscreenClick={target:{closest:s=>s==='[data-nora-fullscreen]'?{}:null}};
fakeEl('noraViewerMedia').events.click(fullscreenClick);
assert.ok(fakeEl('noraGalleryViewer').classList.contains('image-fullscreen'),
  'Fullscreen preview stays in existing gallery dialog');
fakeEl('noraViewerMedia').events.click(fullscreenClick);
assert.ok(!fakeEl('noraGalleryViewer').classList.contains('image-fullscreen'),
  'Second click restores full gallery with actions');
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
assert.ok(!fakeEl('noraViewerMedia').innerHTML.includes('data-nora-fullscreen'),
  'Pending image must not offer fullscreen of its reference photo');
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
assert.ok(!fakeEl('noraViewerMedia').innerHTML.includes('data-nora-fullscreen'),
  'Motion player remains unaffected by image fullscreen feature');
win.vantaGallery.close();
assert.ok(motionGrid.includes('Memproses'),'Active Motion must clearly show status');
assert.equal((motionGrid.match(/class="nora-gallery-tile"/g)||[]).length,2);


// Numbered page regression: each page replaces the previous 12 cards, unlike
// the old cumulative button that loaded every thumbnail into the DOM.
const many=Array.from({length:49},(_,i)=>({
  id:'bulk-'+i,status:i===0?'generating':'success',
  modelName:'Test Image '+i,mode:'create',accountName:'Account 02',
  createdAt:new Date(Date.parse('2026-10-19T08:00:00Z')-i*60000).toISOString(),
  prompt:'Prompt '+i,resultUrls:i===0?[]:['https://cdn.example.com/'+i+'.jpg']
}));
const countTiles=root=>(root.innerHTML.match(/class="nora-gallery-tile"/g)||[]).length;
const pageEvent=(provider,target)=>({target:{closest:selector=>
  selector==='[data-gallery-page]'?{dataset:{galleryPage:provider,galleryTarget:String(target)}}:null}});
const imageGrid=fakeEl('kieHistoryGrid');
const motionGridEl=fakeEl('motionGalleryGrid');
win.vantaGallery.reset('image');
win.vantaGallery.renderImage(many);
const firstPage=imageGrid.innerHTML;
assert.equal(countTiles(imageGrid),12,'Page 1 renders exactly 12 thumbnails');
assert.equal((firstPage.match(/<img /g)||[]).length,11,'Pending task does not request image');
assert.ok(firstPage.includes('Menampilkan 1–12 dari 49 hasil'));
assert.ok(firstPage.includes('Halaman 1 dari 5'));
assert.ok(firstPage.includes('aria-current="page" disabled>1</button>'));
assert.ok(firstPage.includes('data-gallery-target="2"'));
assert.ok(!firstPage.includes('data-gallery-more'),'Cumulative Load More must be removed');
assert.ok(!firstPage.includes('bulk-25'),'Off-page media must not be mounted');
assert.ok(firstPage.includes('loading="lazy" decoding="async" fetchpriority="low"'));
win.vantaGallery.open('image','bulk-0');
assert.equal(fakeEl('noraViewerCounter').textContent,'1 / 12');
win.vantaGallery.close();
imageGrid.events.click(pageEvent('image',2));
assert.equal(countTiles(imageGrid),12,'Page 2 replaces rather than appends tiles');
assert.ok(imageGrid.innerHTML.includes('Menampilkan 13–24 dari 49 hasil'));
assert.ok(imageGrid.innerHTML.includes('bulk-12'));
assert.ok(imageGrid.innerHTML.includes('bulk-23'));
assert.ok(!imageGrid.innerHTML.includes('bulk-0"')&&!imageGrid.innerHTML.includes('bulk-24"'),
  'Page 1/3 thumbnails must be removed from the DOM');
assert.ok(imageGrid.innerHTML.includes('aria-current="page" disabled>2</button>'));
win.vantaGallery.open('image','bulk-12');
assert.equal(fakeEl('noraViewerCounter').textContent,'1 / 12',
  'Viewer navigation must be scoped to the current page');
win.vantaGallery.close();
imageGrid.events.click(pageEvent('image',5));
assert.equal(countTiles(imageGrid),1,'Last page only renders remaining one item');
assert.ok(imageGrid.innerHTML.includes('Menampilkan 49–49 dari 49 hasil'));
assert.ok(imageGrid.innerHTML.includes('Halaman 5 dari 5'));
imageGrid.events.click(pageEvent('image',6));
assert.equal(countTiles(imageGrid),1,'Invalid page must be ignored');
imageGrid.events.click(pageEvent('image',1));
assert.equal(countTiles(imageGrid),12,'Returning to page 1 restores its original 12 tiles');
win.vantaGallery.reset('image');
win.vantaGallery.renderImage(many.slice(0,20));
assert.equal(countTiles(imageGrid),12);
assert.ok(imageGrid.innerHTML.includes('Halaman 1 dari 2'),'Filter resets to first page');

const bigMotion=Array.from({length:37},(_,i)=>({
  taskId:String(2109126366731990000+i),status:'success',
  workflow:'Current Workflow',mode:'plus',account:'Account 05',
  startedAt:new Date(Date.parse('2026-10-19T08:00:00Z')-i*60000).toISOString(),
  resultUrl:'https://vanta.test/api/video-'+i+'.mp4'
}));
win.vantaGallery.reset('motion');
win.vantaGallery.renderMotion(bigMotion);
assert.equal(countTiles(motionGridEl),12,'Motion page 1 renders exactly 12 items');
assert.ok(!motionGridEl.innerHTML.includes('<video '),'No motion tile may load MP4');
motionGridEl.events.click(pageEvent('motion',2));
assert.equal(countTiles(motionGridEl),12,'Motion page 2 replaces old thumbnails');
assert.ok(motionGridEl.innerHTML.includes('Halaman 2 dari 4'));
assert.equal(countTiles(imageGrid),12,'Image and Motion pages remain independent');
motionGridEl.events.click(pageEvent('motion',4));
assert.equal(countTiles(motionGridEl),1);
win.vantaGallery.renderMotion(bigMotion.slice(0,15));
assert.equal(countTiles(motionGridEl),3,'Removing results clamps page 4 to the last existing page 2');
assert.ok(motionGridEl.innerHTML.includes('Halaman 2 dari 2'));

// A large archive remains navigable without rendering it in full.
const large=Array.from({length:145},(_,i)=>({
  ...many[i%many.length],id:'large-'+i,
  createdAt:new Date(Date.parse('2026-10-19T08:00:00Z')-i*60000).toISOString()
}));
win.vantaGallery.reset('image');
win.vantaGallery.renderImage(large);
assert.equal(countTiles(imageGrid),12);
assert.ok(imageGrid.innerHTML.includes('nora-page-ellipsis'),
  'Compact pagination must use ellipses for archives with many pages');
assert.ok(imageGrid.innerHTML.includes('Halaman 1 dari 13'));
imageGrid.events.click(pageEvent('image',8));
assert.equal(countTiles(imageGrid),12);
assert.ok(imageGrid.innerHTML.includes('Halaman 8 dari 13'));
assert.ok(imageGrid.innerHTML.includes('aria-current="page" disabled>8</button>'));
assert.ok(!imageGrid.innerHTML.includes('large-0"'),'Current page replaces former thumbnails');
assert.ok(main.includes("window.vantaGallery?.reset('motion')")&&image.includes("window.vantaGallery?.reset('image')"),
  'Changing History filters resets page to 1');
assert.ok(main.includes('if(window.vantaGallery){')&&main.includes('window.vantaGallery.renderMotion(items);'),
  'Legacy hidden history table must not render on every poll');
assert.ok(css.includes('.nora-page-btn.active')&&css.includes('.nora-page-ellipsis'),
  'Pagination must have a distinct active page and professional compact styling');

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
