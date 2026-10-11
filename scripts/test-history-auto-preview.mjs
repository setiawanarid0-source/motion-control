import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
for(const id of ['historyPreviewVideo','historyPreviewImage','historyPreviewSourceVideo','historyPreviewLegacyNotice']){
  assert.ok(html.includes('id="'+id+'"'),id+' missing from History detail');
}
for(const text of ['Tambahkan gambar referensi','Tambahkan video referensi','historyPreviewImageAttach',
                   'historyPreviewVideoAttach','historyPreviewImageInput','historyPreviewVideoInput']){
  assert.ok(!html.includes(text),'Manual re-upload element still present: '+text);
  assert.ok(!app.includes(text),'Manual re-upload handler still present: '+text);
}
assert.ok(!server.includes("app.post('/api/task-references/:taskId/:kind'"),
  'Manual reference upload endpoint unexpectedly available');
assert.ok(server.indexOf('stagedReferences=await stageReferences(imageFile,videoFile)')<
  server.indexOf('const task = await createTask('),'References must be staged before paid RunningHub creation');
assert.ok(server.includes('await commitReferences(stagedReferences,String(task.taskId))'));
assert.ok(app.includes('referenceLink(taskId,entry.kind,accountId)'));
console.log('PASS: History preview uses automatic saved references and has no manual upload flow');
