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
    dataset,disabled:false,value:'',files:[],style:{},classList:{
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
const workflow=['rife60','motionflyHD','current','minimaxH3','minimaxH3Akatz','minimaxH3AkatzV3']
  .map(id=>makeElement({workflow:id}));
const modes=['standard','plus'].map(mode=>makeElement({mode}));
for(const key of ['create','image-create','history','image-history','accounts','kie-accounts']){
  assert.ok(html.includes('data-view="'+key+'"'),'Nav route must exist: '+key);
}
for(const key of workflow.map(x=>x.dataset.workflow)){
  assert.ok(html.includes('data-workflow="'+key+'"'),'Workflow option must exist: '+key);
}
for(const key of ['r15','koh1AntiObject','r4Lab'])assert.ok(!html.includes('data-workflow="'+key+'"'),'Retired R4 card must be removed');
const nodeKeys=['#menuBtn','#sidebar','#rifeNotice','#h3Notice','#akatzNotice','#mediaRequirements',
  '#akatzExpression','#akatzExpressionStatus',
  '#imageDrop','#referenceImage','#videoDrop',
  '#videoReference','#generateBtn','#refreshAccounts','#motionGalleryRefresh',
  '#rhWebSessionPanel',
  '#copyRhSessionCode','#selectRhSessionCode','#copyRhBookmarkTestCode','#rhSessionCodeManual','#connectRhWebSession','#rhWebSessionInput'];
const nodes=new Map(nodeKeys.map(key=>[key,makeElement()]));
nodes.get('#akatzExpression').value='controlnet';
nodes.set('#historyFilters',null);
const requested=[],uploads=[],errors=[],state={workflow:'motionflyHD',mode:'standard',akatzExpression:true};
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
  restoreRecentRifeFailure:()=>{},
  setMedia:(kind,file)=>uploads.push({kind,file}),
  updateEstimates:()=>{},updateGenerate:()=>{},
  toast:message=>errors.push(message),
  api:async(url,options)=>{requested.push({url,options});return {updated:true};},
  loadSession:async()=>requested.push('reload-session'),
  window:{vantaMotionGallery:{refresh:async()=>{}}}
};
assert.doesNotThrow(()=>vm.runInNewContext(executable,context),
  'Whole UI bootstrap must run without NodeList/forEach runtime errors');

for(const control of [...nav,...workflow,...modes]){
  assert.equal(typeof control.onclick,'function','All selectors must get a real click handler');
}
assert.equal(nodes.get('#generateBtn').onclick,generated);
assert.equal(nodes.get('#refreshAccounts').onclick,refreshed);
assert.ok(!html.includes('id="rhApiKeyPanel"'));
assert.ok(!html.includes('id="apiKeyInput"'));
nodes.get('#rhWebSessionInput').value='javascript:not-json';
await nodes.get('#connectRhWebSession').listener('click')();
assert.equal(requested.filter(x=>x?.url==='/api/runninghub/access-token').length,0);
nodes.get('#rhWebSessionInput').value='{"site":"runninghub.ai","access":"fixture-access"}';
await nodes.get('#connectRhWebSession').listener('click')();
assert.equal(requested.filter(x=>x?.url==='/api/runninghub/access-token').length,1);
assert.equal(nodes.get('#rhWebSessionInput').value,'','Imported session is cleared from the form');
assert.equal(nodes.get('#connectRhWebSession').disabled,false);
assert.ok(requested.includes('reload-session'));
nodes.get('#generateBtn').onclick();
nodes.get('#refreshAccounts').onclick();
assert.ok(requested.includes('generate')&&requested.includes('refresh'));
nav.find(x=>x.dataset.view==='image-history').onclick();
assert.ok(requested.includes('image-history'),'Image history navigation is bound');
nodes.get('#menuBtn').onclick();
assert.equal(nodes.get('#sidebar').classList.contains('open'),true);

workflow.find(x=>x.dataset.workflow==='rife60').onclick();
assert.equal(nodes.get('#imageDrop').classList.contains('hidden'),true,'RIFE must hide unused image input');
assert.equal(nodes.get('#rifeNotice').classList.contains('hidden'),false);
workflow.find(x=>x.dataset.workflow==='minimaxH3').onclick();
assert.equal(state.workflow,'minimaxH3');
assert.equal(nodes.get('#imageDrop').classList.contains('hidden'),false,'H3 needs the character image');
assert.equal(nodes.get('#h3Notice').classList.contains('hidden'),false);
assert.equal(nodes.get('#rifeNotice').classList.contains('hidden'),true);
workflow.find(x=>x.dataset.workflow==='minimaxH3Akatz').onclick();
assert.equal(state.workflow,'minimaxH3Akatz');
assert.equal(state.mode,'plus','Akatz requires the Plus instance');
assert.equal(modes.find(x=>x.dataset.mode==='standard').disabled,true);
assert.equal(nodes.get('#imageDrop').classList.contains('hidden'),false);
assert.equal(nodes.get('#akatzNotice').classList.contains('hidden'),false);
assert.equal(nodes.get('#h3Notice').classList.contains('hidden'),true);
assert.equal(state.akatzFaceControl,true,'New Akatz selection defaults to the ControlNet candidate');
nodes.get('#akatzExpression').value='baseline';
nodes.get('#akatzExpression').listener('change')({target:{value:'baseline'}});
assert.equal(state.akatzExpression,false,'Previous-version choice must disable the candidate');
assert.equal(state.akatzFaceControl,false);
assert.match(nodes.get('#akatzExpressionStatus').textContent,/Versi dasar Akatz aktif/);
nodes.get('#akatzExpression').value='expression';
nodes.get('#akatzExpression').listener('change')({target:{value:'expression'}});
assert.equal(state.akatzExpression,true,'The expression candidate must be selectable again');
assert.equal(state.akatzFaceControl,false,'Previous expression version must not acquire a ControlNet patch');
assert.match(nodes.get('#akatzExpressionStatus').textContent,/Uji mimik sebelumnya aktif/);
nodes.get('#akatzExpression').value='controlnet';
nodes.get('#akatzExpression').listener('change')();
assert.equal(state.akatzFaceControl,true);
assert.equal(state.akatzExpression,true);
assert.match(nodes.get('#akatzExpressionStatus').textContent,/ControlNet wajah aktif/);
workflow.find(x=>x.dataset.workflow==='motionflyHD').onclick();
assert.equal(nodes.get('#h3Notice').classList.contains('hidden'),true,'H3 help must not leak into old workflows');
assert.equal(nodes.get('#akatzNotice').classList.contains('hidden'),true,'Akatz help is scoped to its own option');
assert.equal(modes.find(x=>x.dataset.mode==='standard').disabled,false);
assert.equal(nodes.get('#imageDrop').classList.contains('hidden'),false,'Other motion modes need image input');
assert.equal(state.workflow,'motionflyHD');
modes.find(x=>x.dataset.mode==='plus').onclick();
assert.equal(state.mode,'plus');
workflow.find(x=>x.dataset.workflow==='current').onclick();
modes.find(x=>x.dataset.mode==='standard').onclick();
assert.equal(state.mode,'standard');
assert.equal(state.workflow,'current');
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
// The replacement is a complete workflow: a fresh photo/video pair and a ready
// token account must enable Generate without any diagnostic task in History.
state.workflow='motionflyHD';state.image=sample;state.video={name:'test.mp4'};
state.accounts=[{canGenerate:true}];state.submission=null;
const readiness=app.slice(app.indexOf('function updateGenerate(){'),app.indexOf('function workflowName(){'));
vm.runInNewContext(readiness+'\nupdateGenerate();',context);
assert.equal(nodes.get('#generateBtn').disabled,false);
state.image=null;context.updateGenerate();
assert.equal(nodes.get('#generateBtn').disabled,true,'MotionFly must require its photo input');
state.image=sample;state.submission={jobId:'uploading'};context.updateGenerate();
assert.equal(nodes.get('#generateBtn').disabled,true,'Prevent duplicate uploads during submission');
console.log('PASS: complete Create boot and nav, workflow/mode clicks, image+video upload, Generate, Refresh handlers work.');
