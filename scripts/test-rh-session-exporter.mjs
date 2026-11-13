import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseRunningHubSession} from '../runninghub-web-session.js';
import {buildRunningHubUserscript} from './build-rh-session-userscript.mjs';
const source=fs.readFileSync(new URL('../public/rh-session.js',import.meta.url),'utf8');
const userscript=fs.readFileSync(new URL('../public/vanta-runninghub-session.user.js',import.meta.url),'utf8');
const access='fixture-access-token-browser',refresh='fixture-rotated-refresh-token';
function fixture({blockedLocal=false,blockedCookie=false,missingBody=false,domFailure=false,clipboard,legacy=false,hostname='www.runninghub.ai',protocol='https:'}={}){
  const nodes=[],alerts=[],prompts=[],reads=[],legacyCalls=[];
  let cookieReads=0;
  function find(node,match){if(match(node))return node;for(const child of node.children||[]){const found=find(child,match);if(found)return found;}return null;}
  function element(tag){
    const node={tag,style:{},children:[],attributes:{},value:'',
      appendChild(child){this.children.push(child);child.parentNode=this;},
      removeChild(child){this.children=this.children.filter(x=>x!==child);child.parentNode=null;},
      setAttribute(k,v){this.attributes[k]=v;},
      querySelector(selector){return find(this,n=>selector==='textarea'?n.tag==='textarea':Object.hasOwn(n.attributes||{},'data-vanta-close'));},
      focus(){},select(){this.selectionStart=0;this.selectionEnd=this.value.length;},
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
      click(){this.onclick?.({target:this});}};
    nodes.push(node);return node;
  }
  const root=element('html'),body=element('body');if(!missingBody)root.appendChild(body);
  const values={'Rh-Accesstoken':access,'Rh-Refreshtoken':refresh,'Rh-Identify':'fixture-identify',
    'Rh-Comfy-Auth':'fixture-comfy-auth','private-other-data':'never-export-this'};
  const storage={getItem(name){reads.push(name);return values[name]||'';}};
  const document={body:missingBody?null:body,documentElement:root,
    getElementById:id=>find(root,n=>n.id===id),
    createElement:tag=>{if(domFailure)throw Error('DOM blocked');return element(tag);},
    execCommand:name=>{legacyCalls.push(name);return legacy;}};
  Object.defineProperty(document,'cookie',{get(){cookieReads++;if(blockedCookie)throw Error('Cookies blocked');
    return 'Rh-Accesstoken='+access+'; Rh-Refreshtoken=fixture-stale-cookie; private=never-export-this';}});
  const context={document,location:{hostname,protocol},navigator:{clipboard},alert:m=>alerts.push(m),prompt:(m,value)=>prompts.push(value)};
  context.window=context;context.top=context;context.self=context;context.sessionStorage=storage;
  Object.defineProperty(context,'localStorage',{get(){if(blockedLocal)throw Error('Storage getter denied');return storage;}});
  vm.createContext(context);vm.runInContext(source,context);
  const code=context.vantaRunningHubSessionCode;
  const run=()=>vm.runInContext(decodeURIComponent(code.slice('javascript:'.length)),context);
  return {context,document,code,run,nodes,alerts,prompts,reads,legacyCalls,cookieReads:()=>cookieReads,
    field:()=>find(root,n=>n.tag==='textarea'),
    button:text=>find(root,n=>n.tag==='button'&&n.textContent===text),
    status:()=>find(root,n=>n.attributes?.role==='status')};
}
test('bookmark URL is encoded, single-line, does not navigate and exports only the intended fields',()=>{
  const f=fixture();assert.equal(f.run(),undefined);
  assert.ok(f.code.startsWith('javascript:'));assert.ok(!/[\s#?]/.test(f.code));
  const decoded=decodeURIComponent(f.code.slice(11));
  assert.doesNotMatch(decoded,/\b(?:const|let|async|await)\b|=>|\?\./,'Exported code stays within older browser syntax');
  assert.doesNotMatch(decoded,/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|window\.open/);
  const data=JSON.parse(f.field().value);assert.equal(data.access,access);assert.equal(data.refresh,refresh);
  assert.equal(parseRunningHubSession(data).refresh,refresh);
  assert.deepEqual(Object.keys(data).sort(),['site','access','refresh','identify','comfyAuth'].sort());
  assert.ok(!f.field().value.includes('never-export-this'));assert.deepEqual(f.alerts,[]);
  assert.ok(f.reads.every(x=>['Rh-Accesstoken','Rh-Refreshtoken','Rh-Identify','Rh-Comfy-Auth'].includes(x)));
});
test('storage property denial, cookie denial and a missing body still show the token popup',()=>{
  for(const options of [{blockedLocal:true},{blockedCookie:true},{missingBody:true}]){
    const f=fixture(options);f.run();assert.equal(JSON.parse(f.field().value).access,access);
    assert.deepEqual(f.alerts,[]);
  }
});
test('absent or rejected clipboard keeps manual selection usable; classic copy remains supported',async()=>{
  for(const options of [{},{clipboard:{writeText:()=>Promise.reject(Error('Permission denied'))}}]){
    const f=fixture(options);f.run();f.button('Salin token').click();await new Promise(r=>setImmediate(r));
    assert.match(f.status().textContent,/Tekan dan tahan/);
    f.button('Pilih semua').click();assert.equal(f.field().selectionEnd,f.field().value.length);
    assert.equal(f.field().selectionStart,0);assert.deepEqual(f.alerts,[]);
  }
  const legacy=fixture({legacy:true});legacy.run();legacy.button('Salin token').click();
  assert.equal(legacy.button('Tersalin!').textContent,'Tersalin!');
  const copied=[],modern=fixture({clipboard:{writeText:value=>{copied.push(value);return Promise.resolve();}}});
  modern.run();modern.button('Salin token').click();await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(copied[0]).access,access);assert.equal(modern.legacyCalls.length,0);
});
test('close and repeated execution clear old payloads and ignore late clipboard rejection',async()=>{
  let reject;
  const f=fixture({clipboard:{writeText:()=>new Promise((_,r)=>{reject=r;})}});
  f.run();const previous=f.field();f.button('Salin token').click();f.run();
  assert.equal(previous.value,'');reject(Error('late permission denial'));await new Promise(r=>setImmediate(r));
  assert.equal(f.legacyCalls.length,0,'A dismissed popup must not overwrite the clipboard with empty data');
  const current=f.field();f.button('Tutup').click();assert.equal(current.value,'');assert.equal(f.field(),null);
});
test('DOM failure offers a local prompt and an unrelated site never reads credentials',()=>{
  const failed=fixture({domFailure:true});failed.run();assert.equal(failed.prompts.length,1);
  assert.equal(JSON.parse(failed.prompts[0]).access,access);
  const denied=fixture({hostname:'runninghub.ai.attacker.example'});denied.run();
  assert.equal(denied.field(),null);assert.equal(denied.reads.length,0);assert.equal(denied.alerts.length,1);
});
test('Vanta offers a visible manual code field when clipboard access fails',async()=>{
  const f=fixture();const help={open:false},field={value:'',focus(){},select(){},setSelectionRange(a,b){this.selected=b-a;}};
  f.document.getElementById=id=>id==='rhSessionBrowserHelp'?help:id==='rhSessionCodeManual'?field:null;
  assert.equal(await f.context.vantaCopyRunningHubCode(),false);assert.equal(help.open,true);
  assert.equal(field.value,f.code);assert.equal(field.selected,f.code.length);
  field.value='';f.context.vantaSelectRunningHubCode();assert.equal(field.value,f.code);
});
test('userscript is generated from the canonical exporter, scoped to RH and has no network or update dependency',()=>{
  assert.equal(userscript,buildRunningHubUserscript(),'Regenerate the userscript after changing the exporter');
  const matches=[...userscript.matchAll(/^\/\/ @match\s+(.+)$/gm)].map(m=>m[1]);
  assert.deepEqual(matches,['https://www.runninghub.ai/*','https://runninghub.ai/*']);
  assert.match(userscript,/^\/\/ @sandbox\s+DOM$/m);assert.match(userscript,/^\/\/ @noframes$/m);
  assert.match(userscript,/^\/\/ @downloadURL\s+none$/m);
  assert.doesNotMatch(userscript,/^\/\/ @(?:grant|require|resource|connect|updateURL)\s/m);
  assert.doesNotMatch(userscript,/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|window\.open|\.setItem\(|GM_/);
});
test('extension launcher reads no session until tapped; it exports rotated refresh token and can reopen safely',()=>{
  const f=fixture();vm.runInContext(userscript,f.context);
  assert.equal(f.reads.length,0);assert.equal(f.cookieReads(),0);assert.equal(f.field(),null);
  const launcher=f.document.getElementById('vanta-rh-session-launcher');assert.ok(launcher);
  vm.runInContext(userscript,f.context);
  assert.equal(f.nodes.filter(n=>n.id==='vanta-rh-session-launcher').length,1);
  launcher.click();const first=f.field(),data=JSON.parse(first.value);
  assert.equal(data.access,access);assert.equal(data.refresh,refresh);
  assert.equal(parseRunningHubSession(data).access,access);
  f.button('Tutup').click();assert.equal(first.value,'');assert.equal(f.field(),null);
  launcher.click();assert.equal(JSON.parse(f.field().value).refresh,refresh);
});
test('userscript refuses lookalike domains, insecure pages and subframes before reading session data',()=>{
  for(const options of [{hostname:'runninghub.ai.attacker.example'},{protocol:'http:'},{frame:true}]){
    const f=fixture(options);if(options.frame)f.context.top={};vm.runInContext(userscript,f.context);
    assert.equal(f.document.getElementById('vanta-rh-session-launcher'),null);
    assert.equal(f.reads.length,0);assert.equal(f.cookieReads(),0);
  }
});
