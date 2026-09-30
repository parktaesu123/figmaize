import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBridge } from '../server/bridge.mjs';

const TOKEN = 'test-pairing-token-with-at-least-24-characters';
const capture = () => ({ format: 'layer-bridge', version: 1, viewport: { width: 390, height: 844 }, nodes: [{ id: 'card', type: 'frame', name: 'Card', bounds: { x: 0, y: 0, width: 300, height: 200 } }] });

async function fixture(t, options = {}) {
  let time = 1_000_000;
  const bridge = createBridge({ token: TOKEN, now: () => time, ...options });
  t.after(() => new Promise(resolve => {
    bridge.server.closeAllConnections();
    bridge.server.close(resolve);
  }));
  await new Promise((resolve, reject) => {
    bridge.server.once('error', reject);
    bridge.server.listen(0, '127.0.0.1', resolve);
  });
  const port = bridge.server.address().port;
  async function request(route, { method = 'GET', json, raw, auth = true, headers = {} } = {}) {
    const data = raw ?? (json === undefined ? undefined : JSON.stringify(json));
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: {
        ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
        ...headers
      } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : undefined });
        });
      });
      req.on('error', reject);
      req.end(data);
    });
  }
  async function connect(clientId = 'client-one', pageId = 'page:1') {
    const result = await request('/v1/connect', { method: 'POST', json: { clientId, document: { name: 'Fixture file', pageName: 'Fixture page', pageId } } });
    assert.equal(result.status, 200);
    return result.body.sessionId;
  }
  async function command(operation = 'get_document', payload = {}, sessionId) {
    return request('/v1/commands', { method: 'POST', json: { operation, payload, sessionId } });
  }
  const poll = sessionId => request(`/v1/poll?sessionId=${encodeURIComponent(sessionId)}`);
  const result = json => request('/v1/result', { method: 'POST', json });
  const job = id => request(`/v1/jobs/${id}`);
  return { ...bridge, request, connect, command, poll, result, job, advance: delta => { time += delta; } };
}

test('bridge requires a long pairing token', () => {
  for (const token of [undefined, '', 'short']) assert.throws(() => createBridge({ token }), /24/);
});

test('HTTP bridge enforces the exact loopback host and pairing token', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health', { auth: false })).status, 401);
  assert.equal((await f.request('/health', { headers: { Authorization: 'Bearer incorrect' } })).status, 401);
  assert.equal((await f.request('/health', { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await f.request('/health', { headers: { Host: `localhost:${f.server.address().port}` } })).status, 200);
  const good = await f.request('/health');
  assert.equal(good.status, 200);
  assert.equal(good.body.name, 'layer-bridge');
  assert.equal(good.body.sessions, 0);
  assert.equal(good.headers['cache-control'], 'no-store');
  assert.equal(good.headers['x-content-type-options'], 'nosniff');
});

test('Origin allowlist and unauthenticated preflight do not bypass authenticated requests', async t => {
  const f = await fixture(t);
  for (const origin of ['null', 'https://figma.com', 'https://www.figma.com', `chrome-extension://${'a'.repeat(32)}`]) {
    const preflight = await f.request('/v1/connect', { method: 'OPTIONS', auth: false, headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);
    assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
    assert.equal((await f.request('/health', { auth: false, headers: { Origin: origin } })).status, 401);
  }
  for (const origin of ['https://figma.com.attacker.example', 'http://figma.com', 'https://attacker.example', `chrome-extension://${'z'.repeat(32)}`]) {
    const denied = await f.request('/health', { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  }
});

test('HTTP writes require JSON objects and validated connection metadata', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/v1/connect', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  for (const raw of ['{broken', 'null', '[]', '"string"']) {
    assert.equal((await f.request('/v1/connect', { method: 'POST', raw })).status, 400);
  }
  for (const json of [{}, { clientId: 'short', document: { pageId: '1' } }, { clientId: 'valid-client', document: {} }]) {
    assert.equal((await f.request('/v1/connect', { method: 'POST', json })).status, 400);
  }
  assert.equal((await f.request('/nonexistent')).status, 404);
});

test('session selection rejects missing and ambiguous targets and supports explicit targeting', async t => {
  const f = await fixture(t);
  assert.equal((await f.command()).status, 409);
  const first = await f.connect();
  assert.equal((await f.command()).body.sessionId, first);
  const second = await f.connect('client-two', 'page:2');
  assert.equal((await f.command()).status, 409);
  const chosen = await f.command('get_document', {}, second);
  assert.equal(chosen.status, 202);
  assert.equal(chosen.body.sessionId, second);
  assert.equal(chosen.body.payload, undefined);
  assert.equal((await f.command('get_document', {}, 'not-connected')).status, 404);
  const sessions = (await f.request('/v1/sessions')).body.sessions;
  assert.deepEqual(sessions.map(s => s.document.pageId), ['page:1', 'page:2']);
  assert.ok(sessions.every(s => s.connected && !('clientId' in s)));
});

test('queue validates commands and captures before adding jobs', async t => {
  const f = await fixture(t);
  const sessionId = await f.connect();
  for (const [operation, payload] of [['delete_page', {}], ['inspect_node', {}], ['update_node', { nodeId: 12 }], ['export_png', { nodeId: '' }], ['import_capture', { capture: {} }], ['get_document', []]]) {
    const response = await f.command(operation, payload, sessionId);
    assert.equal(response.status, 400);
  }
  assert.equal(f.jobs.size, 0);
  for (let i = 0; i < 20; i++) assert.equal((await f.command('get_document', {}, sessionId)).status, 202);
  assert.equal((await f.command('get_document', {}, sessionId)).status, 429);
});

test('mutations bind the target page at enqueue time and ignore a caller supplied page', async t => {
  const f = await fixture(t);
  const sessionId = await f.connect('client-one', 'page:trusted');
  const mutation = await f.command('update_node', { nodeId: '4:2', changes: { name: 'Updated' }, expectedPageId: 'page:attacker' }, sessionId);
  const dispatched = (await f.poll(sessionId)).body.job;
  assert.equal(dispatched.id, mutation.body.id);
  assert.equal(dispatched.payload.expectedPageId, 'page:trusted');
  await f.result({ sessionId, jobId: dispatched.id, ok: true, result: { id: '4:2' } });
  const imported = await f.request('/v1/captures', { method: 'POST', json: { sessionId, capture: capture(), reference: false } });
  assert.equal(imported.status, 202);
  const captureJob = (await f.poll(sessionId)).body.job;
  assert.equal(captureJob.payload.expectedPageId, 'page:trusted');
  assert.equal(captureJob.payload.options.reference, false);
});

test('jobs dispatch once, serialize per session, and accept an idempotent result', async t => {
  const f = await fixture(t);
  const sessionId = await f.connect();
  const first = (await f.command('get_document', {}, sessionId)).body;
  const second = (await f.command('get_selection', {}, sessionId)).body;
  assert.equal((await f.result({ sessionId, jobId: first.id, ok: true })).status, 409);
  assert.equal((await f.job(first.id)).body.payload, undefined);
  assert.equal((await f.poll(sessionId)).body.job.id, first.id);
  assert.equal((await f.poll(sessionId)).body.job, null);
  assert.equal((await f.result({ sessionId, jobId: first.id, ok: 'yes' })).status, 409);
  const finished = await f.result({ sessionId, jobId: first.id, ok: true, result: { pageId: 'page:1' } });
  assert.deepEqual(finished.body, { accepted: true });
  assert.equal((await f.job(first.id)).body.status, 'complete');
  assert.equal(f.jobs.get(first.id).payload, undefined);
  const duplicate = await f.result({ sessionId, jobId: first.id, ok: false, error: 'must not overwrite' });
  assert.deepEqual(duplicate.body, { accepted: true, duplicate: true });
  assert.deepEqual((await f.job(first.id)).body.result, { pageId: 'page:1' });
  assert.equal((await f.poll(sessionId)).body.job.id, second.id);
});

test('results cannot complete another session’s work and preserve bounded failure text', async t => {
  const f = await fixture(t);
  const first = await f.connect();
  const second = await f.connect('client-two', 'page:2');
  const job = (await f.command('get_document', {}, first)).body;
  await f.poll(first);
  assert.equal((await f.result({ sessionId: second, jobId: job.id, ok: true })).status, 404);
  assert.equal((await f.result({ sessionId: first, jobId: 'unknown-job', ok: true })).status, 404);
  assert.equal((await f.result({ sessionId: first, jobId: job.id, ok: false, error: 'x'.repeat(5000) })).status, 200);
  const failed = (await f.job(job.id)).body;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.length, 4000);
  assert.equal(failed.payload, undefined);
});

test('reconnection replaces the session and cancels old queued work without migrating a running job', async t => {
  const f = await fixture(t);
  const oldSession = await f.connect();
  const running = (await f.command('get_document', {}, oldSession)).body;
  await f.poll(oldSession);
  const queued = (await f.command('get_selection', {}, oldSession)).body;
  const replacement = await f.connect('client-one', 'page:2');
  assert.notEqual(replacement, oldSession);
  assert.equal((await f.poll(oldSession)).status, 404);
  assert.equal((await f.poll(replacement)).body.job, null);
  assert.equal((await f.job(queued.id)).body.status, 'failed');
  assert.equal((await f.job(running.id)).body.sessionId, oldSession);
  assert.deepEqual((await f.request('/v1/sessions')).body.sessions.map(s => s.id), [replacement]);
});

test('disconnect cancels queued jobs and rejects further polling', async t => {
  const f = await fixture(t);
  const sessionId = await f.connect();
  const job = (await f.command('get_document', {}, sessionId)).body;
  assert.equal((await f.request('/v1/disconnect', { method: 'POST', json: { sessionId } })).status, 200);
  assert.equal((await f.job(job.id)).body.status, 'failed');
  assert.equal((await f.poll(sessionId)).status, 404);
  assert.deepEqual((await f.request('/v1/sessions')).body.sessions, []);
});

test('stale sessions cannot receive queued mutations until the plugin polls again', async t => {
  const f = await fixture(t, { sessionTTL: 45, jobTTL: 1000 });
  const sessionId = await f.connect();
  f.advance(46);
  assert.deepEqual((await f.request('/v1/sessions')).body.sessions, []);
  assert.equal((await f.command('update_node', { nodeId: '2:1', changes: { name: 'New' } }, sessionId)).status, 409);
  assert.equal((await f.command()).status, 409);
  assert.equal((await f.poll(sessionId)).status, 200);
  assert.equal((await f.command('get_document', {}, sessionId)).status, 202);
});

test('an active running job keeps its session live until the job timeout', async t => {
  const f = await fixture(t, { sessionTTL: 45, jobTTL: 1000 });
  const sessionId = await f.connect();
  await f.command('get_document', {}, sessionId);
  await f.poll(sessionId);
  f.advance(100);
  assert.equal((await f.request('/v1/sessions')).body.sessions[0].id, sessionId);
});

test('unknown jobs allow inspection but block new and queued mutations until a late result', async t => {
  const f = await fixture(t, { sessionTTL: 10_000, jobTTL: 100 });
  const sessionId = await f.connect();
  const expired = (await f.command('get_document', {}, sessionId)).body;
  f.advance(101);
  assert.equal((await f.job(expired.id)).body.status, 'failed');
  assert.equal((await f.poll(sessionId)).body.job, null);
  const running = (await f.command('update_node', { nodeId: '2:1', changes: { name: 'Only once' } }, sessionId)).body;
  assert.equal((await f.poll(sessionId)).body.job.id, running.id);
  f.advance(50);
  const waitingMutation = (await f.command('update_node', { nodeId: '2:1', changes: { name: 'Later change' } }, sessionId)).body;
  f.advance(51);
  assert.equal((await f.job(running.id)).body.status, 'unknown');
  assert.equal(f.jobs.get(running.id).payload, undefined);
  assert.equal((await f.command('update_node', { nodeId: '2:1', changes: { name: 'Unsafe retry' } }, sessionId)).status, 409);
  assert.equal((await f.command('import_capture', { capture: capture() }, sessionId)).status, 409);
  const next = (await f.command('get_selection', {}, sessionId)).body;
  assert.equal((await f.poll(sessionId)).body.job.id, next.id);
  assert.equal((await f.job(waitingMutation.id)).body.status, 'queued');
  await f.result({ sessionId, jobId: next.id, ok: true, result: [] });
  assert.equal((await f.poll(sessionId)).body.job, null);
  await f.result({ sessionId, jobId: running.id, ok: true, result: { id: '2:1' } });
  assert.equal((await f.job(running.id)).body.status, 'complete');
  assert.equal((await f.poll(sessionId)).body.job.id, waitingMutation.id);
});

test('old settled jobs and inactive session records are eventually removed', async t => {
  const f = await fixture(t);
  const sessionId = await f.connect();
  const queued = (await f.command('get_document', {}, sessionId)).body;
  await f.poll(sessionId);
  await f.result({ sessionId, jobId: queued.id, ok: true, result: {} });
  f.advance(30 * 60 * 1000 + 1);
  assert.equal((await f.job(queued.id)).status, 404);
  assert.deepEqual((await f.request('/v1/sessions')).body.sessions, []);
  assert.equal(f.sessions.size, 0);
});
