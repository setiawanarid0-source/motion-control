const $ = id => document.getElementById(id);
const state = { busy: false, tasks: [] };
const label = status => ({
  awaiting_approval: 'Menunggu persetujuan',
  approved_pending_worker: 'Disetujui · menunggu Worker',
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
  container.replaceChildren(el('p', message, 'muted'));
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
  if (['awaiting_approval', 'approved_pending_worker', 'paused'].includes(task.status)) {
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
          say('Status tugas diperbarui. Eksekusi belum aktif.');
          await refresh();
        } catch (error) { say(error.message, true); button.disabled = false; }
      };
      actions.append(button);
    }
    if (task.status === 'approved_pending_worker') {
      const test = el('button', 'Tes browser (read-only)', 'secondary');
      test.type = 'button';
      test.onclick = async () => {
        test.disabled = true;
        try {
          const inspection = await request('/bridge/v1/tasks/' + task.id + '/inspect', 'POST',
            { domain: task.scope.domains[0], mode: 'isolated' });
          say('Browser: ' + (inspection.result?.title || inspection.result?.url || 'Inspeksi selesai'));
          await refresh();
        } catch (error) { say(error.message, true); }
        finally { test.disabled = false; }
      };
      actions.append(test);
    }
    div.append(actions);
  }
}
async function refresh() {
  if (state.busy) return;
  state.busy = true;
  try {
    const [status, tasks, audit, incidents, discussions, memories, skills] = await Promise.all([
      request('/bridge/v1/status'), request('/bridge/v1/tasks'),
      request('/bridge/v1/audit'), request('/bridge/v1/incidents'),
      request('/bridge/v1/discussions'), request('/bridge/v1/memories'),
      request('/bridge/v1/skills')
    ]);
    const displayState = value => ({
      not_installed: 'Belum terpasang',
      ready_readonly: 'Siap · baca saja',
      inactive: 'Nonaktif',
      ready: 'Siap'
    }[value] || String(value || 'Tidak diketahui').replaceAll('_', ' '));
    $('worker').textContent = displayState(status.worker);
    $('supervisor').textContent = displayState(status.supervisor);
    $('browser').textContent = displayState(status.browser);
    $('execution').textContent = status.executionEnabled ? 'Aktif' : 'Nonaktif';
    $('connectionLabel').textContent = 'Owner aktif';

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
      ['memoryList', memories.memories || [], x => [x.owner, x.content, x.evidence]],
      ['skillList', skills.skills || [], x => [x.name + ' · ' + x.status, x.procedure, x.owner]]
    ];
    for (const [id, items, format] of pairs) {
      const node = $(id); node.replaceChildren();
      if (!items.length) empty(node, 'Belum ada catatan.');
      for (const item of items.slice(0,30)) {
        const [title, desc, info] = format(item);
        const row=entry(node,title,desc,info);
        if (id==='skillList' && item.status==='proposed') {
          const buttons=el('div',undefined,'entry-actions');
          for(const decision of ['verify','reject']) {
            const b=el('button',decision==='verify'?'Verifikasi':'Tolak','secondary');
            b.onclick=async()=>{
              b.disabled=true;
              try{await request('/bridge/v1/skills/'+item.id+'/'+decision,'POST',{});
                say('Review skill tersimpan.');await refresh();}
              catch(e){say(e.message,true);b.disabled=false;}
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
    selectedAction === 'login_assisted' ? ['navigate','inspect','screenshot','login_assisted'] :
    ['navigate','inspect','screenshot','form_fill'];
  const body = {
    instruction: $('instruction').value,
    scope: { domains: [$('domain').value], actions: permitted, budgetUsd: 0,
      maxMinutes: Number($('duration').value) }
  };
  try {
    await request('/bridge/v1/tasks', 'POST', body);
    $('instruction').value = '';
    say('Tugas berhasil dibuat. Persetujuan Owner tetap diperlukan.');
    await refresh();
  } catch (error) { say(error.message, true); }
  finally { if (button) button.disabled = false; }
});
document.querySelectorAll('[data-refresh]').forEach(b => b.onclick = refresh);
const tabs = [...document.querySelectorAll('[data-tab]')];
function activateTab(tab, moveFocus = false) {
  for (const t of tabs) {
    const selected = t === tab;
    t.classList.toggle('active', selected);
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.tab')) {
    panel.classList.toggle('hidden', panel.id !== 'tab-' + tab.dataset.tab);
  }
  if (moveFocus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + offset + tabs.length) % tabs.length;
    activateTab(tabs[destination], true);
  });
});
if (tabs.length) activateTab(tabs[0]);
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
  content:$('memoryContent').value,evidence:$('memoryEvidence').value}),'Memori tersimpan.');
wireForm('skillForm','/bridge/v1/skills',()=>({owner:$('skillOwner').value,name:$('skillName').value,
  procedure:$('skillProcedure').value,evidence:$('skillEvidence').value}),'Skill diajukan untuk verifikasi.');
wireForm('discussionForm','/bridge/v1/discussions',()=>({taskId:$('discussionTask').value,
  content:$('discussionContent').value}),'Diskusi tercatat.');
$('connectionLabel').textContent = 'Owner aktif';
refresh();
// Lightweight dashboard-only refresh. Stops naturally when the page is closed.
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
