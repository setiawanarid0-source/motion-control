import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync(new URL('../public/kie-ui.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/vanta-polish.css',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../kie-studio.js',import.meta.url),'utf8');
const start=js.indexOf('  let selectedRefs=[];');
const end=js.indexOf('  function drawAccounts(){',start);
assert.ok(start!==-1&&end>start,'Reference selection implementation must exist');
const picker={files:[],value:''};
const preview={innerHTML:''};
const count={textContent:''};
const classes=new Set();
const drop={classList:{toggle(name,force){if(force)classes.add(name);else classes.delete(name);}}};
const nodes={kieRefs:picker,kieRefsPreview:preview,kieRefsCount:count,kieRefsDrop:drop};
const toasts=[],revoked=[],generated=[];
const context={kie:{busy:false},el:(id)=>nodes[id],maxRefs:2,
  toast:(message)=>toasts.push(message),
  esc:s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'),
  URL:{createObjectURL:f=>{const url='blob:reference-'+(generated.length+1);generated.push(url);return url;},
    revokeObjectURL:url=>revoked.push(url)}};
vm.createContext(context);
vm.runInContext(js.slice(start,end)+'\nthis.countRefs=()=>selectedRefs.length;'+
  '\nthis.selectedFiles=()=>selectedRefs.map(x=>x.file);',context);
const A={name:'woman-1.jpg',size:125000,type:'image/jpeg',lastModified:111};
const B={name:'woman-2.png',size:250000,type:'image/png',lastModified:222};
const C={name:'woman-3.webp',size:350000,type:'image/webp',lastModified:333};
const select=(files)=>{picker.files=files;picker.value='C:\\fakepath\\test.jpg';vm.runInContext('addSelectedRefs()',context);};
const remove=(index)=>vm.runInContext('removeSelectedRef('+index+')',context);
const files=()=>Array.from(context.selectedFiles(),x=>x.name);
const images=()=>[...preview.innerHTML.matchAll(/<img /g)].length;

select([A]);
assert.deepEqual(files(),['woman-1.jpg'],'First image should be stored');
assert.equal(images(),1,'First image must immediately appear without a Preview button');
assert.equal(count.textContent,'1 / 2 gambar');
assert.equal(picker.value,'','Picker input must reset to allow adding another file later');
assert.ok(preview.innerHTML.includes('data-kie-ref-remove="0"'),'Individual remove control must exist');

select([B]);
assert.deepEqual(files(),['woman-1.jpg','woman-2.png'],
  'Selecting images one by one must APPEND, never overwrite the first image');
assert.equal(images(),2,'Both references must preview at the same time');
assert.equal(count.textContent,'2 / 2 gambar');
assert.equal(classes.has('hidden'),true,'Picker should hide when two references are selected');

select([C]);
assert.deepEqual(files(),['woman-1.jpg','woman-2.png'],
  'Picking a third file must never destroy existing references');
assert.ok(toasts.at(-1).includes('Maksimal dua'));
remove(0);
assert.deepEqual(files(),['woman-2.png'],'Removing first image must not remove second');
assert.ok(revoked.includes('blob:reference-1'),'Deleted preview URL must be revoked');
assert.equal(count.textContent,'1 / 2 gambar');
assert.equal(classes.has('hidden'),false,'Picker must return once there is space again');

select([B]);
assert.deepEqual(files(),['woman-2.png'],'Duplicate reference should not consume remaining slot');
assert.equal(images(),1);
select([A]);
assert.deepEqual(files(),['woman-2.png','woman-1.jpg'],
  'A previously deleted file can be reselected');
assert.equal(images(),2);
remove(1);
assert.deepEqual(files(),['woman-2.png']);
const bad={name:'not-an-image.txt',size:500,type:'text/plain',lastModified:4};
select([bad]);
assert.deepEqual(files(),['woman-2.png'],'Invalid reference must not erase a valid image');
assert.ok(toasts.at(-1).includes('JPG'));
remove(0);
assert.deepEqual(files(),[]);
assert.equal(images(),0);
assert.equal(classes.has('hidden'),false);
assert.equal(count.textContent,'0 / 2 gambar');
assert.equal(revoked.length,3,'All object URLs must eventually be released after removals');

assert.ok(js.includes("const files=kie.mode==='edit'?selectedRefs.map(ref=>ref.file):[];"),
  'Submitting edit must send the STORED references, not the latest FileList');
assert.ok(js.includes("for(const f of files)fd.append('references',f,f.name);"),
  'Both selected Files must be attached to FormData in order');
const setMode=js.slice(js.indexOf('function setImageMode('),js.indexOf('function updateModel()'));
assert.ok(setMode.includes("el('kieRefs').value='';")&&!setMode.includes('selectedRefs=[]'),
  'Switching tabs resets the file picker but preserves separately stored Edit references');
assert.ok(js.includes('window.addEventListener(\'pagehide\''),
  'Unneeded previews must release object URLs when page is closed');
assert.ok(js.includes("el('kieRefsPreview').addEventListener('click'"),
  'Actual remove buttons must delegate to the remove handler');
assert.ok(html.includes('id="kieRefsDrop"')&&html.includes('id="kieRefsCount"'),
  'Picker and live counter must exist');
assert.ok(html.includes('id="kieRefsPreview"')&&html.includes('aria-live="polite"'),
  'Previews must render without manually requesting preview');
assert.ok(/kie-ui\.js\?v=20261019-progressive-history-v1/.test(html),
  'Browser should fetch the corrected JavaScript');
assert.ok(/\.kie-refs-preview \.kie-ref-thumbnail img\s*\{[^}]*object-fit:contain/s.test(css),
  'Preview must display complete image without cropping');
assert.ok(css.includes('.kie-refs-preview .kie-ref-remove'),
  'Per-image delete buttons must be visually accessible');
assert.ok(backend.includes("upload.array('references',2)"),
  'Server must retain the strict two-image limit and API contract');

console.log('PASS: add images incrementally, auto-review both, cancel one, re-add, reject overflow, preserve files for submit, unchanged backend');
