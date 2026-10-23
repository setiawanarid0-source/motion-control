import assert from 'node:assert/strict';
import fs from 'node:fs';
import {KIE_MODELS,buildKieInput} from '../kie-studio.js';
assert.equal(KIE_MODELS.length,9,'Nine selected image models');
assert.equal(new Set(KIE_MODELS.map(x=>x.id)).size,9,'No duplicated models');
for(const m of KIE_MODELS){
  assert.ok(m.create&&m.edit,'Model needs valid separate or combined Create/Edit API IDs');
  const aspect=m.aspect?'1:1':'1:1',res=m.resolutions[0]||'1K';
  const made=buildKieInput(m,'create',{prompt:'A natural portrait',aspect,resolution:res});
  assert.equal(made.prompt,'A natural portrait');
  const changed=buildKieInput(m,'edit',{prompt:'Edit only the background',aspect,resolution:res,
    urls:['https://example.com/first.png','https://example.com/second.png']});
  assert.equal(changed[m.images].length,2,'Edit must accept both reference images');
  assert.throws(()=>buildKieInput(m,'edit',{prompt:'Edit',aspect,resolution:res,
    urls:['a','b','c']}),/1–2|dua/,'Strictly limit reference images to 2');
  assert.throws(()=>buildKieInput(m,'edit',{prompt:'Edit',aspect,resolution:res,urls:[]}));
  assert.throws(()=>buildKieInput(m,'create',{prompt:'Edit',aspect,resolution:res,urls:['one']}));
}
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const image=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
for(const id of ['view-create','view-image-create','view-history','view-image-history','view-accounts','view-kie-accounts',
  'kieRefs','kieRefsWrap','kieAccountSelect','kieHistoryGrid','sidebarOverlay','menuBtn'])
  assert.ok(html.includes('id="'+id+'"'),'Missing dashboard component '+id);
assert.ok(html.includes('id="kieRefs" type="file"')&&html.includes('multiple hidden'),'Edit has max-two multi-reference upload');
assert.ok(html.includes('kie-ui.js?v=')&&html.includes('styles.css?v=20261018'),'Versioned user UI');
assert.ok(app.includes("'image-create':'Image Generation'")&&app.includes("if(view==='history')renderHistory()"),
  'Image routing cannot break existing RunningHub History');
assert.ok(image.includes('files.length>2')&&image.includes("data-image-mode"),'Two-reference guard and Create/Edit modes');
assert.ok(image.includes('data-nav-group')&&image.includes('touchend'),'Expandable sidebar and swipe drawer');
assert.ok(css.includes('.sidebar.open{transform:translateX(0)}'),'Mobile sidebar must slide in');
assert.ok(server.includes("app.use('/api/kie',createKieStudio"),'Separate provider routes');
assert.ok(server.includes("const workflowGraphs ="),'Existing RunningHub workflow loader retained');
const provider=fs.readFileSync(new URL('../kie-studio.js',import.meta.url),'utf8');
assert.ok(provider.includes("'accounts.enc'")&&provider.includes("'tasks.enc'"),'Isolated encrypted kie pool and tasks');
assert.ok(provider.includes('GET')===false||provider.includes('/api/v1/jobs/recordInfo'),'Status source is kie.ai');
assert.ok(provider.includes("if(submitted&&!accepted)"),'No automatic paid-task retry after uncertain acknowledgement');
console.log('PASS: 9 kie.ai models, 1–2 image references, separate encrypted Account Pool/History, responsive expandable sidebar, existing motion workflow untouched');
