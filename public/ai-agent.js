const $ = id => document.getElementById(id);
const state = { busy: false, tasks: [], workerReady: false };
const label = status => ({
  awaiting_approval: 'Menunggu persetujuan',
  approved_pending_worker: 'Disetujui · siap dijalankan',
  running_worker: 'Otak 2 sedang bekerja', completed: 'Selesai', failed: 'Gagal · perlu ditinjau',
  rejected: 'Ditolak', cancelled: 'Dibatalkan', paused: 'Dijeda'
}[status] || status);
function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
}
function entry(container, title, description, subtitle) {
  const div = el('div', undefined, 'entry');
  div.append(el('strong', title), el('p', description || ''), el('small', subtitle || ''));
  container.append(div);
  return div;
}
function empty(container, message) {
  const wrap = el('div', undefined, 'empty-state');
  const icon = el('span', '✦', 'empty-icon'); icon.setAttribute('aria-hidden', 'true');
  const title = el('strong', message);
  const subtitle = el('p', message.includes('tugas') ? 'Mulai dengan membuat tugas, lalu tinjau persetujuannya di sini.' : 'Aktivitas akan tampil setelah tersedia.');
  wrap.append(icon, title, subtitle);
  container.replaceChildren(wrap);
}
function say(message, error = false) {
  const target = $('feedback');
  if (target) { target.textContent = message; target.style.color = error ? '#ffadad' : '#abcef0'; }
}
async function request(path, method = 'GET', body = undefined) {
  const res = await fetch('/api/agent' + path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Vanta-Agent': '1' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch { /* no secrets in response */ }
  if (!res.ok) {
    const e = new Error(data.error || 'HTTP ' + res.status);
    e.status = res.status; throw e;
  }
  return data;
}
function taskCard(target, task, approvalOnly = false) {
  const div = entry(target, label(task.status), task.instruction,
    [new Date(task.createdAt).toLocaleString('id-ID'),
      (task.scope?.domains || []).join(', '), 'Budget $' + (task.scope?.budgetUsd ?? 0)].join(' · '));
  if(task.workerRun?.skillIds?.length){
    div.append(el('small','SOP terverifikasi tersedia: '+task.workerRun.skillIds.length+' · Eksekusi tercatat: '+(task.workerRun.skillAttempts?.length||0)));
  }
  if (task.workerRun?.summary) {
    const outcome=el('div',undefined,'inspection-result');
    outcome.append(el('strong','Laporan Otak 2'),
      el('p',String(task.workerRun.summary).slice(0,800)),
      el('small','Langkah: '+(task.workerRun.steps??0)+' · '+(task.workerRun.finishedAt
        ? new Date(task.workerRun.finishedAt).toLocaleString('id-ID') : 'Sedang diproses')));
    div.append(outcome);
  }
  // Display saved read-only browser evidence on the task card after page refresh.
  const checkpoint = (task.checkpoints || []).slice().reverse().find(item => {
    try { const evidence = JSON.parse(item.description); return evidence?.readOnly === true && !!evidence.finishedAt; }
    catch { return false; }
  });
  if (checkpoint) {
    try {
      const evidence = JSON.parse(checkpoint.description);
      const summary = el('div', undefined, 'inspection-result');
      summary.append(
        el('strong', 'Hasil inspeksi browser'),
        el('p', [typeof evidence.title === 'string' ? evidence.title.slice(0,180) : '',
          'HTTP ' + (Number.isInteger(evidence.status) ? evidence.status : '—'),
          evidence.mode === 'persistent' ? 'Sesi tersimpan' : 'Sesi terisolasi'
        ].filter(Boolean).join(' · ')),
        el('small', 'Hanya baca · ' + new Date(evidence.finishedAt).toLocaleString('id-ID'))
      );
      div.append(summary);
    } catch { /* Do not render invalid checkpoint evidence */ }
  }
    if (['awaiting_approval', 'approved_pending_worker', 'running_worker', 'paused'].includes(task.status)) {
    const actions = el('div', undefined, 'entry-actions');
    let options = task.status === 'awaiting_approval' ? [['approve','Setujui'],['reject','Tolak']] :
      task.status === 'paused' ? [['resume','Lanjutkan'],['cancel','Batalkan']] : [['pause','Jeda'],['cancel','Batalkan']];
    for (const [op, title] of options) {
      const button = el('button', title, op === 'approve' ? '' : 'secondary');
      button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        try {
          await request('/bridge/v1/tasks/' + task.id + '/' + op, 'POST', {});
          say('Status tugas berhasil diperbarui.');
          await refresh();
        } catch (error) { say(error.message, true); button.disabled = false; }
      };
      actions.append(button);
    }
    if(task.status === 'approved_pending_worker' && state.workerReady) {
      const run=el('button','Jalankan Otak 2','');
      run.type='button';
      run.onclick=async()=>{
        run.disabled=true;
        try{
          await request('/bridge/v1/tasks/'+task.id+'/run','POST',{});
          say('Otak 2 mulai menjalankan tugas melalui browser otomatis.');
          await refresh();
          await openWorkerMonitor(task.id);
        }catch(e){say(e.message,true);run.disabled=false;}
      };
      actions.append(run);
    }
    if (task.status === 'approved_pending_worker') {
      const test = el('button', 'Tes browser (read-only)', 'secondary');
      test.type = 'button';
      test.onclick = async () => {
        test.disabled = true;
        test.textContent = 'Memeriksa halaman…';
        say('Memeriksa halaman di browser terisolasi. Tidak ada aksi berbayar.');
        try {
          const inspection = await request('/bridge/v1/tasks/' + task.id + '/inspect', 'POST',
            { domain: task.scope.domains[0], mode: 'isolated' });
          say('Inspeksi selesai: ' + (inspection.result?.title || 'Halaman telah diperiksa'));
          await refresh();
        } catch (error) { say('Inspeksi gagal: ' + error.message, true); }
        finally { test.textContent = 'Tes browser (read-only)'; test.disabled = false; }
      };
      actions.append(test);
    }
    if (task.status === 'approved_pending_worker' && task.scope?.actions?.includes('login_assisted')) {
      const button = el('button','Buka browser Owner','secondary');
      button.type = 'button';
      button.onclick = () => openOwnerBrowser(task,button);
      actions.append(button);
    }
    div.append(actions);
  }
  if(task.status==='running_worker'||task.workerRun?.timeline?.length){
    const monitor=el('button',task.status==='running_worker'?'Pantau langsung':'Lihat aktivitas','secondary');
    monitor.type='button';
    monitor.classList.add('worker-monitor-open');
    monitor.onclick=()=>openWorkerMonitor(task.id);
    const tools=el('div',undefined,'entry-actions');tools.append(monitor);div.append(tools);
  }
}
async function refresh() {
  if (state.busy) return;
  state.busy = true;
  try {
    const [status, tasks, audit, incidents, discussions, memories, skills, hermesProbe] = await Promise.all([
      request('/bridge/v1/status'), request('/bridge/v1/tasks'),
      request('/bridge/v1/audit'), request('/bridge/v1/incidents'),
      request('/bridge/v1/discussions'), request('/bridge/v1/memories'),
      request('/bridge/v1/skills'),
      // Hermes readiness is optional and cannot break the rest of the Owner dashboard.
      request('/bridge/v1/hermes/status').catch(() => null)
    ]);
    state.workerReady=Boolean(status.workerRuntime?.enabled);
    $('worker').textContent = state.workerReady ? 'Siap digunakan' : 'Belum terpasang';
    const hermes=hermesProbe?.hermes||status.hermes||{};
    $('hermesRuntimeStatus').textContent = !hermesProbe ?
      (hermes.installed ? 'Hermes terpasang · status koneksi belum dapat diperiksa' : 'Hermes: belum tersedia') :
      !hermes.installed ? 'Hermes: belum terpasang' :
      !hermes.requestsEnabled ? 'Hermes terpasang · API belum diaktifkan' :
      hermes.reachable ? 'Hermes terhubung · hanya pemeriksaan status' :
      'Hermes terpasang · API belum terhubung';
    $('supervisor').textContent = status.supervisor === 'not_installed' ? 'Belum terpasang' : status.supervisor;
    $('browser').textContent = status.browser === 'ready_readonly' ? 'Siap · baca saja' :
      status.browser === 'not_installed' ? 'Belum tersedia' : status.browser;
    $('execution').textContent = status.executionEnabled ? 'Aktif' : 'Nonaktif';
    document.querySelectorAll('.stat').forEach((node, index) => {
      node.classList.toggle('is-ready', index === 2 && status.browser === 'ready_readonly' ||
        index === 3 && Boolean(status.executionEnabled));
      node.classList.toggle('is-disabled', index === 3 && !status.executionEnabled);
    });
    state.tasks = tasks.tasks || [];
    const sel = $('discussionTask'), selected = sel?.value;
    if (sel) {
      sel.replaceChildren();
      for (const task of state.tasks) {
        const option = el('option', task.instruction.slice(0,80));
        option.value=task.id; sel.append(option);
      }
      if (state.tasks.some(x=>x.id===selected))sel.value=selected;
    }
    const t = $('tasksList'), a = $('approvalsList');
    t.replaceChildren(); a.replaceChildren();
    if (!state.tasks.length) empty(t, 'Belum ada tugas.');
    state.tasks.forEach(item => taskCard(t, item));
    const pending = state.tasks.filter(x => x.status === 'awaiting_approval');
    if (!pending.length) empty(a, 'Tidak ada tugas menunggu persetujuan.');
    pending.forEach(item => taskCard(a, item, true));
    const pairs = [
      ['auditList', audit.events || [], x => [x.type, x.actor || 'System', x.at]],
      ['incidentsList', incidents.incidents || [], x => [x.status, x.description, x.createdAt]],
      ['discussionList', discussions.discussions || [], x => [x.role, x.content, x.at]],
      ['memoryList', memories.memories || [], x => [x.owner+' · '+(x.domain||'Unscoped')+' · '+(x.status||'pending'), x.content, x.evidence]],
      ['skillList', skills.skills || [], x => [x.name + ' · ' + x.status + ' · ' +(x.domain||'Legacy / tidak aktif'), x.procedure, 'v'+(x.version||1)+' · '+(x.invocations||0)+' pemakaian · '+(x.targetUrl||'SOP panduan')]]
    ];
    for (const [id, items, format] of pairs) {
      const node = $(id); node.replaceChildren();
      if (!items.length) empty(node, 'Belum ada catatan.');
      for (const item of items.slice(0,30)) {
        const [title, desc, info] = format(item);
        const row=entry(node,title,desc,info);
        if(id==='memoryList'&&item.status==='pending'&&item.domain) {
          const controls=el('div',undefined,'entry-actions');
          for(const op of ['verify','reject']){
            const b=el('button',op==='verify'?'Verifikasi':'Tolak','secondary');
            b.onclick=async()=>{
              b.disabled=true;
              try{await request('/bridge/v1/memories/'+item.id+'/'+op,'POST',{});
                say('Status memori diperbarui.');await refresh();
              }catch(error){say(error.message,true);b.disabled=false;}
            };
            controls.append(b);
          }
          row.append(controls);
        }
        if(id==='skillList'&&item.screening?.issues?.length){
          row.append(el('small','Audit: '+item.screening.issues.join(', ')));
        }
        if(id==='skillList'&&['proposed','screened'].includes(item.status)){
          const buttons=el('div',undefined,'entry-actions');
          const options=item.status==='proposed'
            ? [['screen','Audit SOP'],['reject','Tolak']]
            : [['verify','Verifikasi setelah uji nyata'],['reject','Tolak']];
          for(const [decision,label] of options){
            const b=el('button',label,'secondary');
            b.type='button';
            b.onclick=async()=>{
              b.disabled=true;
              try{
                const response=await request('/bridge/v1/skills/'+item.id+'/'+decision,'POST',{});
                const passed=response.skill?.screening?.passed;
                say(decision==='screen'?(passed?'Audit struktur lulus. Verifikasi hasil pengujian nyata sebelum mengaktifkan.':'Audit menemukan masalah; perbaiki SOP sebelum digunakan.'):'Review SOP tersimpan.',!passed&&decision==='screen');
                await refresh();
              }catch(error){say(error.message,true);b.disabled=false;}
            };
            buttons.append(b);
          }
          row.append(buttons);
        }
      }
    }
  } catch (error) {
    if (error.status === 401) location.replace('/login.html?next=%2Fai-agent.html');
    say('Gagal memuat agent: ' + error.message, true);
  } finally { state.busy = false; }
}
$('taskForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  const selectedAction = $('actions').value;
  const permitted = selectedAction === 'inspect' ? ['navigate','inspect','screenshot'] :
    selectedAction === 'login_assisted' ? ['navigate','inspect','screenshot','login_assisted','click','form_fill'] :
    ['navigate','inspect','screenshot','form_fill'];
  const body = {
    instruction: $('instruction').value,
    scope: { domains: [$('domain').value], actions: permitted, budgetUsd: 0,
      maxMinutes: Number($('duration').value) }
  };
  try {
    await request('/bridge/v1/tasks', 'POST', body);
    $('instruction').value = '';
    $('taskDialog').close();
    say('Tugas tersimpan dan menunggu persetujuan Owner.');
    await refresh();
  } catch (error) { say(error.message, true); }
  finally { if (button) button.disabled = false; }
});
document.querySelectorAll('[data-refresh]').forEach(b => b.onclick = refresh);
const tabButtons = [...document.querySelectorAll('[data-tab]')];
function selectTab(button, focus = false) {
  tabButtons.forEach(b => {
    const active = b === button;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== 'tab-' + button.dataset.tab);
  });
  if (focus) button.focus();
}
tabButtons.forEach((button, index) => {
  button.onclick = () => selectTab(button);
  button.onkeydown = event => {
    const next = event.key === 'ArrowRight' ? index + 1 :
      event.key === 'ArrowLeft' ? index - 1 : null;
    if (next !== null) {
      event.preventDefault();
      selectTab(tabButtons[(next + tabButtons.length) % tabButtons.length], true);
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      selectTab(tabButtons[event.key === 'Home' ? 0 : tabButtons.length - 1], true);
    }
  };
});
const taskDialog = $('taskDialog');
const closeTaskDialog = () => taskDialog.open && taskDialog.close();
$('openTaskDialog').onclick = () => {
  if (!taskDialog.open) taskDialog.showModal();
  $('instruction').focus();
};
$('closeTaskDialog').onclick = closeTaskDialog;
$('cancelTaskDialog').onclick = closeTaskDialog;
taskDialog.addEventListener('click', event => {
  if (event.target === taskDialog) closeTaskDialog();
});
function wireForm(id,path,collect,message){
  $(id).addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.submitter;
    if(button)button.disabled=true;
    try{await request(path,'POST',collect());$(id).reset();say(message);await refresh();}
    catch(e){say(e.message,true);}
    finally{if(button)button.disabled=false;}
  });
}
wireForm('memoryForm','/bridge/v1/memories',()=>({owner:$('memoryOwner').value,
  content:$('memoryContent').value,domain:$('memoryDomain').value,evidence:$('memoryEvidence').value}),'Memori tersimpan.');
wireForm('skillForm','/bridge/v1/skills',()=>({owner:$('skillOwner').value,domain:$('skillDomain').value,name:$('skillName').value,
  procedure:$('skillProcedure').value,targetUrl:$('skillTargetUrl').value.trim(),evidence:$('skillEvidence').value}),'SOP diajukan untuk audit dan verifikasi.');
wireForm('discussionForm','/bridge/v1/discussions',()=>({taskId:$('discussionTask').value,
  content:$('discussionContent').value}),'Diskusi tercatat.');

/* Manual Owner browser. Credentials stay in the transient input, never in audit or task state. */
let ownerBrowserSession=null;
let ownerBrowserBusy=false;
const ownerBrowserDialog=$('ownerBrowserDialog');
const ownerBrowserNotice=text=>{ $('ownerBrowserInfo').textContent=String(text||''); };
function showOwnerFrame(frame) {
  if (!frame || !/^data:image\/jpeg;base64,/.test(frame.image||'')) throw Error('Respons gambar browser tidak valid.');
  ownerBrowserSession={id:frame.sessionId,taskId:frame.taskId,width:frame.width,height:frame.height};
  $('ownerBrowserImage').src=frame.image;
  ownerBrowserNotice((frame.title||'Browser')+' · '+(frame.url||'')+' · diblokir: '+(frame.blockedRequests||0)+' permintaan');
}
async function ownerBrowserAction(action) {
  if (ownerBrowserBusy || !ownerBrowserSession) return;
  ownerBrowserBusy=true;
  try {
    const result=await request('/bridge/v1/tasks/'+ownerBrowserSession.taskId+'/browser/act',
      'POST',{sessionId:ownerBrowserSession.id,action});
    showOwnerFrame(result.browser);
  } catch(error) { ownerBrowserNotice('Gagal: '+error.message); }
  finally { ownerBrowserBusy=false; }
}
async function openOwnerBrowser(task,button) {
  if(ownerBrowserBusy || ownerBrowserSession) return;
  ownerBrowserBusy=true;
  button.disabled=true;
  ownerBrowserNotice('Menyiapkan sesi browser untuk '+task.scope.domains[0]+'…');
  if(!ownerBrowserDialog.open) ownerBrowserDialog.showModal();
  try {
    const data=await request('/bridge/v1/tasks/'+task.id+'/browser/start','POST',
      {domain:task.scope.domains[0]});
    showOwnerFrame(data.browser);
  } catch(error) { ownerBrowserNotice('Sesi tidak dapat dimulai: '+error.message); }
  finally { button.disabled=false;ownerBrowserBusy=false; }
}
$('ownerBrowserImage').addEventListener('click',async event=>{
  const img=event.currentTarget,rect=img.getBoundingClientRect();
  if(!ownerBrowserSession || !rect.width || !rect.height) return;
  const x=Math.max(0,Math.min(ownerBrowserSession.width-1,Math.round((event.clientX-rect.left)/rect.width*ownerBrowserSession.width)));
  const y=Math.max(0,Math.min(ownerBrowserSession.height-1,Math.round((event.clientY-rect.top)/rect.height*ownerBrowserSession.height)));
  await ownerBrowserAction({kind:'click',x,y});
});
$('ownerBrowserSecret').addEventListener('change',event=>{
  $('ownerBrowserText').type=event.target.checked?'password':'text';
});
$('ownerBrowserType').addEventListener('click',async()=>{
  const input=$('ownerBrowserText');
  const text=input.value;
  input.value='';
  if(text) await ownerBrowserAction({kind:'type',text});
});
for(const [id,action] of [
  ['ownerBrowserTab',{kind:'key',key:'Tab'}],
  ['ownerBrowserEnter',{kind:'key',key:'Enter'}],
  ['ownerBrowserReload',{kind:'refresh'}]
]) $(id).addEventListener('click',()=>ownerBrowserAction(action));
async function closeOwnerBrowser() {
  const current=ownerBrowserSession;
  ownerBrowserSession=null;
  ownerBrowserDialog.close();
  $('ownerBrowserImage').removeAttribute('src');
  $('ownerBrowserText').value='';
  if(current){
    try { await request('/bridge/v1/tasks/'+current.taskId+'/browser/close','POST',{sessionId:current.id}); }
    catch { /* Automatic backend timeout also closes abandoned sessions. */ }
  }
}
$('ownerBrowserClose').addEventListener('click',closeOwnerBrowser);
ownerBrowserDialog.addEventListener('cancel',event=>{event.preventDefault();void closeOwnerBrowser();});


/* Owner-only, read-only Worker monitor. Browser frames never persisted client-side. */
const workerMonitorDialog=$('workerMonitorDialog');
let workerMonitorTaskId=null,workerMonitorTimer=null,workerMonitorBusy=false;
function workerMonitorStatusText(status){
  return ({
    running_worker:'Otak 2 sedang bekerja',completed:'Tugas selesai',failed:'Tugas gagal',
    cancelled:'Tugas dibatalkan',paused:'Tugas dijeda',approved_pending_worker:'Menunggu eksekusi',
    awaiting_approval:'Menunggu persetujuan'
  })[status]||String(status||'Tidak diketahui');
}
function clearWorkerMonitorFrame(){
  $('workerMonitorImage').removeAttribute('src');
  $('workerMonitorImage').hidden=true;
  $('workerMonitorUrl').textContent='';
  $('workerMonitorPlaceholder').hidden=false;
}
function drawWorkerMonitor(report) {
  $('workerMonitorStatus').textContent=workerMonitorStatusText(report.status);
  $('workerMonitorDot').classList.toggle('is-live',report.active===true);
  $('workerMonitorSteps').textContent=(report.steps||0)+' / '+(report.maxSteps||6)+' langkah';
  $('workerMonitorUpdated').textContent='Diperbarui '+new Date().toLocaleTimeString('id-ID');
  const image=report.frame?.image;
  if(report.active&&typeof image==='string'&&image.startsWith('data:image/jpeg;base64,')&&image.length<410000){
    $('workerMonitorImage').src=image;
    $('workerMonitorImage').hidden=false;
    $('workerMonitorPlaceholder').hidden=true;
    $('workerMonitorUrl').textContent=report.frame.url||'';
  }else if(!report.active){
    clearWorkerMonitorFrame();
    $('workerMonitorPlaceholder').textContent='Sesi browser sudah berhenti. Gambar tidak disimpan.';
  }else if(!$('workerMonitorImage').getAttribute('src')){
    $('workerMonitorPlaceholder').textContent='Menunggu tampilan browser…';
  }
  const timeline=$('workerMonitorTimeline');timeline.replaceChildren();
  const events=Array.isArray(report.timeline)?report.timeline.slice(-32):[];
  for(const item of events){
    const li=el('li',undefined,'worker-monitor-event');
    const time=el('time',new Date(item.at).toLocaleTimeString('id-ID'));
    if(item.at)time.dateTime=item.at;
    li.append(el('span',item.text||'Aktivitas Worker'),time);
    timeline.append(li);
  }
  if(!events.length)timeline.append(el('li','Belum ada aktivitas Worker.','worker-monitor-empty'));
  const summary=$('workerMonitorSummary');
  summary.hidden=!report.summary;
  summary.textContent=report.summary?'Hasil: '+report.summary:'';
  $('workerMonitorPause').hidden=report.status!=='running_worker';
  $('workerMonitorCancel').hidden=!['running_worker','paused'].includes(report.status);
}
async function pollWorkerMonitor(){
  if(!workerMonitorDialog.open||!workerMonitorTaskId||workerMonitorBusy||document.visibilityState==='hidden')return;
  workerMonitorBusy=true;
  const id=workerMonitorTaskId;
  try{
    const payload=await request('/bridge/v1/tasks/'+id+'/monitor?frame=1');
    if(id===workerMonitorTaskId&&workerMonitorDialog.open){
      $('workerMonitorError').textContent='';
      drawWorkerMonitor(payload.monitor);
    }
  }catch(error){
    if(id===workerMonitorTaskId)
      $('workerMonitorError').textContent='Monitor belum dapat diperbarui: '+error.message;
  }finally{workerMonitorBusy=false;}
}
async function openWorkerMonitor(taskId){
  workerMonitorTaskId=taskId;
  const task=state.tasks.find(x=>x.id===taskId);
  $('workerMonitorInstruction').textContent=task?.instruction||'Memuat tugas…';
  $('workerMonitorError').textContent='';
  clearWorkerMonitorFrame();
  $('workerMonitorTimeline').replaceChildren();
  $('workerMonitorStatus').textContent='Menghubungkan…';
  if(!workerMonitorDialog.open)workerMonitorDialog.showModal();
  if(workerMonitorTimer)clearInterval(workerMonitorTimer);
  workerMonitorTimer=setInterval(pollWorkerMonitor,4200);
  await pollWorkerMonitor();
}
function closeWorkerMonitor(){
  workerMonitorTaskId=null;
  if(workerMonitorTimer)clearInterval(workerMonitorTimer);
  workerMonitorTimer=null;
  clearWorkerMonitorFrame();
  if(workerMonitorDialog.open)workerMonitorDialog.close();
}
$('workerMonitorClose').addEventListener('click',closeWorkerMonitor);
workerMonitorDialog.addEventListener('cancel',event=>{
  event.preventDefault();closeWorkerMonitor();
});
workerMonitorDialog.addEventListener('close',()=>{
  workerMonitorTaskId=null;
  if(workerMonitorTimer)clearInterval(workerMonitorTimer);
  workerMonitorTimer=null;clearWorkerMonitorFrame();
});
for(const [buttonId,action] of [['workerMonitorPause','pause'],['workerMonitorCancel','cancel']]){
  $(buttonId).addEventListener('click',async()=>{
    if(!workerMonitorTaskId)return;
    const button=$(buttonId);button.disabled=true;
    try{
      await request('/bridge/v1/tasks/'+workerMonitorTaskId+'/'+action,'POST',{});
      await refresh();
      await pollWorkerMonitor();
    }catch(error){
      $('workerMonitorError').textContent='Tidak dapat memperbarui tugas: '+error.message;
    }finally{button.disabled=false;}
  });
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    // Drop screenshots immediately when switching tabs or leaving the mobile app.
    clearWorkerMonitorFrame();
  }else if(workerMonitorDialog.open){
    void pollWorkerMonitor();
  }
});

$('connection').textContent = 'Owner aktif';
refresh();
// Lightweight dashboard-only refresh. Stops naturally when the page is closed.
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
