import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// UI regression: buttons, IDs and wiring must survive a visual-only redesign.
// Read actual served source files, not snapshots.
const html = fs.readFileSync(new URL('../public/ai-agent.html',import.meta.url),'utf8');
const css = fs.readFileSync(new URL('../public/ai-agent.css',import.meta.url),'utf8');
const js = fs.readFileSync(new URL('../public/ai-agent.js',import.meta.url),'utf8');
test('All Owner task, approval, activity and knowledge controls remain wired', () => {
  const ids = ['mainContent','connection','worker','supervisor','browser','execution','workspace',
    'taskForm','instruction','domain','duration','actions','tasksList','approvalsList',
    'auditList','incidentsList','discussionList','discussionForm','discussionTask',
    'discussionContent','memoryList','memoryForm','memoryOwner','memoryContent',
    'memoryEvidence','skillList','skillForm','skillOwner','skillName','skillProcedure',
    'skillEvidence','feedback','tab-tasks','tab-approvals','tab-activity','tab-knowledge'];
  for (const id of ids) assert.ok(html.includes('id="'+id+'"'), 'Missing live control: '+id);
  for (const section of ['tasks','approvals','activity','knowledge']) {
    assert.ok(html.includes('data-tab="'+section+'"'), 'Missing section: '+section);
    assert.ok(js.includes("'tab-' + tab.dataset.tab"),'Tab panel logic must remain dynamic');
  }
  assert.ok(html.includes('data-vanta-logout'),'Global Owner logout must remain');
  assert.ok(!html.includes('id="loginForm"'),'No AI Agent-only login');
  assert.ok(js.includes("request('/bridge/v1/tasks', 'POST', body)"),'New task API untouched');
  assert.ok(js.includes("request('/bridge/v1/tasks/' + task.id + '/' + op"),'Approval API untouched');
  for (const path of ['/bridge/v1/memories','/bridge/v1/skills','/bridge/v1/discussions'])
    assert.ok(js.includes(path),'Knowledge path not wired: '+path);
});
test('Mobile has no horizontally scrolling navigation or clipped controls', () => {
  assert.match(html,/<meta name="viewport"/);
  assert.match(css,/\.tabs\s*\{[^}]*display:grid/s,'Tab navigation must be a grid');
  assert.match(css,/@media\s*\(max-width:700px\)/,'Responsive mobile breakpoint missing');
  assert.match(css,/\.tabs\s*\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Mobile tabs must be 2x2');
  assert.match(css,/@media\s*\(max-width:360px\)/,'Small phone adaptation missing');
  assert.doesNotMatch(css,/\.tabs\s*\{[^}]*overflow\s*:\s*auto/s,'Tabs must not clip behind horizontal scrollbar');
  assert.match(css,/input,textarea,select\s*\{font-size:16px/,'Mobile form fields must avoid OS zoom');
  assert.match(css,/:focus-visible/,'Keyboard focus feedback required');
  assert.match(css,/prefers-reduced-motion/,'Accessible reduced-motion rule required');
  assert.ok(html.includes('class="skip-link"'),'Skip link required');
  assert.match(js,/aria-selected/,'Real tabs must expose selected state');
  assert.match(js,/ArrowRight/,'Real tabs must support keyboard arrows');
  assert.ok(!html.includes('ready_readonly'),'Raw backend names must never appear in UI');
  assert.ok(js.includes("'Siap · baca saja'"),'Read-only browser status must be localized');
});
test('UI source parses cleanly without executing user interaction', () => {
  assert.doesNotThrow(() => new vm.Script(js));
  assert.ok(!html.includes('maximum-scale=1'),'Mobile zoom must not be disabled');
});
