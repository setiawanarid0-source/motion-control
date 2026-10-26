import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/ai-agent.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/ai-agent.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../public/ai-agent.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'Every Agent UI id must be unique');
for(const id of ['workspace','worker','supervisor','browser','execution','connection','taskDialog',
'taskDialogTitle','openTaskDialog','closeTaskDialog','cancelTaskDialog','taskForm','instruction',
'domain','duration','actions','tasksList','approvalsList','auditList','incidentsList',
'discussionList','memoryList','skillList','discussionTask','discussionContent','memoryOwner',
'memoryContent','memoryEvidence','skillOwner','skillName','skillProcedure','skillEvidence',
'feedback','tab-tasks','tab-approvals','tab-activity','tab-knowledge'])
 assert.ok(ids.includes(id),'Missing functional input or tab: '+id);
assert.equal((html.match(/id="taskForm"/g)||[]).length,1,'Task form must appear only in the modal');
for(const tab of ['tasks','approvals','activity','knowledge']){
  assert.ok(html.includes('aria-controls="tab-'+tab+'"'),'Navigation tab must point to a panel');
  assert.ok(html.includes('data-tab="'+tab+'"'),'Missing tab');
}
assert.ok(html.includes('<dialog id="taskDialog"'),'Task composer must be a native modal');
assert.ok(css.includes('position:fixed')&&css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),
  'Mobile navigation must use bottom 4-column dock');
assert.ok(css.includes('env(safe-area-inset-bottom'),'Bottom dock must account for phone safe area');
assert.ok(css.includes('@media(max-width:360px)'),'320px viewport must have intentional layout');
assert.ok(css.includes('font-size:16px} /* no automatic viewport zoom'),'Forms must prevent iOS focus zoom');
assert.ok(css.includes('prefers-reduced-motion:reduce'),'Respect reduced motion');
assert.ok(css.includes(':focus-visible'),'Keyboard focus must remain visible');
assert.ok(js.includes("taskDialog.showModal()")&&js.includes("taskDialog.close()"),
  'Task sheet must support opening and dismissal');
assert.ok(js.includes("setAttribute('aria-selected'"),'Tab controls must expose selected state');
assert.ok(js.includes("request('/bridge/v1/tasks'"),'Task creation API must be preserved');
assert.ok(js.includes("request('/bridge/v1/skills/'"),'Skill approval API must be preserved');
assert.ok(js.includes("request('/bridge/v1/memories'"),'Memory API must be preserved');
assert.ok(js.includes("request('/bridge/v1/discussions'"),'Discussion API must be preserved');
assert.ok(!html.includes('id="loginForm"'),'Old second login must not be reintroduced');
assert.ok(!js.includes('state.loggedIn'),'Global VANTA Owner login must remain authoritative');
console.log('PASS: VANTA Agent mobile-first structure, 4 accessible tabs, task sheet, responsive 320px styles and all original API IDs.');
