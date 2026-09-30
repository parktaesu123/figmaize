import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOLS, callTool, createRpcHandler, jobContent, serveStdio } from '../server/mcp.mjs';
import { createBridge } from '../server/bridge.mjs';

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const initialize = handler => handler(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));

test('MCP initialization negotiates supported versions and advertises tools', async () => {
  for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', 'future-version']) {
    const handler = createRpcHandler();
    const response = await handler(rpc('init', 'initialize', { protocolVersion: version }));
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 'init');
    assert.equal(response.result.protocolVersion, version === 'future-version' ? '2025-06-18' : version);
    assert.equal(response.result.serverInfo.name, 'figmaize');
    assert.deepEqual(response.result.capabilities.tools, { listChanged: false });
    assert.match(response.result.instructions, /unknown/);
  }
});

test('MCP tools/list requires initialization and returns bounded schemas and annotations', async () => {
  const handler = createRpcHandler();
  assert.equal((await handler(rpc(0, 'tools/list'))).error.code, -32000);
  await initialize(handler);
  const response = await handler(rpc(2, 'tools/list'));
  assert.deepEqual(response.result.tools, TOOLS);
  assert.equal(new Set(TOOLS.map(tool => tool.name)).size, TOOLS.length);
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
  }
  assert.equal(TOOLS.find(tool => tool.name === 'figma_update_node').annotations.readOnlyHint, false);
  assert.equal(TOOLS.find(tool => tool.name === 'figma_export_png').annotations.readOnlyHint, true);
});

test('MCP calls forward arguments once and wrap execution failures as tool errors', async () => {
  const calls = [];
  const handler = createRpcHandler({ invoke: async (name, args) => {
    calls.push({ name, args });
    if (name === 'broken') throw new Error('fixture failure');
    return { content: [{ type: 'text', text: JSON.stringify(args) }] };
  } });
  await initialize(handler);
  const args = { sessionId: 'session-a', nodeId: '1:2', changes: { name: 'Updated' } };
  const success = await handler(rpc(2, 'tools/call', { name: 'figma_update_node', arguments: args }));
  assert.equal(success.id, 2);
  assert.equal(success.result.content[0].text, JSON.stringify(args));
  assert.deepEqual(calls, [{ name: 'figma_update_node', args }]);
  const failure = await handler(rpc(3, 'tools/call', { name: 'broken' }));
  assert.equal(failure.error, undefined);
  assert.equal(failure.result.isError, true);
  assert.equal(failure.result.content[0].text, 'fixture failure');
});

test('MCP notifications have no response or side effects and protocol errors remain JSON-RPC errors', async () => {
  let invoked = 0;
  const handler = createRpcHandler({ invoke: async () => { invoked++; } });
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal(await handler({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'figma_update_node' } }), undefined);
  assert.equal(invoked, 0);
  for (const value of [null, [], {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1, method: 7 }]) {
    const response = await handler(value);
    assert.equal(response.error.code, -32600);
    assert.equal(response.jsonrpc, '2.0');
  }
  assert.deepEqual((await handler(rpc(2, 'ping'))).result, {});
  await initialize(handler);
  assert.equal((await handler(rpc(3, 'not/a/method'))).error.code, -32601);
  for (const id of [false, {}, [], Infinity]) {
    const response = await handler(rpc(id, 'ping'));
    assert.equal(response.error.code, -32600);
    assert.equal(response.id, null);
  }
  for (const params of [undefined, null, {}, { name: 12 }, { name: 'figma_update_node', arguments: null }, { name: 'figma_update_node', arguments: [] }]) {
    const response = await handler(rpc(4, 'tools/call', params));
    assert.equal(response.error.code, -32602);
  }
});

test('invalid MCP tool arguments are rejected before starting or contacting a bridge', async () => {
  const cases = [
    ['not_a_tool', {}, /Unknown tool/],
    ['bridge_status', null, /object/],
    ['bridge_status', [], /object/],
    ['bridge_status', { unknown: true }, /Unknown argument/],
    ['figma_get_job', {}, /Missing argument/],
    ['figma_get_job', { jobId: 123 }, /Invalid argument/],
    ['figma_inspect_node', { nodeId: '1:2', depth: 6 }, /out of range/],
    ['figma_inspect_node', { nodeId: '1:2', depth: 1.5 }, /Invalid argument/],
    ['figma_update_node', { nodeId: '1:2', changes: [] }, /Invalid argument/],
    ['figma_export_png', { nodeId: '1:2', scale: Infinity }, /Invalid argument/],
    ['figma_export_png', { nodeId: '1:2', scale: 0 }, /out of range/],
    ['figma_capture_url', { url: 'https://example.com', width: 200 }, /out of range/],
    ['figma_import_capture', { capture: {}, reference: 'yes' }, /Invalid argument/]
  ];
  for (const [name, args, message] of cases) await assert.rejects(callTool(name, args), message);
});

test('complete PNG jobs become MCP image content without repeating base64 in metadata', () => {
  const result = jobContent({ id: 'job-1', status: 'complete', result: { mimeType: 'image/png', base64: 'aW1hZ2U=', width: 390, height: 844 } });
  assert.deepEqual(result.content[0], { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' });
  assert.deepEqual(JSON.parse(result.content[1].text), { jobId: 'job-1', status: 'complete', mimeType: 'image/png', width: 390, height: 844 });
  assert.equal(result.isError, undefined);
});

test('pending, failed and unknown jobs stay explicit rather than claiming successful mutation', () => {
  for (const status of ['queued', 'running', 'failed', 'unknown', 'complete']) {
    const job = { id: 'job-1', status, ...(status === 'complete' ? { result: { id: '2:1' } } : {}) };
    const response = jobContent(job);
    assert.deepEqual(JSON.parse(response.content[0].text), job);
    assert.equal(response.isError, ['failed', 'unknown'].includes(status) ? true : undefined);
  }
  assert.equal(jobContent({ status: 'running', result: { mimeType: 'image/png', base64: 'aW1hZ2U=' } }).content[0].type, 'text');
});

test('stdio handles split lines, blank lines, parse errors and request order', async t => {
  const input = new PassThrough();
  const output = new PassThrough();
  t.after(() => { input.destroy(); output.destroy(); });
  const messages = [];
  let buffer = '';
  let resolveAll;
  const done = new Promise(resolve => { resolveAll = resolve; });
  output.on('data', chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
      if (messages.length === 4) resolveAll();
    }
  });
  serveStdio(input, output);
  const init = JSON.stringify(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }));
  input.write(init.slice(0, 17));
  input.write(init.slice(17) + '\n\n{not-json}\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  input.write(JSON.stringify(rpc(2, 'tools/list')) + '\n');
  input.write(JSON.stringify(rpc(3, 'tools/call', { name: 'unknown_tool' })) + '\n');
  await done;
  assert.equal(messages.find(message => message.id === null).error.code, -32700);
  assert.equal(messages.find(message => message.id === 1).result.serverInfo.name, 'figmaize');
  assert.equal(messages.find(message => message.id === 2).result.tools.length, TOOLS.length);
  assert.equal(messages.find(message => message.id === 3).result.isError, true);
});

test('stdio overload handles malformed null requests without crashing', { timeout: 2000 }, async t => {
  const input = new PassThrough();
  const output = new PassThrough();
  t.after(() => { input.destroy(); output.destroy(); });
  const messages = [];
  let buffer = '';
  let resolveAll;
  const done = new Promise(resolve => { resolveAll = resolve; });
  output.on('data', chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
      if (messages.length === 22) resolveAll();
    }
  });
  serveStdio(input, output);
  const burst = Array.from({ length: 20 }, (_, index) => JSON.stringify(rpc(index, 'ping')));
  burst.push('null', JSON.stringify(rpc(21, 'ping')));
  assert.doesNotThrow(() => input.write(burst.join('\n') + '\n'));
  await done;
  assert.equal(messages.filter(message => message.result).length, 20);
  assert.equal(messages.find(message => message.id === null).error.code, -32000);
  assert.equal(messages.find(message => message.id === 21).error.code, -32000);
});

test('MCP process completes real HTTP bridge jobs and returns a native image response', { timeout: 15_000 }, async t => {
  const token = 'integration-test-pairing-token-24-characters';
  const { server, jobs } = createBridge({ token });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const port = server.address().port;
  async function request(route, json) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: json ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined });
    assert.equal(response.ok, true);
    return response.json();
  }
  const { sessionId } = await request('/v1/connect', { clientId: 'integration-plugin', document: { name: 'Integration file', pageName: 'Page', pageId: 'page:1' } });
  const pluginErrors = [];
  const received = [];
  server.on('request', (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/commands') return;
    res.once('finish', () => {
      (async () => {
        const { job } = await request(`/v1/poll?sessionId=${sessionId}`);
        assert.ok(job);
        received.push(job);
        const result = job.operation === 'export_png' ? { mimeType: 'image/png', base64: 'aW1hZ2U=', width: 32, height: 16 } : { pageId: 'page:1', nodeId: '2:1' };
        await request('/v1/result', { sessionId, jobId: job.id, ok: true, result });
      })().catch(error => pluginErrors.push(error));
    });
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server/mcp.mjs', import.meta.url))], { env: { ...process.env, LAYER_BRIDGE_PORT: String(port), LAYER_BRIDGE_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '', stderr = '';
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.stdout.on('data', data => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const response = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      pending.get(response.id)?.resolve(response);
      pending.delete(response.id);
    }
  });
  child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP exited ${code}: ${stderr}`)); });
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  }));
  function send(id, method, params) {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(rpc(id, method, params)) + '\n');
    });
  }
  assert.equal((await send(1, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'figmaize');
  assert.equal((await send(2, 'tools/list')).result.tools.length, TOOLS.length);
  const status = await send(3, 'tools/call', { name: 'bridge_status', arguments: {} });
  assert.equal(JSON.parse(status.result.content[0].text).sessions[0].id, sessionId);
  const document = await send(4, 'tools/call', { name: 'figma_get_document', arguments: { sessionId } });
  assert.equal(JSON.parse(document.result.content[0].text).status, 'complete');
  const image = await send(5, 'tools/call', { name: 'figma_export_png', arguments: { sessionId, nodeId: '2:1', scale: 1 } });
  assert.deepEqual(image.result.content[0], { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' });
  const update = await send(6, 'tools/call', { name: 'figma_update_node', arguments: { sessionId, nodeId: '2:1', changes: { name: 'New name' } } });
  const updateJob = JSON.parse(update.result.content[0].text);
  assert.equal(updateJob.status, 'complete');
  assert.equal(received[2].payload.expectedPageId, 'page:1');
  assert.deepEqual(received.map(job => job.operation), ['get_document', 'export_png', 'update_node']);
  const checked = await send(7, 'tools/call', { name: 'figma_get_job', arguments: { jobId: updateJob.id } });
  assert.equal(JSON.parse(checked.result.content[0].text).status, 'complete');
  const missing = await send(8, 'tools/call', { name: 'figma_get_job', arguments: { jobId: 'not-present' } });
  assert.equal(missing.result.isError, true);
  assert.equal(jobs.size, 3);
  assert.deepEqual(pluginErrors, []);
  assert.equal(stderr, '');
});
