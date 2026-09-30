import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./popup.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const connected = id => ({ id, connected: true, document: { name: `File ${id}`, pageName: 'Page 1', pageId: 'page' } });
function fixture(responses) {
  const history = [], requests = [], events = new Map();
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.disabled = false; this.hidden = false; this.dataset = {}; this.options = []; }
    set textContent(value) { this.text = value; if (this.id === 'status') history.push(value); }
    get textContent() { return this.text; }
    addEventListener(type, listener) { events.set(`${this.id}:${type}`, listener); }
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    add(option) { this.options.push(option); }
  }
  const ids = ['capture', 'refresh', 'check-job', 'token', 'session', 'status', 'name', 'result', 'download', 'stats'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const collected = {
    title: 'A page', viewport: { width: 390, height: 844 }, warnings: [],
    nodes: [{ id: 'n1', type: 'image', name: 'photo', needsRaster: true, bounds: { x: 10, y: 20, width: 100, height: 100 } }],
  };
  const context = vm.createContext({
    document: {
      querySelector: selector => elements[selector.slice(1)],
      createElement: type => { assert.equal(type, 'canvas'); return { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,crop' }; },
    },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    Image: class { naturalWidth = 780; naturalHeight = 1688; async decode() {} },
    Blob, AbortController,
    URL: { createObjectURL: () => 'blob:backup', revokeObjectURL() {} },
    setTimeout: (fn, ms) => ms === 1000 ? (queueMicrotask(fn), 0) : setTimeout(fn, ms),
    clearTimeout,
    chrome: {
      tabs: { query: async () => [{ id: 4, windowId: 1, url: 'https://example.com' }], captureVisibleTab: async () => 'data:image/png;base64,screen' },
      scripting: { executeScript: async options => options.files ? [{}] : [{ result: structuredClone(collected) }] },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.ok(responses.length, `Unexpected request ${url}`);
      const next = responses.shift();
      return { ok: next.http ? next.http < 400 : true, status: next.http || 200, json: async () => next.body ?? next };
    },
  });
  vm.runInContext(source, context);
  return {
    elements, requests, history,
    async emit(id, type) { await events.get(`${id}:${type}`)(); },
    async connect() { elements.token.value = 'test-pairing-token'; await events.get('token:input')(); await events.get('refresh:click')(); },
  };
}

test('extension grants only active-tab capture and the local bridge host', () => {
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4318/*']);
});

test('only connected sessions are offered and multiple files require selection', async () => {
  const app = fixture([{ sessions: [connected('a'), connected('b'), { id: 'old', connected: false }] }]);
  await app.connect();
  assert.equal(app.elements.session.value, '');
  assert.equal(app.elements.capture.disabled, true);
  assert.equal(app.elements.session.options.length, 3);
  app.elements.session.value = 'b';
  await app.emit('session', 'change');
  assert.equal(app.elements.capture.disabled, false);
  assert.equal(app.requests[0].options.headers.Authorization, 'Bearer test-pairing-token');
});

test('no plugin sessions leaves capture disabled with connection instructions', async () => {
  const app = fixture([{ sessions: [] }]);
  await app.connect();
  assert.equal(app.elements.capture.disabled, true);
  assert.match(app.elements.status.textContent, /플러그인.*연결/);
});

test('screenshot/raster capture goes directly to target and waits for actual completion', async () => {
  const app = fixture([
    { sessions: [connected('figma')] }, { jobId: 'job/1', status: 'queued' },
    { id: 'job/1', status: 'queued' }, { id: 'job/1', status: 'running' }, { id: 'job/1', status: 'complete' },
  ]);
  await app.connect();
  app.elements.name.value = '상품 상세';
  await app.emit('capture', 'click');
  const submitted = JSON.parse(app.requests[1].options.body);
  assert.equal(app.requests[1].url, 'http://127.0.0.1:4318/v1/captures');
  assert.equal(submitted.sessionId, 'figma');
  assert.equal(submitted.reference, true);
  assert.equal(submitted.capture.title, '상품 상세');
  assert.equal(submitted.capture.screenshot, 'data:image/png;base64,screen');
  assert.equal(submitted.capture.nodes[0].image, 'data:image/png;base64,crop');
  assert.equal(submitted.capture.nodes[0].needsRaster, undefined);
  assert.equal(app.requests[2].url, 'http://127.0.0.1:4318/v1/jobs/job%2F1');
  assert.ok(app.history.some(message => /접수.*기다리고/.test(message)));
  assert.ok(app.history.some(message => /생성하고 있습니다/.test(message)));
  assert.match(app.elements.status.textContent, /생성을 완료/);
  assert.equal(app.elements.result.hidden, false);
  assert.equal(app.elements.capture.disabled, false);
  assert.equal(app.elements['check-job'].hidden, true);
});

test('unknown jobs never claim success or automatically resubmit; explicit status retry works', async () => {
  const app = fixture([
    { sessions: [connected('figma')] }, { jobId: 'job1', status: 'queued' }, { id: 'job1', status: 'unknown' },
    { id: 'job1', status: 'complete' },
  ]);
  await app.connect();
  await app.emit('capture', 'click');
  assert.equal(app.elements.capture.disabled, true);
  assert.equal(app.elements['check-job'].hidden, false);
  assert.match(app.elements.status.textContent, /완료로 처리하지 않았/);
  assert.equal(app.requests.filter(request => request.options.method === 'POST').length, 1);
  await app.emit('check-job', 'click');
  assert.equal(app.elements.capture.disabled, false);
  assert.match(app.elements.status.textContent, /생성을 완료/);
});

test('rejected pairing prevents capture and changing the token invalidates targets', async () => {
  const app = fixture([{ http: 401, body: { error: 'Unauthorized' } }, { sessions: [connected('figma')] }]);
  await app.connect();
  assert.equal(app.elements.capture.disabled, true);
  assert.match(app.elements.status.textContent, /토큰이 맞지/);
  await app.emit('refresh', 'click');
  assert.equal(app.elements.capture.disabled, false);
  app.elements.token.value = 'different-token';
  await app.emit('token', 'input');
  assert.equal(app.elements.capture.disabled, true);
  assert.equal(app.elements.session.value, '');
});

test('POST failure preserves backup and reports unconfirmed receipt instead of success', async () => {
  const app = fixture([{ sessions: [connected('figma')] }, { http: 503, body: { error: 'Plugin disconnected' } }]);
  await app.connect();
  await app.emit('capture', 'click');
  assert.equal(app.elements.result.hidden, false);
  assert.equal(app.elements.status.dataset.kind, 'error');
  assert.match(app.elements.status.textContent, /전송 완료 여부를 확인하지 못/);
  assert.equal(app.history.some(message => /생성을 완료/.test(message)), false);
});

test('plugin failure is reported as failure and polling failures can be checked again', async () => {
  const app = fixture([
    { sessions: [connected('figma')] }, { jobId: 'job1', status: 'queued' },
    { http: 503, body: { error: 'Server unavailable' } }, { id: 'job1', status: 'failed', error: 'Font unavailable' },
  ]);
  await app.connect();
  await app.emit('capture', 'click');
  assert.equal(app.elements['check-job'].hidden, false);
  assert.equal(app.elements.capture.disabled, true);
  assert.match(app.elements.status.textContent, /접수된 작업은 유지/);
  await app.emit('check-job', 'click');
  assert.match(app.elements.status.textContent, /실패: Font unavailable/);
  assert.equal(app.elements.capture.disabled, false);
});
