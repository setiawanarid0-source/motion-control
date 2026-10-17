import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canSubmitMachineMode,runningHubInstanceType} from '../runninghub-instance.js';

assert.deepEqual(['standard','plus'].filter(canSubmitMachineMode),['standard','plus']);
assert.equal(canSubmitMachineMode('lite'),false,'Lite must not be selectable for new tasks');
assert.equal(runningHubInstanceType('standard'),'default','24 GB Standard must send default');
assert.equal(runningHubInstanceType('plus'),'plus','48 GB Plus must send plus');
assert.equal(runningHubInstanceType('lite'),null,'Already queued Lite tasks retain legacy scheduling');
assert.throws(()=>runningHubInstanceType('ultra'),/tidak dikenali/);

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const queue=fs.readFileSync(new URL('../generation-queue.js',import.meta.url),'utf8');
const buttonModes=[...html.matchAll(/class="mode-card(?: selected)?" data-mode="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(buttonModes,['standard','plus'],'Only Standard and Plus buttons, in that order');
assert.ok(html.includes('Standard</strong><span>24 GB'));
assert.ok(html.includes('Plus</strong><span>48 GB'));
assert.ok(app.includes("mode: 'standard'"),'Default machine must be Standard');
assert.ok(queue.includes("mode:String(body.mode||'standard')"),'Default submitted job must be Standard');
assert.ok(server.includes('const instanceType=runningHubInstanceType(mode);'),
  'RunningHub payload must use the validated instanceType mapping');
assert.ok(server.includes('if(instanceType)payload.instanceType=instanceType;'));
assert.ok(server.includes('if(!canSubmitMachineMode(String(req.body?.mode||\'standard\')))'),
  'New upload must reject legacy Lite');
assert.ok(app.includes("fd.append('mode',state.mode)"),'Selected machine must reach request');
assert.ok(app.includes('machineLabel(x.mode)'), 'History displays actual RunningHub tier');
const stage=app.slice(app.indexOf('function stageDescription('),app.indexOf('function showSubmissionStage('));
assert.ok(stage.includes('Memulai generate…'));
for(const hidden of ['Menganalisis','Menyiapkan gerakan','Menyimpan media','Memeriksa akun']){
  assert.ok(!stage.includes(hidden),'Internal phase exposed in UI: '+hidden);
}
assert.ok(app.includes('xhr.upload.onprogress='),'Actual upload progress preserved');
assert.ok(app.includes('startPolling();'),'RunningHub task polling preserved');
assert.ok(server.includes('taskRegistry.retireAccount(account)'),'Previously approved Account Pool safety preserved');
console.log('PASS: Standard=default, Plus=plus; Lite only legacy; simple UI without exposing backend phases');
