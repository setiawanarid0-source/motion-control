import express from 'express';
import crypto from 'node:crypto';

// Isolated Owner authentication: VANTA's X-Vanta-Device is NOT an identity mechanism.
// This bridge is disabled until its three secrets are present in Railway Variables.
export function createAgentBridge() {
  const router = express.Router();
  const ownerKey = process.env.VANTA_AGENT_OWNER_KEY || '';
  const internalToken = process.env.AGENT_INTERNAL_TOKEN || '';
  const target = process.env.VANTA_AGENT_PRIVATE_URL || '';
  const ready = ownerKey.length >= 20 && internalToken.length >= 32 && /^https?:\/\//.test(target) && (() => {
    try {
      const u = new URL(target);
      return u.protocol === 'http:' && (u.hostname.endsWith('.railway.internal') ||
        (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(u.hostname)));
    } catch { return false; }
  })();
  const signatureKey = crypto.createHash('sha256').update(ownerKey + ':' + internalToken + ':owner-session-v1').digest();
  const failures = new Map();
  const cookieName = 'vanta_agent_owner';
  function match(a, b) {
    const x = crypto.createHash('sha256').update(String(a)).digest();
    const y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
  }
  function issueCookie() {
    const exp = Date.now() + 2 * 60 * 60 * 1000;
    const nonce = crypto.randomBytes(16).toString('hex');
    const prefix = exp + '.' + nonce;
    const sig = crypto.createHmac('sha256', signatureKey).update(prefix).digest('hex');
    return prefix + '.' + sig;
  }
  function owner(req) {
    const raw = req.cookies?.[cookieName];
    if (typeof raw !== 'string' || raw.length > 200) return false;
    const matchParts = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(raw);
    if (!matchParts || Number(matchParts[1]) < Date.now()) return false;
    const prefix = matchParts[1] + '.' + matchParts[2];
    const sig = crypto.createHmac('sha256', signatureKey).update(prefix).digest('hex');
    return match(matchParts[3], sig);
  }
  function sameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return true; // Requires additional custom header for every mutation.
    try {
      const url = new URL(origin);
      const host = req.get('host');
      return (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) &&
        url.host === host;
    } catch { return false; }
  }
  function mutationAllowed(req) {
    return req.get('x-vanta-agent') === '1' && sameOrigin(req);
  }
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!ready) return res.status(503).json({ error: 'AI Agent belum dikonfigurasi pada Railway.' });
    next();
  });
  router.get('/auth', (req, res) => res.json({ authenticated: owner(req) }));
  router.post('/login', (req, res) => {
    if (!mutationAllowed(req)) return res.status(403).json({ error: 'Permintaan login ditolak.' });
    const address = req.ip || 'unknown';
    const entry = failures.get(address) || { count: 0, until: 0 };
    if (entry.until > Date.now()) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
    if (typeof req.body?.password !== 'string' || !match(req.body.password, ownerKey)) {
      entry.count += 1;
      if (entry.count >= 5) { entry.until = Date.now() + 15 * 60 * 1000; entry.count = 0; }
      failures.set(address, entry);
      return res.status(401).json({ error: 'Kata sandi Owner tidak sesuai.' });
    }
    failures.delete(address);
    res.cookie(cookieName, issueCookie(), { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/api/agent', maxAge: 2 * 60 * 60 * 1000 });
    res.json({ authenticated: true });
  });
  router.post('/logout', (req, res) => {
    if (!mutationAllowed(req)) return res.status(403).json({ error: 'Ditolak.' });
    res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/api/agent' });
    res.json({ authenticated: false });
  });
  const allowedPaths = [
    /^\/v1\/(status|browser\/status|audit|tasks|memories|skills|incidents|discussions)$/,
    /^\/v1\/tasks\/[0-9a-f-]{36}$/,
    /^\/v1\/tasks\/[0-9a-f-]{36}\/(approve|reject|pause|resume|cancel|checkpoint|inspect)$/,
    /^\/v1\/skills\/[0-9a-f-]{36}\/(verify|reject)$/
  ];
  router.use('/bridge', async (req, res) => {
    if (!owner(req)) return res.status(401).json({ error: 'Login Owner diperlukan.' });
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method tidak tersedia.' });
    if (req.method === 'POST' && !mutationAllowed(req)) return res.status(403).json({ error: 'Permintaan ditolak.' });
    const remotePath = req.path;
    if (!allowedPaths.some(r => r.test(remotePath))) return res.status(404).json({ error: 'Endpoint tidak tersedia.' });
    const endpoint = new URL(remotePath + (req.method === 'GET' && req.url.includes('?') ? '?' + req.url.split('?')[1] : ''), target);
    try {
      const upstream = await fetch(endpoint, {
        method: req.method,
        headers: { authorization: 'Bearer ' + internalToken, 'Content-Type': 'application/json' },
        body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
        signal: AbortSignal.timeout(14000), redirect: 'error'
      });
      const response = await upstream.text();
      if (response.length > 512 * 1024) return res.status(502).json({ error: 'Respons backend terlalu besar.' });
      res.status(upstream.status);
      res.type('application/json').send(response);
    } catch (error) {
      console.warn('Agent private API unavailable:', String(error?.cause?.code || error?.name || 'network_error').slice(0,80));
      res.status(502).json({ error: 'Service AI Agent belum dapat dihubungi.' });
    }
  });
  return router;
}
