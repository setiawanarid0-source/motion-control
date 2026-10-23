// Regression test: execute the REAL Create-page bootstrap, not just individual
// handlers. querySelector returns ONE element; querySelectorAll returns a list.
// A previous '$(".workflow-card").forEach(...)' exception disabled all controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const start=app.indexOf("$$('.nav-item').forEach(");
const end=app.indexOf('\nbindHistoryActions();',start);
const helperStart=app.indexOf('function initDropzone(');
assert.ok(start>0&&end>start&&helperStart>0&&helperStart<start,
  'Real Create-page click bootstrap and initDropzone must exist');
const executable=app.slice(helperStart,end);

function makeElement(dataset={}){
  const active=new Set();
  const callbacks=new Map();
  return {
    dataset,disabled:false,value:'',files:[],classList:{
      contains:key=>active.has(key),
      add:key=>active.add(key),
      remove:key=>active.delete(key),
      toggle(key,enabled){
        const on=enabled===undefined?!active.has(key):!!enabled;
        if(on)active.add(key);else active.delete(key);return on;
      }
    },
    addEventListener:(event,fn)=>callbacks.set(event,fn),
    listener:event=>callbacks.get(event),
    querySelector:()=>({textContent:''}),
    onclick:null,onchange:null
  };
}
const nav=['create','image-create','history','image-history','accounts','kie-accounts']
  .map(view=>makeElement({view}));
const workflow=['r15','current','koh1AntiObject','r4Lab']
  .map(id=>makeElement({workflow:id}));
const modes=['standard','plus'].map(mode=>makeElement({mode}));
for(const key of ['create','image-create','history','image-history','accounts','kie-accounts']){
  assert.ok(html.includes('data-view="'+key+'"'),'Nav route must exist: '+key);
}
for(const key of workflow.map(x=>x.dataset.workflow)){
  assert.ok(html.includes('data-workflow="'+key+'"'),'Workflow option must exist: '+key);
}
const nodeKeys=['#menuBtn','#sidebar','#diagnosticNotice','#fullLabNotice',
  '#imageDrop','#referenceImage','#videoDrop',
  '#videoReference','#generateBtn','#refreshAccounts','#motionGalleryRefresh',
  '#addAccountBtn'];
const nodes=new Map(nodeKeys.map(key=>[key,makeElement()]));
nodes.set('#historyFilters',null);
const requested=[],uploads=[],errors=[],state={workflow:'r15',mode:'standard'};
const generated=()=>requested.push('generate');
const refreshed=()=>requested.push('refresh');
const documentQueries={
  '.nav-item':nav,'.workflow-card':workflow,'.mode-card':modes
};
const context={
  state,
  $:selector=>{
    assert.ok(nodes.has(selector),'Unexpected document.querySelector: '+selector);
    return nodes.get(selector);
  },
  $$:selector=>{
    assert.ok(Object.hasOwn(documentQueries,selector),
      'Unexpected document.querySelectorAll: '+selector);
    return [...documentQueries[selector]];
  },
  switchView:view=>requested.push(view),
  generate:generated,refreshAccounts:refreshed,
  setMedia:(kind,file)=>uploads.push({kind,file}),
  updateEstimates:()=>{},updateGenerate:()=>{},
  toast:message=>errors.push(message),
  window:{vantaMotionGallery:{refresh:async()=>{}}}
};
assert.doesNotThrow(()=>vm.runInNewContext(executable,context),
  'Whole UI bootstrap must run without NodeList/forEach runtime errors');

for(const control of [...nav,...workflow,...modes]){
  assert.equal(typeof control.onclick,'function','All selectors must get a real click handler');
}
assert.equal(nodes.get('#generateBtn').onclick,generated);
assert.equal(nodes.get('#refreshAccounts').onclick,refreshed);
nodes.get('#generateBtn').onclick();
nodes.get('#refreshAccounts').onclick();
assert.ok(requested.includes('generate')&&requested.includes('refresh'));
nav.find(x=>x.dataset.view==='image-history').onclick();
assert.ok(requested.includes('image-history'),'Image history navigation is bound');
nodes.get('#menuBtn').onclick();
assert.equal(nodes.get('#sidebar').classList.contains('open'),true);

workflow.find(x=>x.dataset.workflow==='r4Lab').onclick();
assert.equal(state.workflow,'r4Lab');
modes.find(x=>x.dataset.mode==='plus').onclick();
assert.equal(state.mode,'plus');
workflow.find(x=>x.dataset.workflow==='r15').onclick();
modes.find(x=>x.dataset.mode==='standard').onclick();
assert.equal(state.mode,'standard');
assert.equal(state.workflow,'r15');
assert.equal(workflow.filter(x=>x.classList.contains('selected')).length,1);
assert.ok(!html.includes('data-workflow="characterSwap"'));
assert.ok(!app.includes("characterSwap"));

assert.equal(typeof nodes.get('#imageDrop').listener('drop'),'function');
assert.equal(typeof nodes.get('#videoDrop').listener('drop'),'function');
assert.equal(typeof nodes.get('#referenceImage').onchange,'function');
assert.equal(typeof nodes.get('#videoReference').onchange,'function');
const sample={name:'test.png'};
nodes.get('#referenceImage').files=[sample];
nodes.get('#referenceImage').onchange();
assert.deepEqual(uploads,[{kind:'image',file:sample}]);
console.log('PASS: complete Create boot and nav, workflow/mode clicks, image+video upload, Generate, Refresh handlers work.');
