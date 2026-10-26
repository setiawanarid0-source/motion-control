import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'vanta_owner_session';
const ttl = 24 * 60 * 60 * 1000;
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const digest = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
const timestamp = () => Date.now();

export function createOwnerAuth({ dataDir = process.env.VANTA_DATA_DIR || '/data', initialPassword = process.env.VANTA_AGENT_OWNER_KEY || '',
  token = process.env.AGENT_INTERNAL_TOKEN || '' } = {}) {
  if (typeof initialPassword !== 'string' || initialPassword.length < 20 || typeof token !== 'string' || token.length < 32) {
    throw new Error('VANTA Owner authentication requires strong secrets in Railway Variables');
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(dataDir, 'owner-login.json');
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved?.schema !== 1 || typeof saved.salt !== 'string' ||
      !/^[a-f0-9]{64}$/.test(saved.hash) || !/^[a-f0-9]{32}$/.test(saved.version)) throw Error('Invalid owner auth state');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // corrupted state must never allow bootstrap again
    saved = null;
  }
  const sessionKey = crypto.createHmac('sha256', token).update('vanta-global-owner-session-v1:' + initialPassword).digest();
  const denied = new Map();
  const router = express.Router();
  const verified = password => typeof password === 'string' && password.length <= 1024 &&
    (saved ? safeEqual(digest(password, saved.salt), saved.hash) : safeEqual(password, initialPassword));
  const version = () => saved?.version || 'bootstrap';
  const isOwner = req => {
    const raw = req.cookies?.[COOKIE];
    if (typeof raw !== 'string' || raw.length > 300) return false;
    const match = /^(\d{13})\.([a-f0-9]{9,32}|bootstrap)\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(raw);
    if (!match || Number(match[1]) <= timestamp() || Number(match[1]) > timestamp() + ttl || match[2] !== version()) return false;
    const prefix = [match[1], match[2], match[3]].join('.');
    const signature = crypto.createHmac('sha256', sessionKey).update(prefix).digest('hex');
    return safeEqual(signature, match[4]);
  };
  const secureCookie = req => process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https';
  const cookieOptions = req => ({ httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/', maxAge: ttl });
  function signCookie() {
    const prefix = [String(timestamp() + ttl), version(), crypto.randomBytes(16).toString('hex')].join('.');
    return prefix + '.' + crypto.createHmac('sha256', sessionKey).update(prefix).digest('hex');
  }
  function csrf(req) {
    if (req.get('x-vanta-auth') !== '1') return false;
    const origin = req.get('origin');
    if (!origin) return true; // custom header prevents cross-site HTML form submissions
    try {
      const url = new URL(origin);
      return url.host === req.get('host') &&
        (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:'));
    } catch { return false; }
  }
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/session', (req, res) => res.json({ authenticated: isOwner(req), requiresPasswordChange: isOwner(req) && !saved }));
  router.post('/login', (req, res) => {
    if (!csrf(req)) return res.status(403).json({ error: 'Permintaan tidak valid.' });
    const ip = req.ip || 'unknown';
    const record = denied.get(ip) || { tries: 0, until: 0 };
    if (record.until > timestamp()) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
    if (!verified(req.body?.password)) {
      record.tries += 1;
      if (record.tries >= 5) { record.until = timestamp() + 15 * 60 * 1000; record.tries = 0; }
      denied.set(ip, record);
      return res.status(401).json({ error: 'Password tidak sesuai.' });
    }
    denied.delete(ip);
    res.cookie(COOKIE, signCookie(), cookieOptions(req));
    return res.json({ authenticated: true, requiresPasswordChange: !saved });
  });
  router.post('/change-password', (req, res) => {
    if (!csrf(req) || !isOwner(req)) return res.status(401).json({ error: 'Autentikasi diperlukan.' });
    const { oldPassword, newPassword } = req.body || {};
    if (!verified(oldPassword) || typeof newPassword !== 'string' || newPassword.length < 16 ||
      newPassword.length > 256 || newPassword === oldPassword) {
      return res.status(400).json({ error: 'Password lama atau password baru tidak valid. Minimum 16 karakter.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const next = { schema: 1, salt, hash: digest(newPassword, salt), version: crypto.randomBytes(16).toString('hex') };
    const temp = stateFile + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, stateFile);
      saved = next;
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      console.error('Owner password storage failed:', error.code || error.name);
      return res.status(500).json({ error: 'Perubahan password gagal disimpan.' });
    }
    res.cookie(COOKIE, signCookie(), cookieOptions(req));
    return res.json({ authenticated: true, requiresPasswordChange: false });
  });
  router.post('/logout', (req, res) => {
    if (!csrf(req)) return res.status(403).json({ error: 'Permintaan ditolak.' });
    res.clearCookie(COOKIE, { httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/' });
    return res.json({ authenticated: false });
  });
  function requireOwner(req, res, next) {
    if (req.path === '/health') return next(); // preserve Railway health checks
    if (isOwner(req) && saved) return next();
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Silakan login ke VANTA terlebih dahulu.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(401).json({ error: 'Login diperlukan.' });
    const back = req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//') ? req.originalUrl : '/';
    return res.redirect(302, '/login.html?next=' + encodeURIComponent(back));
  }
  return { router, requireOwner, isOwner };
}
