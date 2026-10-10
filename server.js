import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { extractTaskFailure } from './task-failure.js';
import { canStartNewTask, isTrackableTaskCode } from './account-eligibility.js';
import { analyzeSource, prepareMotionSource, saveSource, cameraStatus, readCorrected, pruneOldJobs } from './camera-runtime.js';
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
};

const workflowMeta = {
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
    subtitle: 'KOH (1) · 30 FPS · 6 steps · CFG 1',
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
    subtitle: 'Eksperimen full generation · 35 FPS · 337 frame · 6 steps · CFG 1',
    detail: 'Menggunakan dua upload serta mask dari tes SAM3 berhasil di History. Mask masih mentah (belum refinement offline). Wajib memakai reference image dan video kompensasi yang SAMA dengan tes SAM3. Memerlukan kredit RunningHub.',
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

  if (!accounts.length) {
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
    canGenerate: canStartNewTask(status, MIN_POOL_CREDITS),
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
  return {
    remainCoins: Number(data.data?.remainCoins || 0),
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
async function createTask({ apiKey, workflowId, workflowKey, mode, imageFile, videoFile, diagnosticAccount, diagnosticTaskId }) {
  const imageName = await uploadToRunningHub(apiKey, imageFile);
  const videoName = await uploadToRunningHub(apiKey, videoFile);
  const masks=workflowKey==='r4Lab' ? await prepareDiagnosticAssets(diagnosticAccount,diagnosticTaskId,apiKey) : null;
  const payload = {
    apiKey,
    workflowId,
    nodeInfoList: [
      { nodeId: '30', fieldName: 'image', fieldValue: imageName },
      { nodeId: '33', fieldName: 'video', fieldValue: videoName },
      ...(workflowKey === 'koh1AntiObject' ? [] : [{ nodeId: '331', fieldName: 'seed', fieldValue: 50 }]),
      ...(masks ? [{ nodeId: '500', fieldName: 'image', fieldValue: masks.imageName }, { nodeId: '501', fieldName: 'video', fieldValue: masks.videoName }] : []),
    ],
    workflow: JSON.stringify(workflowGraphs[workflowKey]),
    addMetadata: true,
    retainSeconds: 259200,
  };
  if (mode === 'standard') payload.instanceType = 'default';

  const submittedAt = new Date().toISOString();
  const data = await rhJson('/task/openapi/create', apiKey, payload, 60000);
  if (!data || Number(data.code) !== 0 || !data.data?.taskId) {
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
    // Keep low-credit keys for recovering old tasks. Do not allow new generation with them.
    const pollingOnly=!canStartNewTask(status,MIN_POOL_CREDITS);
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
    res.json({ account: publicAccount(account, status), storage: 'persistent', pollingOnly });
  } catch (error) {
    res.status(400).json({ error: error.message || 'API key tidak dapat divalidasi.' });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });
  const next = accounts.filter(a => a.id !== req.params.id);
  if (next.length === accounts.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
  next.forEach((a, i) => { a.name = `Account ${String(i + 1).padStart(2, '0')}`; });
  saveVaultAccounts(deviceId, next);
  res.json({ ok: true });
});

app.post('/api/accounts/refresh', async (req, res) => {
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });

  const checked=await Promise.all(accounts.map(async account=>{
    try{return {account,status:await accountStatus(account.key)};}
    catch(error){return {account,status:{error:error.message}};}
  }));
  // Never remove keys here. A low-credit account may still own a RunningHub task.
  res.json({
    accounts:checked.map(x=>publicAccount(x.account,x.status)),
    autoRemovedCount:0,
    pollingOnlyCount:checked.filter(x=>!canStartNewTask(x.status,MIN_POOL_CREDITS)).length,
    minimumCredits:MIN_POOL_CREDITS
  });
});

app.post('/api/generate', upload.fields([
  { name: 'referenceImage', maxCount: 1 },
  { name: 'videoReference', maxCount: 1 },
]), async (req, res) => {
  const imageFile = req.files?.referenceImage?.[0];
  const videoFile = req.files?.videoReference?.[0];
  let preparedMotion=null;
  const cleanup = () => {
    if(preparedMotion)preparedMotion.release().catch(e=>console.warn('R15 temporary file cleanup',e.message));
    for (const f of [imageFile, videoFile]) if (f?.path) fs.promises.unlink(f.path).catch(() => {});
  };

  try {
    if (!imageFile || !videoFile) throw new Error('Reference Image dan Video Reference wajib diisi.');
    if (imageFile.size > IMAGE_MAX) throw new Error('Reference Image maksimal 20 MB.');
    if (videoFile.size > VIDEO_MAX) throw new Error('Video Reference maksimal 100 MB.');
    if (!/^image\/(jpeg|png|webp)$/i.test(imageFile.mimetype)) throw new Error('Format gambar harus JPG, PNG, atau WEBP.');
    if (!/^video\/(mp4|quicktime|webm|x-matroska)$/i.test(videoFile.mimetype)) throw new Error('Format video harus MP4, MOV, atau WEBM.');

    const workflowKey = String(req.body?.workflow || 'r15');
    const mode = String(req.body?.mode || 'lite');
    const requestedAccountId = String(req.body?.accountId || 'auto');
    if (!workflowGraphs[workflowKey]) throw new Error('Workflow tidak dikenali.');
    const diagnosticTaskId=String(req.body?.diagnosticTaskId||'');
    const diagnosticAccountId=String(req.body?.diagnosticAccountId||'');
    if(workflowKey==='r4Lab' && (!/^\d{10,25}$/.test(diagnosticTaskId)||!diagnosticAccountId))
      throw new Error('R4 Full membutuhkan tes SAM3 berhasil di History untuk memakai ulang mask.');
    if (!['lite', 'standard'].includes(mode)) throw new Error('Mode RunningHub tidak dikenali.');

    const { deviceId, accounts } = getPersistentAccounts(req);
    if (!deviceId) throw new Error('Device session tidak tersedia. Reload halaman.');
    if (!accounts.length) throw new Error('Belum ada RunningHub API key di Account Pool.');
    const diagnosticAccount=workflowKey==='r4Lab'?accounts.find(a=>a.id===diagnosticAccountId):null;
    if(workflowKey==='r4Lab'&&!diagnosticAccount)throw new Error('Akun tes SAM3 sebelumnya tidak tersedia pada sesi ini.');

    // Analyze driving-video camera before a paid RunningHub submission.
    const sourceCamera=workflowKey==='r15'?await analyzeSource(videoFile):null;
    let candidates=[];
    if(requestedAccountId!=='auto'){
      const chosen=accounts.find(a=>a.id===requestedAccountId);
      if(!chosen)throw new Error('Akun yang dipilih tidak ditemukan.');
      const status=await accountStatus(chosen.key);
      if(!canStartNewTask(status,MIN_POOL_CREDITS))
        throw new Error('Akun hanya untuk pemantauan task lama: kredit di bawah 100 RH.');
      candidates=[chosen];
    }else{
      const ranked=await Promise.all(accounts.map(async a=>{
        try{return {a,s:await accountStatus(a.key)};}
        catch(error){return {a,s:{error:error.message}};}
      }));
      candidates=ranked.filter(x=>canStartNewTask(x.s,MIN_POOL_CREDITS))
        .sort((x,y)=>(x.s.currentTaskCounts-y.s.currentTaskCounts)||(y.s.remainCoins-x.s.remainCoins))
        .map(x=>x.a);
      if(!candidates.length)throw new Error('Tidak ada akun dengan kredit minimal 100 RH untuk membuat task baru.');
    }
    if(workflowKey==='r15')preparedMotion=await prepareMotionSource(videoFile);
    let lastError = null;
    for (const account of candidates) {
      try {
        const task = await createTask({
          apiKey: account.key,
          workflowId: LOCKED_WORKFLOW_ID,
          workflowKey,
          mode,
          imageFile,
          videoFile:preparedMotion?.file||videoFile,
          diagnosticAccount,
          diagnosticTaskId,
        });
        if(workflowKey==='r15'){
          try{await saveSource(String(task.taskId),videoFile,sourceCamera);}
          catch(cameraError){console.error('R15 source save failed',String(task.taskId),cameraError.message);}
        }
        account.lastUsedAt = new Date().toISOString();
        saveVaultAccounts(deviceId, accounts);
        cleanup();
        return res.json({
          ok: true,
          taskId: String(task.taskId),
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
        if (requestedAccountId !== 'auto') break;
      }
    }
    throw lastError || new Error('Tidak ada akun RunningHub yang dapat membuat task.');
  } catch (error) {
    cleanup();
    res.status(400).json({ error: error.message || 'Generate gagal.' });
  }
});

async function resolveTaskVideoUrl(account, taskId) {
  const data = await rhJson('/task/openapi/outputs', account.key, { apiKey: account.key, taskId }, 30000);
  if (!data || Number(data.code) !== 0 || !Array.isArray(data.data) || !data.data.length) {
    const err = new Error(data?.msg || 'Video belum tersedia.');
    err.statusCode = 409;
    throw err;
  }
  const output = data.data.find(x => String(x.nodeId) === '393' || String(x.fileType || '').toLowerCase().includes('video') || /\.mp4(?:\?|$)/i.test(String(x.fileUrl || ''))) || data.data[0];
  const fileUrl = String(output?.fileUrl || '');
  if (!/^https?:\/\//i.test(fileUrl)) {
    const err = new Error('URL hasil video tidak valid.');
    err.statusCode = 502;
    throw err;
  }
  return fileUrl;
}

// On-demand lookup of an existing task. It NEVER creates a new paid RunningHub job.
app.post('/api/tasks/:taskId/recover',async(req,res)=>{
  const {deviceId,accounts}=getPersistentAccounts(req);
  if(!deviceId)return res.status(400).json({error:'Device session tidak tersedia.'});
  const taskId=String(req.params.taskId||'');
  if(!/^\d{10,25}$/.test(taskId))return res.status(400).json({error:'Task ID tidak valid.'});
  for(const account of accounts.slice(0,25)){
    try{
      const result=await rhJson('/task/openapi/outputs',account.key,{apiKey:account.key,taskId},15000);
      if(isTrackableTaskCode(result?.code,result))
        return res.json({ok:true,accountId:account.id,accountName:account.name});
    }catch(_error){/* Try next stored account; no new task submitted. */}
  }
  res.status(404).json({error:'API key pembuat task tidak ditemukan. Tambahkan kembali API key tersebut di Account Pool (jangan kirim ke chat), kemudian tekan Periksa lagi.'});
});

app.post('/api/tasks/:taskId', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.body?.accountId || '');
  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Akun pembuat task tidak ada di Account Pool. Status RunningHub belum diketahui. Jangan generate ulang; pilih Periksa lagi di History.' });
  try {
    const data = await rhJson('/task/openapi/outputs', account.key, { apiKey: account.key, taskId: req.params.taskId }, 30000);
    const code = Number(data?.code);
    if (code === 0 && Array.isArray(data?.data) && data.data.length) {
      const outputs = data.data.map(x => ({ fileUrl: x.fileUrl, fileType: x.fileType, nodeId: x.nodeId ?? null })).filter(x => x.fileUrl);
      const rawVideo=outputs.find(x=>/video/i.test(String(x.fileType||''))||/\.mp4(?:\?|$)/i.test(String(x.fileUrl||'')));
      if(rawVideo){
        const qa=await cameraStatus(req.params.taskId,rawVideo.fileUrl,accountId);
        if(qa)return res.json({...qa,rawCode:code});
      }
      return res.json({ state: 'success', outputs, rawCode: code });
    }
    if (code === 804 || code === 813 || code === 0) {
      return res.json({ state: code === 813 ? 'queued' : 'running', rawCode: code, message: data?.msg || '' });
    }
    res.json({ state: 'failed', rawCode: code, message: data?.msg || 'Task gagal.', failure: extractTaskFailure(data) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Gagal mengambil status task.' });
  }
});

app.get('/api/camera-video/:taskId',(req,res)=>{
  const accountId=String(req.query?.accountId||'');
  if(!getPersistentAccounts(req).accounts.some(a=>a.id===accountId))return res.status(404).end();
  const video=readCorrected(req.params.taskId);
  if(!video)return res.status(404).end();
  res.setHeader('Cache-Control','private, no-store');res.type('video/mp4');res.sendFile(video);
});

app.get('/api/tasks/:taskId/preview', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.query?.accountId || '');
  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Akun task tidak ditemukan.' });
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
  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Akun task tidak ditemukan dalam sesi.' });
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

app.use((req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const startupGlobalAccounts = loadGlobalAccounts();
const startupLegacyAccounts = recoverLegacyVaultAccounts();
if (!startupGlobalAccounts.length && startupLegacyAccounts.length) {
  saveGlobalAccounts(startupLegacyAccounts);
}
console.log(`Account vault startup: global=${loadGlobalAccounts().length}, legacy=${startupLegacyAccounts.length}`);
pruneOldJobs().catch(error=>console.warn('Camera job cleanup',error.message));
app.listen(PORT, '0.0.0.0', () => console.log(`VANTA Motion Studio listening on :${PORT}`));
