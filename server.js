import express from 'express';
import { createAgentBridge } from './agent-bridge.js';
import { createOwnerAuth } from './owner-auth.js';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { extractTaskFailure } from './task-failure.js';
import { canStartNewTask, isTrackableTaskCode, partitionAccountRefresh } from './account-eligibility.js';
import {canGenerateWithAccount,rankGenerationAccounts} from './runninghub-account-priority.js';
import { analyzeSource, prepareMotionSource, saveSource, cameraStatus, readCorrected, pruneOldJobs } from './camera-runtime.js';
import { referenceAvailability, referenceFile, stageReferences, commitReferences, discardReferences, pruneReferences } from './history-references.js';
import {createTaskRegistry} from './task-registry.js';
import {createGenerationQueue} from './generation-queue.js';
import {runningHubInstanceType,canSubmitMachineMode} from './runninghub-instance.js';
import {explicitQueueMaxed,queueCapacityError,isDefinitelyRejectedAtCapacity,mayTryNextAccountAfterCreate} from './runninghub-capacity.js';
import {readLegacyFinal40} from './legacy-final40-cache.js';
import {createKieStudio} from './kie-studio.js';
import {graphValidationError,isDefinitelyRejectedGraph} from './runninghub-graph-validation.js';
import {verifyRifeInput,rifeGraphForSourceFps,RIFE_TARGET_FPS} from './rife-video.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const RH_BASE = 'https://www.runninghub.ai';
const COOKIE_NAME = 'vanta_session_v2';
const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const MIN_POOL_CREDITS = 100;
const LOCKED_WORKFLOW_ID = process.env.RUNNINGHUB_WORKFLOW_ID || '2101170393796079617';
const DATA_DIR = process.env.VANTA_DATA_DIR || '/data';
const ACCOUNT_DIR = path.join(DATA_DIR, 'account-vaults');
const GLOBAL_ACCOUNT_VAULT = path.join(DATA_DIR, 'accounts.enc');

const workflowGraphs = {
  r15: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/r15-camera-adaptive-api.json'), 'utf8')),
  current: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/current-api.json'), 'utf8')),
  koh1AntiObject: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/motionfly-r4-sam3-diagnostic-api.json'), 'utf8')),
  r4Lab: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/motionfly-r4-full-controlled-api.json'), 'utf8')),
  rife60: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/rife60-api.json'), 'utf8')),
};

const workflowMeta = {
  rife60: {
    id: 'rife60', name: 'RIFE · ≤60 → 60 FPS',
    subtitle: 'RIFE target 60 FPS · input hingga 60 FPS · resolusi asli',
    detail: 'Video di bawah 60 FPS diinterpolasi menjadi 60 FPS. Video 60 FPS diteruskan tanpa menambah frame. Tidak ada upscale, konversi ke 30 FPS, atau perubahan durasi yang disengaja. Uji provider berbayar belum dilakukan.',
    outputKind: 'video'
  },
  r15: {
    id: 'r15',
    name: 'MotionFly R4 · Camera Engine (R15)',
    subtitle: '35 FPS · 1080×1920 · 6 steps · CFG 1 · eksperimen',
    detail: 'Gerakan sumber dinormalisasi ke 35 FPS tanpa frame duplikat. Kamera diperiksa sebelum dan sesudah generate; tidak ada warp seluruh tubuh. Eksperimental, belum terbukti bebas jitter AI.',
    outputKind: 'video', experimental: true, cameraEngine: true
  },
  current: {
    id: 'current',
    name: 'Current Workflow',
    subtitle: 'KOH (1) · 40 FPS langsung dari workflow · 6 steps · CFG 1',
    detail: 'Current Workflow dari file KOH (1) yang baru.'
  },
  koh1AntiObject: {
    id: 'koh1AntiObject',
    name: 'MotionFly R4 · SAM3 Mask Diagnostic',
    subtitle: 'Diagnostik SAM3 · 35 FPS · tanpa generasi AI video',
    detail: 'Upload video driving yang SUDAH dikompensasi 35 FPS. Hasil: video mask orang + gambar mask referensi. Memakai kredit RunningHub; belum menguji kamera hasil generasi.',
    outputKind: 'diagnostic'
  },
  r4Lab: {
    id: 'r4Lab',
    name: 'MotionFly R4 · Full Controlled Test',
    subtitle: 'Eksperimen · 40 FPS langsung dari workflow · 6 steps · CFG 1',
    detail: 'Menggunakan dua upload serta mask dari tes SAM3 berhasil di History. Video driving dan mask diselaraskan pada 40 FPS di workflow. Wajib memakai reference image dan video kompensasi yang SAMA dengan tes SAM3. Memerlukan kredit RunningHub.',
    outputKind: 'video',
    experimental: true
  }
};

const masterSecret = process.env.APP_MASTER_KEY || 'development-only-change-me';
const cipherKey = crypto.createHash('sha256').update(masterSecret).digest();
if (!process.env.APP_MASTER_KEY) {
  console.warn('[WARN] APP_MASTER_KEY is not set. Use a persistent secret in production.');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(b => b.toString('base64url')).join('.');
}

function decrypt(token) {
  if (!token) return null;
  try {
    const [ivB64, tagB64, dataB64] = token.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch {
    return null;
  }
}

const taskRegistry=createTaskRegistry({dir:DATA_DIR,encrypt,decrypt});
const generationQueue=createGenerationQueue({dir:DATA_DIR,maxConcurrent:1});
function registeredAccount(taskId,accountId=''){
  const item=taskRegistry.get(String(taskId));
  if(!item)return null;
  if(accountId&&item.accountId!==accountId)return null;
  return {id:item.accountId,name:item.accountName,key:item.key,registered:true};
}
function taskAccount(req,taskId,accountId){
  if(!accountId)return null; // Preserve the original account-scoped media access check.
  const fromRegistry=registeredAccount(taskId,accountId);
  if(fromRegistry)return fromRegistry;
  // Backwards compatible for legacy tasks not yet registered in the vault.
  return getPersistentAccounts(req).accounts.find(a=>a.id===accountId)
    ||taskRegistry.getRetiredAccount(accountId)||null;
}
function writeTaskState(taskId,result){
  const now=new Date().toISOString();
  const patch={status:result.state,lastCheckedAt:now,
    statusDetail:typeof result.message==='string'?result.message.slice(0,240):null,
    providerCode:Number.isFinite(result.rawCode)?result.rawCode:null,
    deliveryNote:result.deliveryNote||null};
  if(result.state==='success'){
    const outputs=Array.isArray(result.outputs)?result.outputs:[];
    const video=outputs.find(x=>/video/i.test(String(x.fileType||''))||/\.mp4(?:\?|$)/i.test(String(x.fileUrl||'')));
    const mask=outputs.find(x=>String(x.nodeId)==='394');
    patch.resultUrl=video?.fileUrl||null;
    patch.referenceMaskUrl=mask?.fileUrl||null;
    patch.cameraQA=result.cameraQA||null;
    patch.finishedAt=now;
    patch.error=null;
  }else if(result.state==='failed'){
    patch.finishedAt=now;
    patch.error=result.message||'RunningHub mengonfirmasi task gagal.';
  }else{
    patch.error=result.state==='check_error'?'Status terbaru belum tersedia. Pemantauan akan dicoba kembali.':null;
  }
  return taskRegistry.update(taskId,patch);
}
async function runningHubTaskState(taskId,account,accountId){
  const data=await rhJson('/task/openapi/outputs',account.key,{apiKey:account.key,taskId},30000);
  const code=Number(data?.code);
  if(code===0&&Array.isArray(data?.data)&&data.data.length){
    const outputs=data.data.map(x=>({fileUrl:x.fileUrl,fileType:x.fileType,nodeId:x.nodeId??null})).filter(x=>x.fileUrl);
    // RunningHub generates native 40 FPS frames within Current / R4 Full workflows.
    // The website never runs an additional post-generation FPS conversion.
    const video=outputs.find(x=>String(x.nodeId)==='490')
      ||outputs.find(x=>/video/i.test(String(x.fileType||''))||/\.mp4(?:\?|$)/i.test(String(x.fileUrl||'')));
    if(video){
      const qa=await cameraStatus(taskId,video.fileUrl,accountId);
      if(qa)return {...qa,rawCode:code};
    }
    return {state:'success',outputs,rawCode:code};
  }
  // RunningHub's outputs endpoint is the authoritative source; /status is deprecated.
  if(code===813)return {state:'queued',rawCode:code,providerStatus:'QUEUED',
    message:'Dalam antrean RunningHub'};
  if(code===804)return {state:'running',rawCode:code,providerStatus:'RUNNING',
    message:'Sedang diproses di RunningHub'};
  if(code===0)return {state:'waiting_output',rawCode:code,
    message:'Menunggu hasil dari RunningHub'};
  const failure=extractTaskFailure(data);
  if(code===805||failure)return {state:'failed',rawCode:code,providerStatus:'FAILED',
    message:'RunningHub menyatakan task gagal.',failure};
  // Unrecognized status is not proof of RunningHub still generating or of failure.
  return {state:'check_error',rawCode:Number.isFinite(code)?code:null,
    message:'Status RunningHub belum tersedia. Pemeriksaan akan diulang.'};
}
let monitorBusy=false;
async function monitorRegisteredTasks(){
  if(monitorBusy)return;
  monitorBusy=true;
  try{
    const pending=taskRegistry.active().sort((a,b)=>Date.parse(a.lastCheckedAt||0)-Date.parse(b.lastCheckedAt||0)).slice(0,8);
    await Promise.all(pending.map(async item=>{
      try{
        const data=await runningHubTaskState(item.taskId,item,item.accountId);
        writeTaskState(item.taskId,data);
      }catch(err){
        taskRegistry.update(item.taskId,{status:'check_error',lastCheckedAt:new Date().toISOString(),
          error:'Koneksi RunningHub belum tersedia. Pemeriksaan akan diulang.'});
      }
    }));
    taskRegistry.purgeExpired();
  }catch(err){console.warn('Task lifecycle monitor',err.message);}
  finally{monitorBusy=false;}
}
function getDeviceId(req) {
  const raw = String(req.headers['x-vanta-device'] || req.query?.deviceId || '').trim();
  return /^[a-zA-Z0-9_-]{20,128}$/.test(raw) ? raw : '';
}

function accountVaultPath(deviceId) {
  return path.join(ACCOUNT_DIR, `${deviceId}.enc`);
}

function normalizeAccounts(accounts) {
  const seen = new Set();
  const out = [];
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const key = account?.fingerprint || account?.id || account?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(account);
  }
  out.forEach((a, i) => { a.name = `Account ${String(i + 1).padStart(2, '0')}`; });
  return out;
}

function loadEncryptedAccountFile(filePath) {
  try {
    const token = fs.readFileSync(filePath, 'utf8').trim();
    const data = decrypt(token);
    return normalizeAccounts(data?.accounts);
  } catch {
    return [];
  }
}

function loadGlobalAccounts() {
  return loadEncryptedAccountFile(GLOBAL_ACCOUNT_VAULT);
}

function recoverLegacyVaultAccounts() {
  const recovered = [];
  try {
    if (!fs.existsSync(ACCOUNT_DIR)) return recovered;
    for (const name of fs.readdirSync(ACCOUNT_DIR)) {
      if (!name.endsWith('.enc')) continue;
      recovered.push(...loadEncryptedAccountFile(path.join(ACCOUNT_DIR, name)));
    }
  } catch (error) {
    console.warn('legacy account vault recovery failed', error.message);
  }
  return normalizeAccounts(recovered);
}

function saveGlobalAccounts(accounts) {
  const normalized = normalizeAccounts(accounts);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${GLOBAL_ACCOUNT_VAULT}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, encrypt({ accounts: normalized, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(temp, GLOBAL_ACCOUNT_VAULT);
}

// Kept as the single persistence write path used by the existing endpoints.
// Account Pool is intentionally global for this private studio, not tied to browser/device localStorage.
function saveVaultAccounts(_deviceId, accounts) {
  saveGlobalAccounts(accounts);
}

function getPersistentAccounts(req) {
  let accounts = loadGlobalAccounts();

  // An intentionally emptied global vault must never re-import deleted legacy keys.
  if (!accounts.length && !fs.existsSync(GLOBAL_ACCOUNT_VAULT)) {
    const recovered = recoverLegacyVaultAccounts();
    const legacyCookieAccounts = getSession(req).accounts;
    accounts = normalizeAccounts([...recovered, ...legacyCookieAccounts]);
    if (accounts.length) {
      saveGlobalAccounts(accounts);
      console.log(`Recovered ${accounts.length} Account Pool entr${accounts.length === 1 ? 'y' : 'ies'} into global persistent vault.`);
    }
  }

  // Keep a non-empty compatibility value so existing endpoint guards do not depend on browser storage.
  return { deviceId: getDeviceId(req) || 'global', accounts };
}

function getSession(req) {
  const session = decrypt(req.cookies?.[COOKIE_NAME]);
  const base = session && typeof session === 'object' ? session : {};
  return {
    accounts: Array.isArray(base.accounts) ? base.accounts : [],
  };
}

function saveSession(res, session, req) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || req.secure;
  res.cookie(COOKIE_NAME, encrypt(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 180 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function publicAccount(account, status = null) {
  return {
    id: account.id,
    name: account.name,
    addedAt: account.addedAt,
    lastUsedAt: account.lastUsedAt || null,
    status,
    canGenerate: canGenerateWithAccount(status, MIN_POOL_CREDITS),
  };
}

async function rhJson(pathname, apiKey, body, timeout = 30000) {
  const { data } = await axios.post(`${RH_BASE}${pathname}`, body, {
    timeout,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    validateStatus: () => true,
  });
  return data;
}

async function accountStatus(apiKey) {
  const data = await rhJson('/uc/openapi/accountStatus', apiKey, { apikey: apiKey }, 20000);
  if (!data || Number(data.code) !== 0) throw new Error(data?.msg || 'API key tidak dapat divalidasi.');
  const coins=data.data?.remainCoins;
  if(coins==null||!Number.isFinite(Number(coins)))
    throw new Error('Saldo akun belum dapat diverifikasi. Akun tidak akan dihapus.');
  return {
    remainCoins: Number(coins),
    currentTaskCounts: Number(data.data?.currentTaskCounts || 0),
    currency: data.data?.currency || null,
    apiType: data.data?.apiType || null,
  };
}

async function uploadToRunningHub(apiKey, file) {
  const form = new FormData();
  form.append('apiKey', apiKey);
  form.append('fileType', 'input');
  form.append('file', fs.createReadStream(file.path), {
    filename: file.originalname,
    contentType: file.mimetype,
    knownLength: file.size,
  });
  const response = await axios.post(`${RH_BASE}/task/openapi/upload`, form, {
    timeout: 10 * 60 * 1000,
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${apiKey}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });
  const data = response.data;
  if (!data || Number(data.code) !== 0 || !data.data?.fileName) {
    throw new Error(data?.msg || `Upload ${file.originalname} gagal.`);
  }
  return data.data.fileName;
}

// Reuse previously saved SAM3 diagnostic masks, without adding new user media inputs.
// Do not execute paid full generation unless both masks are retrievable and uploaded.
async function fetchDiagnosticMasks(sourceAccount, sourceTaskId) {
  if(!/^\d{10,25}$/.test(String(sourceTaskId||'')))throw new Error('Task ID diagnostik tidak valid.');
  const result=await rhJson('/task/openapi/outputs',sourceAccount.key,{apiKey:sourceAccount.key,taskId:String(sourceTaskId)},30000);
  if(Number(result?.code)!==0||!Array.isArray(result?.data))throw new Error('Mask diagnostik sudah tidak tersedia atau task belum selesai.');
  const outputs=result.data.filter(x=>typeof x.fileUrl==='string'&&/^https:\/\//i.test(x.fileUrl));
  const video=outputs.find(x=>String(x.nodeId)==='393');
  const reference=outputs.find(x=>String(x.nodeId)==='394');
  if(!video||!reference)throw new Error('Task diagnostik tidak memiliki kedua output mask dari node 393 dan 394.');
  return {videoUrl:video.fileUrl,referenceUrl:reference.fileUrl};
}
async function downloadDiagnosticAsset(url,destination,maxBytes){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/^(?:\d+\.){3}\d+$/.test(u.hostname))
    throw new Error('URL aset mask RunningHub tidak aman.');
  const response=await axios.get(url,{responseType:'stream',timeout:120000,maxRedirects:4});
  let read=0;
  const limit=new Transform({transform(chunk,enc,cb){
    read+=chunk.length;
    if(read>maxBytes)cb(new Error('Aset mask melebihi batas ukuran.'));
    else cb(null,chunk);
  }});
  try{await pipeline(response.data,limit,fs.createWriteStream(destination));}
  catch(error){response.data.destroy();throw error;}
  if(read<100)throw new Error('Aset mask RunningHub kosong.');
  return read;
}
async function prepareDiagnosticAssets(sourceAccount,sourceTaskId,targetApiKey){
  const urls=await fetchDiagnosticMasks(sourceAccount,sourceTaskId);
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'r4-full-lab-'));
  try{
    const video=path.join(dir,'sam3-driving-mask.mp4');
    const image=path.join(dir,'sam3-reference-mask.png');
    const [videoSize,imageSize]=await Promise.all([
      downloadDiagnosticAsset(urls.videoUrl,video,VIDEO_MAX),
      downloadDiagnosticAsset(urls.referenceUrl,image,IMAGE_MAX)
    ]);
    const [videoName,imageName]=await Promise.all([
      uploadToRunningHub(targetApiKey,{path:video,originalname:'r4-sam3-driving-mask.mp4',mimetype:'video/mp4',size:videoSize}),
      uploadToRunningHub(targetApiKey,{path:image,originalname:'r4-sam3-reference-mask.png',mimetype:'image/png',size:imageSize})
    ]);
    return {videoName,imageName};
  }finally{await fs.promises.rm(dir,{recursive:true,force:true});}
}
async function createTask({ apiKey, workflowId, workflowKey, mode, imageFile, videoFile, sourceFps, diagnosticAccount, diagnosticTaskId, onBeforeSubmit }) {
  const selectedGraph=workflowKey==='rife60'?rifeGraphForSourceFps(workflowGraphs.rife60,sourceFps):workflowGraphs[workflowKey];
  const imageName = workflowKey==='rife60'?null:await uploadToRunningHub(apiKey, imageFile);
  const videoName = await uploadToRunningHub(apiKey, videoFile);
  const masks=workflowKey==='r4Lab' ? await prepareDiagnosticAssets(diagnosticAccount,diagnosticTaskId,apiKey) : null;
  const payload = {
    apiKey,
    workflowId,
    nodeInfoList: [
      ...(workflowKey==='rife60'
        ? [{ nodeId: '1', fieldName: 'video', fieldValue: videoName },
           { nodeId: '2', fieldName: 'source_fps', fieldValue: sourceFps },
           { nodeId: '2', fieldName: 'target_fps', fieldValue: RIFE_TARGET_FPS }]
        : [{ nodeId: '30', fieldName: 'image', fieldValue: imageName },
           { nodeId: '33', fieldName: 'video', fieldValue: videoName }]),
      ...(['koh1AntiObject','rife60'].includes(workflowKey) ? [] : [{ nodeId: '331', fieldName: 'seed', fieldValue: 50 }]),
      ...(masks ? [{ nodeId: '500', fieldName: 'image', fieldValue: masks.imageName }, { nodeId: '501', fieldName: 'video', fieldValue: masks.videoName }] : []),
    ],
    workflow: JSON.stringify(selectedGraph),
    addMetadata: true,
    // RIFE does not reserve a paid retained instance after completion.
    ...(workflowKey==='rife60'?{}:{retainSeconds:259200}),
  };
  // Match the RunningHub instance selected by the user; keep queued legacy Lite unchanged.
  const instanceType=runningHubInstanceType(mode);
  if(instanceType)payload.instanceType=instanceType;

  const submittedAt = new Date().toISOString();
  if(onBeforeSubmit)onBeforeSubmit();
  const data = await rhJson('/task/openapi/create', apiKey, payload, 60000);
  if (!data || Number(data.code) !== 0 || !data.data?.taskId) {
    // A structured provider rejection with TASK_QUEUE_MAXED and no taskId
    // confirms that THIS attempted create did not enter RunningHub's queue.
    // A timeout, missing response, or arbitrary error is never safe to retry.
    if(!data?.data?.taskId&&explicitQueueMaxed(data))throw queueCapacityError();
    const validation=graphValidationError(data);
    if(validation){
      if(workflowKey==='rife60')validation.message=validation.message.replace('workflow H3','workflow RIFE');
      throw validation;
    }
    const tips = data?.data?.promptTips;
    throw new Error(data?.msg || tips || 'RunningHub gagal membuat task.');
  }
  return { ...data.data, submittedAt };
}

const upload = multer({
  dest: '/tmp/vanta-motion/',
  limits: { files: 2, fileSize: VIDEO_MAX },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Owner login is the ONLY entry into VANTA. Public exceptions: login assets and Railway health.
const ownerAuth = createOwnerAuth({ dataDir: DATA_DIR });
app.use('/api/auth', ownerAuth.router);
app.get('/login.html', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public/login.html'));
});
for (const name of ['auth.css', 'auth.js']) {
  app.get('/' + name, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', name));
  });
}
app.use(ownerAuth.requireOwner);
// Agent bridge now inherits the same Owner session as every other VANTA feature.
app.use('/api/agent', createAgentBridge({ isOwner: ownerAuth.isOwner }));
// Independent provider: never shares RunningHub credits, task history, or account vault.
app.use('/api/kie',createKieStudio({encrypt,decrypt,dir:DATA_DIR}));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  },
}));

app.get('/health', (req, res) => res.json({ ok: true, service: 'vanta-motion-studio', workflows: Object.keys(workflowGraphs), persistentStorage: DATA_DIR }));

app.get('/api/workflows', (req, res) => {
  res.json({ workflows: Object.values(workflowMeta) });
});

app.get('/api/session', async (req, res) => {
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });
  res.json({
    accounts: accounts.map(a => publicAccount(a)),
    workflowsReady: true,
    storage: 'persistent',
  });
});

app.post('/api/accounts', async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  if (apiKey.length < 12 || apiKey.length > 256) return res.status(400).json({ error: 'API key tidak valid.' });
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });
  const fingerprint = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  if (accounts.some(a => a.fingerprint === fingerprint)) return res.status(409).json({ error: 'API key ini sudah ada di pool.' });
  try {
    const status = await accountStatus(apiKey);
    if (!canStartNewTask(status,MIN_POOL_CREDITS))
      return res.status(400).json({ error: 'Akun harus memiliki minimal 100 RH untuk ditambahkan ke Account Pool.' });
    const account = {
      id: crypto.randomUUID(),
      name: `Account ${String(accounts.length + 1).padStart(2, '0')}`,
      key: apiKey,
      fingerprint,
      addedAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    accounts.push(account);
    saveVaultAccounts(deviceId, accounts);
    res.json({ account: publicAccount(account, status), storage: 'persistent' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'API key tidak dapat divalidasi.' });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });
  const removing=accounts.find(a=>a.id===req.params.id);
  if(!removing)return res.status(404).json({error:'Akun tidak ditemukan.'});
  try{
    // Even manual removal must never orphan accepted RunningHub tasks.
    taskRegistry.retireAccount(removing);
    const next=loadGlobalAccounts().filter(a=>a.id!==req.params.id);
    saveVaultAccounts(deviceId,next);
    res.json({ok:true});
  }catch(error){res.status(503).json({error:'Penghapusan ditunda: penyimpanan task belum siap.'});}
});

async function refreshPool(req){
  const {deviceId,accounts}=getPersistentAccounts(req);
  const checked=await Promise.all(accounts.map(async account=>{
    try{return {account,status:await accountStatus(account.key)};}
    catch(error){return {account,status:{error:error.message}};}
  }));
  // The task registry keeps a separate encrypted credential until History expires.
  // Accounts with RunningHub tasks that are not yet registered are retained as a safeguard.
  const {removed}=partitionAccountRefresh(checked,MIN_POOL_CREDITS);
  if(removed.length){
    const retiredIds=new Set(removed.map(x=>x.account.id));
    const latest=loadGlobalAccounts();
    const toRetire=latest.filter(a=>retiredIds.has(a.id));
    // Store every retired API key in the encrypted task vault before modifying Account Pool.
    for(const account of toRetire)taskRegistry.retireAccount(account);
    const next=latest.filter(a=>!retiredIds.has(a.id));
    if(next.length!==latest.length)saveVaultAccounts(deviceId,next);
  }
  const remaining=loadGlobalAccounts();
  return {accounts:remaining.map(a=>{
    const status=checked.find(x=>x.account.id===a.id)?.status||null;
    return publicAccount(a,status);
  }),autoRemovedCount:removed.length,minimumCredits:MIN_POOL_CREDITS};
}
app.post('/api/accounts/refresh',async(req,res)=>{
  try{res.json(await refreshPool(req));}
  catch(error){res.status(502).json({error:'Tidak dapat memperbarui Account Pool saat ini.'});}
});

async function handleGeneration(req,res){
  const imageFile = req.files?.referenceImage?.[0];
  const videoFile = req.files?.videoReference?.[0];
  let preparedMotion=null;
  let rifeSource=null;
  let stagedReferences=null;
  const cleanup = () => {
    if(stagedReferences)discardReferences(stagedReferences).catch(e=>console.warn('Reference staging cleanup',e.message));
    if(preparedMotion)preparedMotion.release().catch(e=>console.warn('R15 temporary file cleanup',e.message));
    for (const f of [imageFile, videoFile]) if (f?.path) fs.promises.unlink(f.path).catch(() => {});
  };

  try {
    const workflowKey = String(req.body?.workflow || 'r15');
    const videoOnly=workflowKey==='rife60';
    if ((!videoOnly&&!imageFile) || !videoFile) throw new Error('Media input wajib diisi.');
    if (imageFile?.size > IMAGE_MAX) throw new Error('Reference Image maksimal 20 MB.');
    if (videoFile.size > VIDEO_MAX) throw new Error('Video Reference maksimal 100 MB.');
    if (!videoOnly&&!/^image\/(jpeg|png|webp)$/i.test(imageFile.mimetype)) throw new Error('Format gambar harus JPG, PNG, atau WEBP.');
    if (!/^video\/(mp4|quicktime|webm|x-matroska)$/i.test(videoFile.mimetype)) throw new Error('Format video harus MP4, MOV, atau WEBM.');

    const mode = String(req.body?.mode || 'standard');
    const requestedAccountId = String(req.body?.accountId || 'auto');
    if (!workflowGraphs[workflowKey]) throw new Error('Workflow tidak dikenali.');
    if(videoOnly){
      req.progress?.('analyzing');
      rifeSource=await verifyRifeInput(videoFile);
      console.info('RIFE source inspected; original video unchanged',
        {fps:rifeSource.sourceFps,source:rifeSource.detectionMethod});
    }
    const diagnosticTaskId=String(req.body?.diagnosticTaskId||'');
    const diagnosticAccountId=String(req.body?.diagnosticAccountId||'');
    if(workflowKey==='r4Lab' && (!/^\d{10,25}$/.test(diagnosticTaskId)||!diagnosticAccountId))
      throw new Error('R4 Full membutuhkan tes SAM3 berhasil di History untuk memakai ulang mask.');
    if (!['standard','plus','lite'].includes(mode)) throw new Error('Mode RunningHub tidak dikenali.');
    // Lite accepted here only to let already-queued legacy tasks finish.

    const { deviceId, accounts } = getPersistentAccounts(req);
    if (!deviceId) throw new Error('Device session tidak tersedia. Reload halaman.');
    if (!accounts.length) throw new Error('Belum ada RunningHub API key di Account Pool.');
    const diagnosticAccount=workflowKey==='r4Lab'?accounts.find(a=>a.id===diagnosticAccountId):null;
    if(workflowKey==='r4Lab'&&!diagnosticAccount)throw new Error('Akun tes SAM3 sebelumnya tidak tersedia pada sesi ini.');

    req.progress?.('analyzing');
    // Analyze driving-video camera before a paid RunningHub submission.
    const sourceCamera=workflowKey==='r15'?await analyzeSource(videoFile):null;
    req.progress?.('checking_account');
    let candidates=[];
    if(requestedAccountId!=='auto'){
      const chosen=accounts.find(a=>a.id===requestedAccountId);
      if(!chosen)throw new Error('Akun yang dipilih tidak ditemukan.');
      const status=await accountStatus(chosen.key);
      if(!canGenerateWithAccount(status,MIN_POOL_CREDITS))
        throw new Error('Akun ini tidak dapat digunakan. Generasi RunningHub memerlukan saldo minimal 100 RH.');
      candidates=[chosen];
    }else{
      const checked=await Promise.all(accounts.map(async account=>{
        try{return {account,status:await accountStatus(account.key)};}
        catch(error){return {account,status:{error:error.message}};}
      }));
      candidates=rankGenerationAccounts(checked,MIN_POOL_CREDITS)
        .map(x=>x.account);
      if(!candidates.length)throw new Error('Tidak ada akun RunningHub yang siap dengan saldo minimal 100 RH.');
    }
    if(workflowKey==='r15'){
      req.progress?.('preparing_motion');
      preparedMotion=await prepareMotionSource(videoFile);
    }
    // Verify both input previews and encrypted task registry before a paid submission.
    req.progress?.('saving_references');
    stagedReferences=await stageReferences(imageFile,videoFile,{videoOnly});
    taskRegistry.ensureWritable();
    let lastError = null;
    let rejectedAtCapacity=0;
    for (const account of candidates) {
      try {
        req.progress?.('uploading_inputs');
        const task = await createTask({
          apiKey: account.key,
          // RH custom workflow JSON overrides workflowId; use the already-owner-accessible
          // workflow ID, not a public post owned by another RunningHub user.
          workflowId: LOCKED_WORKFLOW_ID,
          workflowKey,
          mode,
          imageFile,
          videoFile:preparedMotion?.file||videoFile,
          sourceFps:rifeSource?.sourceFps,
          diagnosticAccount,
          diagnosticTaskId,
          onBeforeSubmit:()=>{req.submissionAttempted=true;req.progress?.('submitting');},
        });
        // Task is accepted/paid: register it before any post-submit work.
        // A local persistence problem must NOT retry submission against another account.
        let trackingRegistered=false;
        try{
          taskRegistry.add({taskId:String(task.taskId),accountId:account.id,
            accountName:account.name,key:account.key,workflow:workflowMeta[workflowKey].name,
            outputKind:workflowMeta[workflowKey].outputKind||'video',mode,
            video:videoFile.originalname,submittedAt:task.submittedAt,
            status:task.taskStatus==='RUNNING'?'running':'queued'});
          trackingRegistered=true;
        }catch(registerError){
          console.error('Paid task accepted but registry write failed',String(task.taskId),registerError.message);
        }
        let referencesStored=false;
        try{
          const stored=await commitReferences(stagedReferences,String(task.taskId),{videoOnly});
          referencesStored=stored.video&&(videoOnly||stored.image);
          stagedReferences=null;
        }catch(mediaError){
          console.error('Reference preview commit failed',String(task.taskId),mediaError.message);
        }
        if(workflowKey==='r15'){
          try{await saveSource(String(task.taskId),videoFile,sourceCamera);}
          catch(cameraError){console.error('R15 source save failed',String(task.taskId),cameraError.message);}
        }
        // Never restore a deleted account from this request's earlier in-memory snapshot.
        try{
          const newestAccounts=loadGlobalAccounts();
          const currentAccount=newestAccounts.find(x=>x.id===account.id);
          if(currentAccount){
            currentAccount.lastUsedAt=new Date().toISOString();
            saveVaultAccounts(deviceId,newestAccounts);
          }
        }catch(vaultErr){console.error('Account timestamp update deferred',vaultErr.message);}
        cleanup();
        return res.json({
          ok: true,
          taskId: String(task.taskId),
          referencesStored,
          trackingRegistered,
          taskStatus: task.taskStatus || 'QUEUED',
          accountId: account.id,
          accountName: account.name,
          workflow: workflowMeta[workflowKey],
          mode,
          submittedAt: task.submittedAt,
          netWssUrl: task.netWssUrl || null,
        });
      } catch (error) {
        lastError = error;
        if(videoOnly)console.warn('RIFE task attempt failed',
          {stage:req.submissionAttempted?'provider_submission':'pre_submit',
           class:String(error.code||error.name||'unknown').slice(0,50)});
        if(isDefinitelyRejectedGraph(error)){
          // RunningHub explicitly declined this graph before it entered the queue.
          // Do not resend the same invalid graph to other accounts.
          req.submissionAttempted=false;
          console.warn('RunningHub workflow validation rejected',workflowKey,String(error.message).slice(0,900));
          break;
        }
        if(isDefinitelyRejectedAtCapacity(error)){
          rejectedAtCapacity++;
          // RunningHub explicitly returned TASK_QUEUE_MAXED and no taskId.
          // The preceding request was REJECTED, not an unknown accepted job.
          req.submissionAttempted=false;
          console.info('RunningHub account at task capacity; checking next eligible account',account.id);
        }
        // Never re-submit a paid create after a transport timeout, ambiguous
        // response or other unconfirmed acknowledgement.
        if(!mayTryNextAccountAfterCreate({
          error,selectedAccount:requestedAccountId,attemptedCreate:req.submissionAttempted
        }))break;
      }
    }
    if(rejectedAtCapacity===candidates.length)
      throw new Error('Semua akun RunningHub yang memenuhi syarat sedang penuh (TASK_QUEUE_MAXED). Task belum diterima; tunggu slot akun tersedia.');
    throw lastError || new Error('Tidak ada akun RunningHub yang dapat membuat task.');
  } catch (error) {
    cleanup();
    res.status(400).json({ error: error.message || 'Generate gagal.' });
  }
}

// The browser receives an upload acknowledgement while heavy preflight runs in the
// background. Files are persisted on the existing Railway volume before we respond.
async function runQueuedGeneration(job,report){
  const req={
    headers:{'x-vanta-device':job.deviceId},
    cookies:{},query:{},body:job.body,
    files:{...(job.image?{referenceImage:[job.image]}:{}),videoReference:[job.video]},
    progress:report,submissionAttempted:false
  };
  let result=null,httpStatus=200;
  const response={
    status(code){httpStatus=code;return this;},
    json(data){result=data;return this;}
  };
  await handleGeneration(req,response);
  if(result?.ok&&result.taskId){
    generationQueue.update(job.jobId,{
      stage:'accepted',message:'Task diterima RunningHub',
      task:result,error:null
    });
    return;
  }
  const failureStage=generationQueue.read(job.jobId)?.stage||'queued';
  if(req.submissionAttempted){
    console.warn('RunningHub acceptance unconfirmed',job.jobId,
      String(result?.error||'No acknowledgement').slice(0,160));
    generationQueue.update(job.jobId,{
      stage:'uncertain',failureStage,
      error:'Belum dapat memastikan apakah RunningHub menerima task. Periksa History sebelum mencoba lagi.'
    });
  }else{
    generationQueue.update(job.jobId,{
      stage:'error',failureStage,error:result?.error||
        (httpStatus===400?'Persiapan media belum berhasil.':'Tidak dapat memulai pemrosesan video.')
    });
  }
}
generationQueue.setExecutor(runQueuedGeneration);

// Upload can be retried with the same request ID without creating a second task.
app.post('/api/generate', upload.fields([
  {name:'referenceImage',maxCount:1},
  {name:'videoReference',maxCount:1}
]), async(req,res)=>{
  const image=req.files?.referenceImage?.[0],video=req.files?.videoReference?.[0];
  try{
    const deviceId=getDeviceId(req);
    if(!deviceId)return res.status(400).json({error:'Sesi perangkat tidak tersedia. Muat ulang halaman.'});
    const videoOnly=String(req.body?.workflow||'r15')==='rife60';
    if(!video||(!videoOnly&&!image))return res.status(400).json({error:'Media wajib diunggah.'});
    if(!canSubmitMachineMode(String(req.body?.mode||'standard')))
      return res.status(400).json({error:'Pilih mesin RunningHub Standard atau Plus.'});
    if((image?.size||0)>IMAGE_MAX||video.size>VIDEO_MAX)return res.status(413).json({error:'Gambar maksimal 20 MB dan video maksimal 100 MB.'});
    if((!videoOnly&&!/^image\/(jpeg|png|webp)$/i.test(image.mimetype))||!/^video\/(mp4|quicktime|webm|x-matroska)$/i.test(video.mimetype))
      return res.status(415).json({error:'Format gambar atau video tidak didukung.'});
    const id=String(req.headers['x-vanta-request-id']||crypto.randomUUID());
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
      return res.status(400).json({error:'ID upload tidak valid.'});
    const staged=await generationQueue.stage({jobId:id,deviceId,body:req.body||{},image,video});
    res.setHeader('Cache-Control','no-store');
    res.status(202).json(staged);
  }catch(error){
    console.error('Generation upload preflight failed',String(error.message||error).slice(0,190));
    res.status(503).json({error:'Referensi belum berhasil diterima server. Coba lagi setelah koneksi stabil.'});
  }finally{
    for(const file of [image,video])if(file?.path)fs.promises.rm(file.path,{force:true}).catch(()=>{});
  }
});
app.get('/api/generate/jobs', (req,res)=>{
  const deviceId=getDeviceId(req);
  if(!deviceId)return res.status(401).json({error:'Sesi perangkat tidak tersedia.'});
  res.setHeader('Cache-Control','no-store');
  res.json({jobs:generationQueue.latest(deviceId)});
});
app.get('/api/generate/jobs/:jobId', (req,res)=>{
  const deviceId=getDeviceId(req);
  if(!deviceId)return res.status(401).json({error:'Sesi perangkat tidak tersedia.'});
  const job=generationQueue.owned(String(req.params.jobId),deviceId);
  if(!job)return res.status(404).json({error:'Pengiriman tidak ditemukan.'});
  res.setHeader('Cache-Control','no-store');
  res.json(job);
});

async function resolveTaskVideoUrl(account, taskId) {
  const data = await rhJson('/task/openapi/outputs', account.key, { apiKey: account.key, taskId }, 30000);
  if (!data || Number(data.code) !== 0 || !Array.isArray(data.data) || !data.data.length) {
    const err = new Error(data?.msg || 'Video belum tersedia.');
    err.statusCode = 409;
    throw err;
  }
  const output = data.data.find(x => String(x.nodeId) === '490')
    ||data.data.find(x => String(x.nodeId) === '393')
    ||data.data.find(x => String(x.fileType||'').toLowerCase().includes('video') || /\.mp4(?:\?|$)/i.test(String(x.fileUrl || '')))
    ||data.data[0];
  const fileUrl = String(output?.fileUrl || '');
  if (!/^https?:\/\//i.test(fileUrl)) {
    const err = new Error('URL hasil video tidak valid.');
    err.statusCode = 502;
    throw err;
  }
  return fileUrl;
}

// On-demand lookup of an existing task. It NEVER creates a new paid RunningHub job.
app.delete('/api/tasks/:taskId/history',(req,res)=>{
  const {deviceId}=getPersistentAccounts(req);
  if(!deviceId)return res.status(401).json({error:'Sesi browser tidak tersedia.'});
  const id=String(req.params.taskId||''),accountId=String(req.body?.accountId||'');
  if(!/^\d{10,25}$/.test(id)||!accountId)return res.status(400).json({error:'Task atau akun tidak valid.'});
  try{
    const removed=taskRegistry.removeCompleted(id,accountId);
    if(!removed)return res.status(404).json({error:'Task tidak ditemukan di History.'});
    return res.json({ok:true});
  }catch(error){
    return res.status(/masih diproses/.test(error.message)?409:400)
      .json({error:String(error.message||'Tidak dapat menghapus History.').slice(0,180)});
  }
});
app.get('/api/tasks/history',(req,res)=>{
  try{res.setHeader('Cache-Control','private, no-store');res.json({tasks:taskRegistry.publicList()});}
  catch(error){res.status(503).json({error:'Riwayat server sementara tidak tersedia.'});}
});
// Recover existing browser History into encrypted server registry BEFORE Account Pool cleanup.
// Never creates a paid RunningHub task.
app.post('/api/tasks/claim',async(req,res)=>{
  const input=Array.isArray(req.body?.tasks)?req.body.tasks.slice(0,30):[];
  const accounts=[...getPersistentAccounts(req).accounts,
    ...taskRegistry.retiredAccounts().map(x=>taskRegistry.getRetiredAccount(x.id))];
  const restored=[];
  const attempt=async item=>{
    const taskId=String(item.taskId||''),accountId=String(item.accountId||'');
    if(!/^\d{10,25}$/.test(taskId))return;
    if(taskRegistry.get(taskId)){restored.push(taskId);return;}
    const account=accounts.find(x=>x.id===accountId);
    if(!account)return;
    try{
      const data=await rhJson('/task/openapi/outputs',account.key,{apiKey:account.key,taskId},9000);
      if(!isTrackableTaskCode(data?.code,data))return;
      const code=Number(data.code);
      taskRegistry.add({taskId,accountId:account.id,accountName:account.name,key:account.key,
        workflow:String(item.workflow||'Legacy task').slice(0,140),
        outputKind:item.outputKind==='diagnostic'?'diagnostic':'video',
        mode:['standard','plus','lite'].includes(item.mode)?item.mode:'standard',video:String(item.video||'').slice(0,140),
        submittedAt:Number.isFinite(Date.parse(item.startedAt))?item.startedAt:new Date().toISOString(),
        status:code===813?'queued':'running'});
      restored.push(taskId);
    }catch(error){console.warn('Legacy task claim deferred',taskId,error.message);}
  };
  // Bounded concurrency protects RunningHub and avoids stalling the interface on 30 serial requests.
  for(let i=0;i<input.length;i+=5)
    await Promise.all(input.slice(i,i+5).map(attempt));
  res.json({restored:restored.length,restoredIds:restored});
});
app.post('/api/tasks/:taskId/recover',async(req,res)=>{
  const taskId=String(req.params.taskId||'');
  if(!/^\d{10,25}$/.test(taskId))return res.status(400).json({error:'Task ID tidak valid.'});
  const registered=registeredAccount(taskId);
  if(registered)return res.json({ok:true,accountId:registered.id,accountName:registered.name});
  const accounts=[...getPersistentAccounts(req).accounts,
    ...taskRegistry.retiredAccounts().map(x=>taskRegistry.getRetiredAccount(x.id))];
  for(const account of accounts.slice(0,65)){
    try{
      const data=await rhJson('/task/openapi/outputs',account.key,{apiKey:account.key,taskId},15000);
      if(isTrackableTaskCode(data?.code,data)){
        taskRegistry.add({taskId,accountId:account.id,accountName:account.name,
          key:account.key,workflow:'Recovered task',submittedAt:new Date().toISOString(),status:'running'});
        return res.json({ok:true,accountId:account.id,accountName:account.name});
      }
    }catch(error){/* Continue checking; no paid generation occurs. */}
  }
  res.status(404).json({error:'Akun pemilik task lama tidak dapat ditemukan. Proses RunningHub tidak dibatalkan.'});
});
app.post('/api/tasks/:taskId',async(req,res)=>{
  const taskId=String(req.params.taskId||'');
  if(!/^\d{10,25}$/.test(taskId))return res.status(400).json({error:'Task ID tidak valid.'});
  const accountId=String(req.body?.accountId||'');
  const account=taskAccount(req,taskId,accountId);
  if(!account)return res.status(409).json({state:'check_error',message:'Koneksi pemantauan akan dicoba kembali.'});
  try{
    const data=await runningHubTaskState(taskId,account,accountId||account.id);
    if(taskRegistry.get(taskId))writeTaskState(taskId,data);
    res.json(data);
  }catch(error){
    if(taskRegistry.get(taskId))
      taskRegistry.update(taskId,{status:'check_error',lastCheckedAt:new Date().toISOString(),
        error:'Koneksi RunningHub belum tersedia. Pemeriksaan akan diulang.'});
    res.json({state:'check_error',message:'Menghubungkan kembali ke RunningHub. Pemantauan akan dilanjutkan otomatis.'});
  }
});

// The Account Pool provides the same account-scoped access used by task preview.
// No public static directory or direct filesystem paths are exposed.
function referenceAccess(req){
  const id=String(req.params.taskId||'');
  const accountId=String(req.query?.accountId||req.body?.accountId||'');
  if(!/^\d{10,25}$/.test(id))return false;
  return !!taskAccount(req,id,accountId);
}
app.get('/api/task-references/:taskId', (req,res)=>{
  if(!referenceAccess(req))return res.status(404).json({error:'Referensi tidak tersedia untuk akun ini.'});
  res.setHeader('Cache-Control','private, no-store');
  res.json(referenceAvailability(req.params.taskId));
});
app.get('/api/task-references/:taskId/:kind', (req,res)=>{
  if(!referenceAccess(req))return res.status(404).end();
  const kind=String(req.params.kind);
  if(!['image','video'].includes(kind))return res.status(404).end();
  const file=referenceFile(req.params.taskId,kind);
  if(!file)return res.status(404).end();
  res.setHeader('Cache-Control','private, no-store');
  res.type(kind==='image'?'image/jpeg':'video/mp4');
  // Use sendFile's range support for HTML5 video seeking.
  res.sendFile(file);
});
app.get('/api/camera-video/:taskId',(req,res)=>{
  const accountId=String(req.query?.accountId||'');
  if(!taskAccount(req,req.params.taskId,accountId))return res.status(404).end();
  const video=readCorrected(req.params.taskId);
  if(!video)return res.status(404).end();
  res.setHeader('Cache-Control','private, no-store');res.type('video/mp4');res.sendFile(video);
});

app.get('/api/tasks/:taskId/preview', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.query?.accountId || '');
  const account = taskAccount(req,req.params.taskId,accountId);
  if (!account) return res.status(404).json({ error: 'Task tidak tersedia untuk akun ini.' });
  const final40=readLegacyFinal40(req.params.taskId);
  if(final40){res.setHeader('Cache-Control','private, no-store');res.type('video/mp4');return res.sendFile(final40);}
  const corrected=readCorrected(req.params.taskId);
  if(corrected){res.setHeader('Cache-Control','private, no-store');res.type('video/mp4');return res.sendFile(corrected);}
  try {
    const fileUrl = await resolveTaskVideoUrl(account, req.params.taskId);
    const range = req.headers.range;
    const upstream = await axios.get(fileUrl, {
      responseType: 'stream',
      timeout: 10 * 60 * 1000,
      maxRedirects: 5,
      headers: range ? { Range: range } : {},
      validateStatus: status => status === 200 || status === 206,
    });

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="motion-${req.params.taskId}.mp4"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Accept-Ranges', upstream.headers['accept-ranges'] || 'bytes');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    if (upstream.headers.etag) res.setHeader('ETag', upstream.headers.etag);
    if (upstream.headers['last-modified']) res.setHeader('Last-Modified', upstream.headers['last-modified']);

    upstream.data.on('error', err => {
      console.error('preview stream failed', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.destroy(err);
    });
    upstream.data.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(error.statusCode || 502).json({ error: error.message || 'Preview video gagal dimuat.' });
  }
});

app.get('/api/tasks/:taskId/download', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.query?.accountId || '');
  const account = taskAccount(req,req.params.taskId,accountId);
  if (!account) return res.status(404).json({ error: 'Task tidak tersedia untuk akun ini.' });
  const final40=readLegacyFinal40(req.params.taskId);
  if(final40)return res.download(final40,'motion-'+req.params.taskId+'-40fps.mp4');
  const corrected=readCorrected(req.params.taskId);
  if(corrected)return res.download(corrected,'motion-'+req.params.taskId+'-camera-checked.mp4');
  try {
    const fileUrl = await resolveTaskVideoUrl(account, req.params.taskId);

    const upstream = await axios.get(fileUrl, {
      responseType: 'stream',
      timeout: 10 * 60 * 1000,
      maxRedirects: 5,
      validateStatus: status => status >= 200 && status < 400,
    });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    res.setHeader('Content-Disposition', `attachment; filename="motion-${req.params.taskId}.mp4"`);
    res.setHeader('Cache-Control', 'private, no-store');
    upstream.data.on('error', err => {
      console.error('download stream failed', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.destroy(err);
    });
    upstream.data.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message || 'Download video gagal.' });
  }
});

// Handle mobile upload interruptions as input errors, not opaque HTTP 500 HTML pages.
app.use((error,req,res,next)=>{
  if(req.path!=='/api/generate')return next(error);
  if(res.headersSent)return next(error);
  const tooLarge=error?.code==='LIMIT_FILE_SIZE'||error?.code==='LIMIT_FILE_COUNT';
  const message=tooLarge?
    'Ukuran referensi terlalu besar. Gambar maksimal 20 MB dan video maksimal 100 MB.':
    error?.code==='LIMIT_UNEXPECTED_FILE'?'Gunakan satu gambar dan satu video referensi.':
    'Upload referensi terputus sebelum selesai. Periksa koneksi lalu coba kembali.';
  console.warn('Upload rejected before paid task',String(error.code||error.message||'interrupted').slice(0,100));
  res.status(tooLarge?413:400).json({error:message});
});

app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const startupGlobalAccounts = loadGlobalAccounts();
const startupLegacyAccounts = recoverLegacyVaultAccounts();
if (!fs.existsSync(GLOBAL_ACCOUNT_VAULT) && !startupGlobalAccounts.length && startupLegacyAccounts.length) {
  saveGlobalAccounts(startupLegacyAccounts);
}
console.log(`Account vault startup: global=${loadGlobalAccounts().length}, legacy=${startupLegacyAccounts.length}`);
pruneOldJobs().catch(error=>console.warn('Camera job cleanup',error.message));
pruneReferences().catch(error=>console.warn('Reference cleanup',error.message));
generationQueue.resume();
setInterval(()=>generationQueue.purge(),60*60*1000).unref();
try{taskRegistry.purgeExpired();}catch(error){console.error('Registry startup audit',error.message);}
setInterval(()=>monitorRegisteredTasks(),25000).unref();
setTimeout(()=>monitorRegisteredTasks(),1200).unref();
// Account Pool retirement runs after browser History recovery or an explicit refresh.
if(/^\d{10,25}$/.test(process.env.VANTA_REFERENCE_AUDIT_TASK||'')){
  console.log('Reference availability audit',process.env.VANTA_REFERENCE_AUDIT_TASK,
    JSON.stringify(referenceAvailability(process.env.VANTA_REFERENCE_AUDIT_TASK)));
}
setInterval(()=>pruneReferences().catch(error=>console.warn('Reference cleanup',error.message)),60*60*1000).unref();
app.listen(PORT, '0.0.0.0', () => console.log(`VANTA Motion Studio listening on :${PORT}`));
