// Visual-only contract: verify the Nora skill polish cannot disconnect VANTA UI actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const polish=fs.readFileSync(new URL('../public/vanta-polish.css',import.meta.url),'utf8');
const base=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const kie=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const motion=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

const link=(url)=>html.indexOf(url);
assert.ok(link('styles.css?v=')>=0);
assert.ok(link('vanta-polish.css?v=')>link('styles.css?v='),
  'Presentation-only stylesheet must be loaded after the existing functional CSS');
assert.ok(link('app.js?v=')>link('vanta-polish.css'), 'Styles must not move application scripts');
assert.ok(link('kie-ui.js?v=')>link('app.js?v='), 'kie.ai UI still loads after the app');
for(const id of ['sidebar','menuBtn','sidebarClose','sidebarOverlay','view-create',
  'view-image-create','view-history','view-image-history','view-accounts','view-kie-accounts',
  'kieRefreshAccounts','kieAddAccount','kieKeyInput','kieAccountList','kieModel',
  'kieRefs','kieGenerateBtn','historyBody','accountList','addAccountBtn','refreshAccounts']){
  assert.ok(html.includes('id="'+id+'"'),'Critical existing UI ID is missing: '+id);
}
for(const view of ['create','image-create','history','image-history','accounts','kie-accounts']){
  assert.ok(html.includes('data-view="'+view+'"'),'Menu removed: '+view);
  assert.ok(html.includes('id="view-'+view+'"'),'Routed page removed: '+view);
}
assert.ok(kie.includes("data-kie-remove"),'kie account removal action must remain wired');
assert.ok(kie.includes("el('kieRefreshAccounts').onclick=refreshAccounts"),'kie refresh must remain');
assert.ok(kie.includes("el('kieGenerateBtn').onclick=submitImage"),'kie generation unchanged');
assert.ok(motion.includes("$('#generateBtn').onclick=generate"),'RunningHub generation preserved');
assert.ok(server.includes("app.use('/api/kie',createKieStudio"),'kie endpoints untouched');
assert.ok(server.includes("const workflowGraphs ="),'RunningHub workflow loader untouched');
for(const s of ['#view-kie-accounts .account-card',
  '#view-kie-accounts .account-card .delete-account',
  '#view-kie-accounts .refresh-account-btn',
  '.vanta-nav .nav-item.active','.image-mode-tab',
  '.kie-history-info','.account-list','.account-layout',
  'button:focus-visible','@media(max-width:780px)'])
  assert.ok(polish.includes(s),'Nora skill style missing: '+s);
assert.ok(/#view-kie-accounts \.account-card \.delete-account\s*\{[^}]*width:auto/s.test(polish),
  'Account Remove text must fit inside its button, not overflow the 48px RunningHub mobile icon control');
assert.ok(/@media\(max-width:780px\)[\s\S]*?#view-kie-accounts \.account-card \.delete-account\s*\{[^}]*width:auto/.test(polish),
  'Mobile account Remove button must preserve its full text width');
assert.ok(polish.includes('font-size:16px'),'Inputs must avoid Safari mobile zoom');
assert.ok(polish.includes('min-height:44px'),'Touch targets must be sufficient');
assert.ok(polish.includes('@media(prefers-reduced-motion:reduce)'),'Respect reduced motion');
assert.ok(base.includes('.sidebar.open{transform:translateX(0)}'),
  'Keep swipe drawer behavior from original CSS');
const clean=polish.replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/"(?:\\.|[^"\\])*"/g,'""').replace(/'(?:\\.|[^'\\])*'/g,"''");
assert.equal((clean.match(/\{/g)||[]).length,(clean.match(/\}/g)||[]).length,'Unbalanced CSS rule blocks');
console.log('PASS: Nora visual-only UI polish, mobile account actions, six routes, API and task wiring intact');
