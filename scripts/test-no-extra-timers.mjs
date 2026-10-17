import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
for(const text of ['Generate time','Generation time','id="taskElapsed"','id="resultDuration"']){
  assert.ok(!html.includes(text),'Unrequested timing field still in HTML: '+text);
  assert.ok(!app.includes(text),'Unrequested timing field still in app logic: '+text);
}
assert.ok(html.includes('id="taskEstimate"'),'Actual upload progress must remain visible');
assert.ok(app.includes("xhr.upload.onprogress"),'Upload progress logic must be preserved');
assert.ok(app.includes("percent+'% terkirim'"),'Real upload percent must remain visible');
assert.ok(app.includes("completedSubmission(data)"),'Accepted task routing must remain intact');
assert.ok(app.includes("startPolling()"),'Accepted RunningHub tasks must still be monitored');
assert.ok(html.includes('<th>Video</th><th>Status</th>'),'History must no longer show duration column');
assert.ok(app.includes('colspan="7"'),'History empty row must match seven columns');
console.log('PASS: timer UI removed without changing upload progress, task submission, or History polling');
