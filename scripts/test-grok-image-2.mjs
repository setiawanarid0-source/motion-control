import assert from 'node:assert/strict';
import fs from 'node:fs';
import {KIE_MODELS,buildKieInput} from '../kie-studio.js';

const model=KIE_MODELS.find(m=>m.id==='grok2');
assert.ok(model,'Grok Image 2.0 must be available from /api/kie/models');
assert.equal(model.name,'Grok Image 2.0');
assert.equal(model.create,'grok-imagine-image-2-0/text-to-image');
assert.equal(model.edit,'grok-imagine-image-2-0/image-edit');
assert.equal(model.images,'image_urls');
assert.equal(model.aspect,'aspect_ratio');
assert.deepEqual(model.aspectRatios,['1:1','2:3','3:2','16:9','9:16']);
assert.equal(model.resolution,undefined,'Grok Image 2.0 does not accept invented resolution field');
assert.deepEqual(buildKieInput(model,'create',{prompt:'Photograph of a lighthouse',aspect:'9:16',resolution:'1K'}),{
  prompt:'Photograph of a lighthouse',aspect_ratio:'9:16'
});
assert.deepEqual(buildKieInput(model,'edit',{prompt:'Preserve the face, change background',aspect:'2:3',resolution:'4K',
  urls:['https://example.com/a.png','https://example.com/b.png']}),{
  prompt:'Preserve the face, change background',aspect_ratio:'2:3',
  image_urls:['https://example.com/a.png','https://example.com/b.png']
});
for(const ratio of ['auto','4:3','3:4','21:9']){
 assert.throws(()=>buildKieInput(model,'create',{prompt:'hello',aspect:ratio,resolution:'1K'}),/Aspect ratio/);
}
assert.throws(()=>buildKieInput(model,'edit',{prompt:'hello',aspect:'1:1',urls:[]}),/1–2/);
assert.equal(KIE_MODELS.length,9,'Existing eight models must remain available');
assert.equal(new Set(KIE_MODELS.map(m=>m.id)).size,9);

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const checks=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.ok(ui.includes('m.aspectRatios')&&ui.includes('m.aspectRatios.includes(oldRatio)'),
 'UI should hide ratios Grok 2.0 does not support');
assert.ok(ui.includes('data-image-mode')&&ui.includes('selectedRefs'),
 'Create/Edit tabs and uploaded references must still work');
assert.ok(html.includes('/kie-ui.js?v=20261023-grok2-v1'),
 'Bust stale image selector in mobile browsers');
assert.ok(!html.includes('characterSwap')&&!server.includes('characterSwap')&&!app.includes('characterSwap'));
assert.ok(!server.includes('RUNNINGHUB_H3_WORKFLOW_ID'));
assert.ok(!checks.scripts.check.includes('test-character-swap'));
assert.ok(!checks.scripts.check.includes('test-h3-provider-validation'));
for(const p of ['character-swap.js','workflows/minimax-h3-character-swap-v1.1-api.json']){
 assert.ok(!fs.existsSync(new URL('../'+p,import.meta.url)),'H3 workflow must be removed: '+p);
}
assert.ok(server.includes("app.use('/api/kie',createKieStudio"),'Kie image backend intact');
console.log('PASS: Grok Image 2.0 create/edit API contracts, five aspect ratios, nine models, discontinued H3 removed.');
