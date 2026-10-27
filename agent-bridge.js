import express from 'express';

// Internal VANTA-to-Agent bridge. User identity comes ONLY from global VANTA Owner auth.
export function createAgentBridge({ isOwner = () => false } = {}) {
  const router = express.Router();
  const internalToken = process.env.AGENT_INTERNAL_TOKEN || '';
  const target = process.env.VANTA_AGENT_PRIVATE_URL || '';
  const ready = internalToken.length >= 32 && (() => {
    try {
      const url = new URL(target);
      return url.protocol === 'http:' && (url.hostname.endsWith('.railway.internal') ||
        (process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(url.hostname)));
    } catch { return false; }
  })();
  const sameOrigin = req => {
    const origin = req.get('origin');
    if (!origin) return true;
    try {
      const url = new URL(origin);
      return url.host === req.get('host') &&
        (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:'));
    } catch { return false; }
  };
  const allowedPaths = [
    /^\/v1\/(status|browser\/status|audit|tasks|memories|skills|incidents|discussions)$/,
    /^\/v1\/tasks\/[0-9a-f-]{36}$/,
    /^\/v1\/tasks\/[0-9a-f-]{36}\/(approve|reject|pause|resume|cancel|checkpoint|inspect)$/,
    /^\/v1\/skills\/[0-9a-f-]{36}\/(verify|reject)$/
  ];
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!ready) return res.status(503).json({ error: 'Service AI Agent belum tersedia.' });
    if (!isOwner(req)) return res.status(401).json({ error: 'Silakan login ke VANTA.' });
    next();
  });
  router.use('/bridge', async (req, res) => {
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method tidak tersedia.' });
    if (req.method === 'POST' && (req.get('x-vanta-agent') !== '1' || !sameOrigin(req)))
      return res.status(403).json({ error: 'Permintaan ditolak.' });
    const remote = req.path;
    if (!allowedPaths.some(x => x.test(remote))) return res.status(404).json({ error: 'Endpoint tidak tersedia.' });
    const endpoint = new URL(remote + (req.method === 'GET' && req.url.includes('?') ? '?' + req.url.split('?')[1] : ''), target);
    try {
      const upstream = await fetch(endpoint, { method: req.method,
        headers: { authorization: 'Bearer ' + internalToken, 'Content-Type': 'application/json' },
        body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
        signal: AbortSignal.timeout(remote.endsWith('/inspect') ? 65000 : 14000), redirect: 'error' });
      const response = await upstream.text();
      if (response.length > 512 * 1024) return res.status(502).json({ error: 'Respons backend terlalu besar.' });
      res.status(upstream.status).type('application/json').send(response);
    } catch (error) {
      console.warn('Agent private API unavailable:', String(error?.cause?.code || error?.name || 'network_error').slice(0,80));
      res.status(502).json({ error: 'Service AI Agent belum dapat dihubungi.' });
    }
  });
  return router;
}
