import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { extractTaskFailure } from './task-failure.js';
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
  r15: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/r15-api.json'), 'utf8')),
  current: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/current-api.json'), 'utf8')),
  koh1AntiObject: JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows/motionfly-r3-driver-stabilization-api.json'), 'utf8')),
};

const workflowMeta = {
  r15: {
    id: 'r15',
    name: 'R15 Baseline',
    subtitle: 'Motion baseline · 30 FPS · 6 steps · CFG 1.5',
    detail: 'Raw driving motion path retained; recovered pre-R16 baseline.'
  },
  current: {
    id: 'current',
    name: 'Current Workflow',
    subtitle: 'KOH (1) · 30 FPS · 6 steps · CFG 1',
    detail: 'Current Workflow dari file KOH (1) yang baru.'
  },
  koh1AntiObject: {
    id: 'koh1AntiObject',
    name: 'MotionFly R3 · Camera Stabilization',
    subtitle: 'MotionFly R3 · 35 FPS · 1080×1920 · 6 steps · CFG 1',
    detail: 'Stabilisasi driving video sebelum SCAIL-2. Dua input, tanpa clean background. Memerlukan node video_stabilizer_classic terpasang di RunningHub; kamera akhir belum terbukti statis.'
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

async function createTask({ apiKey, workflowId, workflowKey, mode, imageFile, videoFile }) {
  const imageName = await uploadToRunningHub(apiKey, imageFile);
  const videoName = await uploadToRunningHub(apiKey, videoFile);
  const payload = {
    apiKey,
    workflowId,
    nodeInfoList: [
      { nodeId: '30', fieldName: 'image', fieldValue: imageName },
      { nodeId: '33', fieldName: 'video', fieldValue: videoName },
      { nodeId: '331', fieldName: 'seed', fieldValue: 50 },
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
    if (Number(status.remainCoins || 0) < MIN_POOL_CREDITS) {
      return res.status(400).json({ error: `Akun tidak ditambahkan karena kredit di bawah ${MIN_POOL_CREDITS} RH.` });
    }
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
  const next = accounts.filter(a => a.id !== req.params.id);
  if (next.length === accounts.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
  next.forEach((a, i) => { a.name = `Account ${String(i + 1).padStart(2, '0')}`; });
  saveVaultAccounts(deviceId, next);
  res.json({ ok: true });
});

app.post('/api/accounts/refresh', async (req, res) => {
  const { deviceId, accounts } = getPersistentAccounts(req);
  if (!deviceId) return res.status(400).json({ error: 'Device session tidak tersedia. Reload halaman.' });

  const checked = await Promise.all(accounts.map(async account => {
    try {
      const status = await accountStatus(account.key);
      return { account, status, remove: Number(status.remainCoins || 0) < MIN_POOL_CREDITS };
    } catch (error) {
      return { account, status: { error: error.message }, remove: false };
    }
  }));

  const kept = checked.filter(x => !x.remove).map(x => x.account);
  const removed = checked.filter(x => x.remove).map(x => x.account.name);

  if (removed.length) {
    saveVaultAccounts(deviceId, kept);
  }

  const publicAccounts = checked
    .filter(x => !x.remove)
    .map(x => publicAccount(x.account, x.status));

  res.json({
    accounts: publicAccounts,
    autoRemovedCount: removed.length,
    minimumCredits: MIN_POOL_CREDITS,
  });
});

app.post('/api/generate', upload.fields([
  { name: 'referenceImage', maxCount: 1 },
  { name: 'videoReference', maxCount: 1 },
]), async (req, res) => {
  const imageFile = req.files?.referenceImage?.[0];
  const videoFile = req.files?.videoReference?.[0];
  const cleanup = () => {
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
    if (!['lite', 'standard'].includes(mode)) throw new Error('Mode RunningHub tidak dikenali.');

    const { deviceId, accounts } = getPersistentAccounts(req);
    if (!deviceId) throw new Error('Device session tidak tersedia. Reload halaman.');
    if (!accounts.length) throw new Error('Belum ada RunningHub API key di Account Pool.');

    let candidates = accounts;
    if (requestedAccountId !== 'auto') {
      candidates = accounts.filter(a => a.id === requestedAccountId);
      if (!candidates.length) throw new Error('Akun yang dipilih tidak ditemukan.');
    } else {
      const ranked = await Promise.all(accounts.map(async a => {
        try { return { a, s: await accountStatus(a.key) }; }
        catch { return { a, s: { currentTaskCounts: 999999, remainCoins: -1 } }; }
      }));
      ranked.sort((x, y) => (x.s.currentTaskCounts - y.s.currentTaskCounts) || (y.s.remainCoins - x.s.remainCoins));
      candidates = ranked.map(x => x.a);
    }

    let lastError = null;
    for (const account of candidates) {
      try {
        const task = await createTask({
          apiKey: account.key,
          workflowId: LOCKED_WORKFLOW_ID,
          workflowKey,
          mode,
          imageFile,
          videoFile,
        });
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
  const output = data.data.find(x => String(x.fileType || '').toLowerCase().includes('video')) || data.data[0];
  const fileUrl = String(output?.fileUrl || '');
  if (!/^https?:\/\//i.test(fileUrl)) {
    const err = new Error('URL hasil video tidak valid.');
    err.statusCode = 502;
    throw err;
  }
  return fileUrl;
}

app.post('/api/tasks/:taskId', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.body?.accountId || '');
  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Akun task tidak ditemukan dalam sesi.' });
  try {
    const data = await rhJson('/task/openapi/outputs', account.key, { apiKey: account.key, taskId: req.params.taskId }, 30000);
    const code = Number(data?.code);
    if (code === 0 && Array.isArray(data?.data) && data.data.length) {
      const outputs = data.data.map(x => ({ fileUrl: x.fileUrl, fileType: x.fileType, nodeId: x.nodeId ?? null })).filter(x => x.fileUrl);
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

app.get('/api/tasks/:taskId/preview', async (req, res) => {
  const { accounts } = getPersistentAccounts(req);
  const accountId = String(req.query?.accountId || '');
  const account = accounts.find(a => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Akun task tidak ditemukan.' });

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
app.listen(PORT, '0.0.0.0', () => console.log(`VANTA Motion Studio listening on :${PORT}`));
