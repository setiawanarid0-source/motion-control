import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createAgentBridge } from '../agent-bridge.js';

const listen = async app => {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
};
test('VANTA Agent requires strong Owner gate and limits private proxy paths', async () => {
  const token = 'agent-test-internal-token-not-for-production-987654';
  const password = 'owner-test-only-long-password-123456789';
  const agent = express();
  agent.use(express.json());
  agent.get('/v1/status', (req, res) => {
    assert.equal(req.get('authorization'), 'Bearer ' + token);
    res.json({ worker: 'not_installed', executionEnabled: false });
  });
  agent.post('/v1/tasks', (req, res) => {
    assert.equal(req.get('authorization'), 'Bearer ' + token);
    res.status(201).json({ task: { instruction: req.body.instruction } });
  });
  const upstream = await listen(agent);
  process.env.AGENT_INTERNAL_TOKEN = token;
  process.env.VANTA_AGENT_OWNER_KEY = password;
  process.env.VANTA_AGENT_PRIVATE_URL = upstream.origin;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/agent', createAgentBridge());
  const web = await listen(app);
  const send = async (path, method = 'GET', body, cookie, extra = {}) =>
    fetch(web.origin + '/api/agent/' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json', 'X-Vanta-Agent': '1' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
  try {
    assert.equal((await send('bridge/v1/status')).status, 401);
    assert.equal((await send('login','POST',{password:'bad'})).status, 401);
    const correct = await send('login','POST',{password});
    assert.equal(correct.status, 200);
    const cookie = correct.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /vanta_agent_owner/);
    const probe = await send('bridge/v1/status', 'GET', undefined, cookie);
    assert.equal(probe.status, 200);
    assert.equal((await probe.json()).executionEnabled, false);
    assert.equal((await send('bridge/../../health', 'GET', undefined, cookie)).status, 404);
    assert.equal((await send('bridge/v1/tasks', 'POST', { instruction:'test' }, cookie,
      { 'X-Vanta-Agent': '0' })).status, 403);
    const created = await send('bridge/v1/tasks', 'POST', { instruction: 'test' }, cookie);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).task.instruction, 'test');
    const crossSite = await send('bridge/v1/tasks','POST',{instruction:'test'},cookie,
      {Origin:'https://attacker.example'});
    assert.equal(crossSite.status, 403);
    const loggedOut = await send('logout', 'POST', {}, cookie, { 'X-Vanta-Agent': '1' });
    assert.equal(loggedOut.status, 200);
  } finally {
    await Promise.all([new Promise(r=>web.server.close(r)),new Promise(r=>upstream.server.close(r))]);
    delete process.env.AGENT_INTERNAL_TOKEN;
    delete process.env.VANTA_AGENT_OWNER_KEY;
    delete process.env.VANTA_AGENT_PRIVATE_URL;
  }
});
