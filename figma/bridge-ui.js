'use strict';
const $ = selector => document.querySelector(selector);
const BASE = 'http://localhost:4318';
let sessionId = null, connecting = false, busy = false, activeToken = '', capture = null, requestSequence = 0;
// Figma's opaque iframe may not expose secure-context randomUUID. This ID is not an auth secret.
const clientId = 'figma-' + (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const pending = new Map();
function controls() {
  $('#connect').hidden = !!sessionId;
  $('#disconnect').hidden = !sessionId;
  $('#connect').disabled = connecting || busy;
  $('#disconnect').disabled = busy;
  $('#token').disabled = !!sessionId || connecting || busy;
  $('#file').disabled = busy || !!sessionId;
  $('#import').disabled = !capture || busy || !!sessionId;
  $('#dot').classList.toggle('online', !!sessionId);
  $('#state').textContent = sessionId ? busy ? '피그마 작업 중' : '수집기 연결됨' : connecting ? '연결 중…' : '연결 대기';
}
function warnings(items = []) {
  $('#warnings').replaceChildren();
  for (const text of items.slice(0, 20)) { const li = document.createElement('li'); li.textContent = text; $('#warnings').append(li); }
}
function pluginCommand(id, operation, payload = {}, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    // Only the read-only connection handshake times out. Mutations are never rerun.
    const timer = timeoutMs ? setTimeout(() => {
      pending.delete(id);
      reject(new Error('피그마 응답을 받지 못했습니다. 플러그인을 다시 실행하세요.'));
    }, timeoutMs) : null;
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ pluginMessage: { type: 'bridge-command', id, operation, payload } }, '*');
  });
}
async function api(path, method = 'GET', body) {
  const response = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + activeToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(path==='/v1/sites/discover'?30000:12000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return result;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(connectedSession) {
  while (sessionId === connectedSession) {
    try {
      const { job } = await api('/v1/poll?sessionId=' + encodeURIComponent(connectedSession));
      if (sessionId !== connectedSession) break;
      if (!job) { await pause(1000); continue; }
      busy = true; controls();
      $('#status').textContent = `${job.operation} 실행 중 · ${job.id.slice(0, 8)}`;
      // No timer reruns a command. An interrupted mutation must be checked in Figma.
      let delivery;
      try { delivery = { sessionId: connectedSession, jobId: job.id, ok: true, result: await pluginCommand(job.id, job.operation, job.payload) }; }
      catch (error) { delivery = { sessionId: connectedSession, jobId: job.id, ok: false, error: error.message }; }
      let delivered = false;
      while (!delivered && sessionId === connectedSession) {
        try { await api('/v1/result', 'POST', delivery); delivered = true; }
        catch (error) {
          if ([401, 403, 404].includes(error.status)) { sessionId = null; $('#status').textContent = '작업은 실행되었지만 결과를 서버에 전달하지 못했습니다. 캔버스를 확인한 뒤 다시 연결하세요. ' + error.message; break; }
          $('#status').textContent = '피그마 실행 결과를 서버로 다시 전달하는 중입니다. 레이어 생성은 반복하지 않습니다.';
          await pause(2000);
        }
      }
      busy = false; controls();
      if (delivered) {
        if(job.operation==='prepare_site'&&delivery.ok)$('#document').textContent=delivery.result.document.pageName;
        $('#status').textContent = delivery.ok ? `완료 · ${job.operation}${delivery.result?.count !== undefined ? ' · ' + delivery.result.count + '개 레이어' : ''}` : '작업 실패 · ' + delivery.error;
        warnings(delivery.result?.warnings || []);
      }
    } catch (error) {
      if (sessionId !== connectedSession) break;
      if ([401, 403, 404].includes(error.status)) { sessionId = null; controls(); $('#status').textContent = error.message + ' 다시 연결하세요.'; break; }
      $('#status').textContent = '로컬 서버 연결을 다시 확인하고 있습니다. ' + error.message;
      await pause(2000);
    }
  }
}
$('#connect').onclick = async () => {
  if (busy || connecting || sessionId) return;
  activeToken = $('#token').value.trim();
  if (activeToken.length < 24) { $('#status').textContent = 'start.command에 표시된 연결 코드를 입력하세요.'; return; }
  connecting = true; controls();
  try {
    $('#status').textContent = '현재 피그마 파일과 페이지를 확인하고 있습니다…';
    const document = await pluginCommand('local-document-' + (++requestSequence), 'get_document', {}, 10000);
    const result = await api('/v1/connect', 'POST', { clientId, document });
    if (typeof result.sessionId !== 'string') throw new Error('서버 연결 응답이 올바르지 않습니다.');
    sessionId = result.sessionId;
    $('#document').textContent = `${document.name} · ${document.pageName}`;
    $('#status').textContent = '연결되었습니다. MCP 또는 Chrome 확장에서 이 피그마로 화면을 보내세요.';
    void poll(sessionId);
    if(typeof refreshCollections==='function')void refreshCollections().catch(error=>siteStatus(error.message));
  } catch (error) { $('#status').textContent = '연결 실패: ' + error.message + '\nstart.command로 서버를 실행했는지 확인하세요.'; }
  finally { connecting = false; controls(); }
};
$('#disconnect').onclick = async () => {
  if (busy || !sessionId) return;
  const id = sessionId; sessionId = null; controls();
  try { await api('/v1/disconnect', 'POST', { sessionId: id }); } catch { /* The server also expires inactive sessions. */ }
  $('#status').textContent = '연결을 해제했습니다. 현재 레이어는 유지됩니다.';
};
$('#file').onchange = async () => {
  capture = null; controls();
  try { const file = $('#file').files[0]; if (!file) return; if (file.size > 50000000) throw new Error('50MB 이하 파일을 선택하세요.'); capture = LayerBridge.validateCapture(JSON.parse(await file.text())); $('#status').textContent = `${capture.title} · ${capture.nodes.length}개 레이어 준비`; warnings(capture.warnings); }
  catch (error) { $('#status').textContent = error.message; }
  controls();
};
$('#import').onclick = async () => {
  if (!capture || busy || sessionId) return;
  busy = true; controls();
  try { const result = await pluginCommand('local-import-' + (++requestSequence), 'import_capture', { capture, options: { reference: $('#reference').checked } }); $('#status').textContent = `${result.count}개 레이어 생성 완료`; warnings(result.warnings); }
  catch (error) { $('#status').textContent = error.message; }
  finally { busy = false; controls(); }
};
window.onmessage = event => {
  // Desktop Figma relays replies from its host window, not the immediate sandbox parent.
  if (event.source !== parent && event.origin !== 'https://www.figma.com' && event.origin !== 'https://figma.com') return;
  const message = event.data?.pluginMessage; if (!message) return;
  if (message.type === 'progress') $('#status').textContent = `레이어 생성 중 · ${message.done} / ${message.total}`;
  if (message.type !== 'bridge-result') return;
  const request = pending.get(message.id); if (!request) return;
  pending.delete(message.id);
  if (request.timer) clearTimeout(request.timer);
  if (message.ok) request.resolve(message.result); else request.reject(new Error(message.error || '피그마 작업 실패'));
};
controls();

$('#status').textContent = '준비 완료. 연결 코드를 입력하고 MCP 브리지 연결을 누르세요.';
