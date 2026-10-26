import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createOwnerAuth } from '../owner-auth.js';
import { createAgentBridge } from '../agent-bridge.js';
const listen = async app => {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
};
const close = server => new Promise(r => server.close(r));
test('One VANTA Owner login protects studio, pools and Agent; first login forces password change', { timeout: 20000 }, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const dir = await mkdtemp(path.join(tmpdir(), 'vanta-owner-auth-'));
  const bootstrap = 'example-initial-password-for-test-only-12345';
  const changed = 'new-test-vanta-password-67890-strong';
  const token = 'agent-test-internal-token-not-for-production-987654';
  const agent = express();
  agent.use(express.json());
  agent.get('/v1/status', (req, res) => {
    assert.equal(req.get('authorization'), 'Bearer ' + token);
    res.json({ executionEnabled: false });
  });
  const upstream = await listen(agent);
  process.env.AGENT_INTERNAL_TOKEN = token;
  process.env.VANTA_AGENT_PRIVATE_URL = upstream.origin;
  const auth = createOwnerAuth({ dataDir: dir, initialPassword: bootstrap, token });
  const webapp = express();
  webapp.use(express.json());
  webapp.use(cookieParser());
  webapp.use('/api/auth',auth.router);
  webapp.get('/health',(_req,res)=>res.json({ok:true}));
  webapp.get('/login.html',(_req,res)=>res.status(200).end('Login UI'));
  webapp.use(auth.requireOwner);
  webapp.use('/api/agent',createAgentBridge({isOwner:auth.isOwner}));
  webapp.get('/api/session',(_req,res)=>res.json({allowed:true}));
  webapp.get('/',(_req,res)=>res.status(200).end('VANTA Studio'));
  const web = await listen(webapp);
  async function send(uri, options={}) {
    return fetch(web.origin+uri, { redirect:'manual', ...options });
  }
  const post = async(uri,payload,cookie,extra={})=>send(uri,{method:'POST',
    headers:{'X-Vanta-Auth':'1','X-Vanta-Agent':'1','Content-Type':'application/json',
      ...(cookie?{Cookie:cookie}:{}),...extra},
    body:JSON.stringify(payload)});
  let cookie;
  try {
    assert.equal((await send('/')).status,302);
    assert.equal((await send('/api/session')).status,401);
    assert.equal((await send('/api/agent/bridge/v1/status')).status,401);
    assert.equal((await send('/health')).status,200);
    assert.equal((await send('/login.html')).status,200);
    assert.equal((await post('/api/auth/login',{password:'wrong'})).status,401);
    const login = await post('/api/auth/login',{password:bootstrap});
    assert.equal(login.status,200);
    cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await login.json()).requiresPasswordChange,true);
    assert.equal((await send('/',{headers:{Cookie:cookie}})).status,302);
    const mismatch=await post('/api/auth/change-password',{oldPassword:bootstrap,newPassword:changed},cookie,{Origin:'https://evil.example'});
    assert.equal(mismatch.status,401);
    const changedResponse=await post('/api/auth/change-password',{oldPassword:bootstrap,newPassword:changed},cookie);
    assert.equal(changedResponse.status,200);
    const oldCookie=cookie;
    cookie=changedResponse.headers.get('set-cookie').split(';')[0];
    assert.equal((await send('/',{headers:{Cookie:oldCookie}})).status,302);
    assert.equal((await send('/',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await send('/api/session',{headers:{Cookie:cookie}})).status,200);
    const probe=await send('/api/agent/bridge/v1/status',{headers:{Cookie:cookie}});
    assert.equal(probe.status,200);
    assert.equal((await probe.json()).executionEnabled,false);
    const cross=await post('/api/agent/bridge/v1/tasks',{instruction:'test'},cookie,{Origin:'https://evil.example'});
    assert.equal(cross.status,403);
    const fresh= createOwnerAuth({dataDir:dir,initialPassword:bootstrap,token});
    assert.equal(fresh.isOwner({cookies:{vanta_owner_session:cookie.split('=')[1]}}),true);
    const wrong=await post('/api/auth/login',{password:bootstrap});
    assert.equal(wrong.status,401);
    const logout=await post('/api/auth/logout',{},cookie);
    assert.equal(logout.status,200);
    assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  } finally {
    await Promise.all([close(web.server),close(upstream.server)]);
    await rm(dir,{recursive:true,force:true});
    delete process.env.AGENT_INTERNAL_TOKEN;
    delete process.env.VANTA_AGENT_PRIVATE_URL;
    if(previousNodeEnv===undefined)delete process.env.NODE_ENV;
    else process.env.NODE_ENV=previousNodeEnv;
  }
});
