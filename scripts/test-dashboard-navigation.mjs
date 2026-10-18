// Execute the REAL dashboard switchView handler with click events, not just
// check that the markup exists. Catches treating querySelector as NodeList.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const start=js.indexOf('function switchView(view){');
const end=js.indexOf('\nasync function api(',start);
assert.ok(start!==-1&&end>start,'Real switchView handler must exist');
const source=js.slice(start,end);
const labels=['create','image-create','history','image-history','accounts','kie-accounts'];
const makeClassList=()=>{const items=new Set();return {
  add:(x)=>items.add(x),remove:(x)=>items.delete(x),contains:(x)=>items.has(x),
  toggle:(x,val)=>{const on=val===undefined?!items.has(x):Boolean(val);
    if(on)items.add(x);else items.delete(x);return on;}
};};
const makeEl=(id,view)=>({id,textContent:'',dataset:view?{view}:{},classList:makeClassList(),
  attributes:{},setAttribute(k,v){this.attributes[k]=v;},querySelector(){return {setAttribute(){}}}});
const views=labels.map(x=>makeEl('view-'+x));
const navItems=labels.map(x=>makeEl('menu-'+x,x));
const groups=['create','history','accounts'].map(x=>({...makeEl('group-'+x),dataset:{group:x}}));
const nodes=new Map([...views,...navItems,...groups].map(x=>[x.id,x]));
for(const id of ['pageTitle','sidebar','sidebarOverlay'])nodes.set(id,makeEl(id));
const body=makeEl('body');
const document={
  body,getElementById(id){return nodes.get(id)||null;},
  querySelector(selector){return selector.startsWith('#')?nodes.get(selector.slice(1)):null;},
  querySelectorAll(selector){
    return ({'.view':views,'.nav-item':navItems,'.nav-group':groups})[selector]||[];
  }
};
const visited=[],state={view:'create'};
const ctx={document,state,window:{vantaKieNavigation:(view)=>visited.push(view)},
  $:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)],
  renderHistory(){},refreshAccounts(){}};
vm.runInNewContext(source+'\n$$(".nav-item").forEach(b=>b.onclick=()=>switchView(b.dataset.view));',ctx);
for(const view of labels){
  const clicked=navItems.find(x=>x.dataset.view===view);
  assert.equal(typeof clicked.onclick,'function','Nav click must be bound: '+view);
  assert.doesNotThrow(()=>clicked.onclick(),'Nav click crashed: '+view);
  assert.equal(state.view,view,'Wrong route on '+view);
  assert.deepEqual(views.filter(x=>x.classList.contains('active')).map(x=>x.id),
    ['view-'+view],'Exactly one page must be visible: '+view);
  assert.deepEqual(navItems.filter(x=>x.classList.contains('active')).map(x=>x.dataset.view),
    [view],'Exactly one submenu must be active: '+view);
  const parent=['create','image-create'].includes(view)?'create':
    ['history','image-history'].includes(view)?'history':'accounts';
  assert.equal(groups.find(x=>x.dataset.group===parent).classList.contains('expanded'),true,
    'Parent submenu must expand for '+view);
  assert.equal(nodes.get('sidebar').classList.contains('open'),false);
  assert.ok(html.includes('id="view-'+view+'"'),'Route must point to real page');
  assert.ok(html.includes('data-view="'+view+'"'),'Menu must exist');
}
assert.deepEqual(visited,labels,'kie.ai view bridge must run for all routed pages');
assert.equal(nodes.get('pageTitle').textContent,'kie.ai Pool');
assert.doesNotThrow(()=>ctx.switchView('not-a-page'),'Unknown routes must be ignored');
console.log('PASS: six actual sidebar clicks render the correct page, submenu, and provider; no querySelector.forEach crash');
