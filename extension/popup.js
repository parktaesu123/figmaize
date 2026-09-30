'use strict';
const BRIDGE_URL = 'http://127.0.0.1:4318';
const captureButton = document.querySelector('#capture');
const refreshButton = document.querySelector('#refresh');
const checkButton = document.querySelector('#check-job');
const tokenInput = document.querySelector('#token');
const sessionSelect = document.querySelector('#session');
const statusElement = document.querySelector('#status');
let sessions = [];
let busy = false;
let pendingJob = null;
let downloadURL;

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}
function updateControls() {
  const token = tokenInput.value.trim();
  captureButton.disabled = busy || !!pendingJob || !token || !sessions.some(session => session.id === sessionSelect.value);
  refreshButton.disabled = busy || !token || !!pendingJob;
  tokenInput.disabled = busy;
  sessionSelect.disabled = busy || !!pendingJob || !sessions.length;
  document.querySelector('#name').disabled = busy || !!pendingJob;
  checkButton.hidden = !pendingJob || busy;
}
function resetSessions(placeholder) {
  sessions = [];
  sessionSelect.replaceChildren(new Option(placeholder, ''));
  updateControls();
}
async function api(path, token, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.method === 'POST' ? 30000 : 10000);
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('페어링 토큰이 맞지 않습니다. 현재 로컬 서버의 토큰을 확인하세요.');
      const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
      throw new Error(detail || `로컬 서버 요청 실패 (${response.status})`);
    }
    if (!data || typeof data !== 'object') throw new Error('로컬 서버의 응답을 읽지 못했습니다.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('로컬 서버 응답 시간이 초과되었습니다.');
    if (error instanceof TypeError) throw new Error('로컬 서버에 연결할 수 없습니다. 127.0.0.1:4318에서 서버가 실행 중인지 확인하세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}

tokenInput.addEventListener('input', () => {
  if (!pendingJob) resetSessions('토큰을 입력한 뒤 피그마를 다시 찾아주세요');
  updateControls();
});
sessionSelect.addEventListener('change', updateControls);
refreshButton.addEventListener('click', async () => {
  busy = true;
  const token = tokenInput.value.trim();
  const previousId = sessionSelect.value;
  resetSessions('연결된 피그마를 찾고 있습니다…');
  setStatus('로컬 서버에서 연결된 피그마를 확인하고 있습니다…');
  try {
    const data = await api('/v1/sessions', token);
    sessions = (Array.isArray(data.sessions) ? data.sessions : []).filter(session => session.connected === true && typeof session.id === 'string');
    if (!sessions.length) {
      resetSessions('연결된 피그마가 없습니다');
      setStatus('피그마 파일에서 Layer Bridge 플러그인을 열고 서버에 연결한 뒤 다시 찾아주세요.');
      return;
    }
    sessionSelect.replaceChildren(new Option('파일과 페이지를 선택하세요', ''));
    for (const session of sessions) {
      const name = session.document?.name || '이름 없는 파일';
      const page = session.document?.pageName || '현재 페이지';
      sessionSelect.add(new Option(`${name} · ${page} (${session.id.slice(-6)})`, session.id));
    }
    // Never choose a target arbitrarily when multiple Figma files are connected.
    sessionSelect.value = sessions.length === 1 ? sessions[0].id : sessions.some(session => session.id === previousId) ? previousId : '';
    setStatus(`${sessions.length}개 피그마 연결을 찾았습니다. ${sessionSelect.value ? '현재 화면을 보낼 수 있습니다.' : '생성할 파일과 페이지를 선택하세요.'}`);
  } catch (error) {
    resetSessions('연결을 확인하지 못했습니다');
    setStatus(error.message, 'error');
  } finally { busy = false; updateControls(); }
});

async function captureCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^(https?:|file:)/.test(tab.url || '')) throw new Error('일반 웹페이지에서 실행하세요. Chrome 설정·새 탭·웹스토어는 수집할 수 없습니다.');
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.LayerBridgeCollector.capture() });
  const capture = result?.result;
  if (!capture || !Array.isArray(capture.nodes) || !capture.viewport) throw new Error('화면 데이터를 읽지 못했습니다. 페이지를 새로고침하고 다시 시도하세요.');
  capture.title = document.querySelector('#name').value.trim() || capture.title;
  capture.screenshot = screenshot;
  capture.warnings = Array.isArray(capture.warnings) ? capture.warnings : [];
  const image = new Image(); image.src = screenshot; await image.decode();
  for (const node of capture.nodes) {
    if (!node.needsRaster) continue;
    const b = node.bounds;
    if (b.x < 0 || b.y < 0 || b.x + b.width > capture.viewport.width + 1 || b.y + b.height > capture.viewport.height + 1) {
      capture.warnings.push(`${node.name}: 화면 밖까지 걸친 이미지라 원본 영역에서 확인해야 합니다.`);
      continue;
    }
    const sx = image.naturalWidth / capture.viewport.width, sy = image.naturalHeight / capture.viewport.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(b.width * sx)); canvas.height = Math.max(1, Math.round(b.height * sy));
    canvas.getContext('2d').drawImage(image, b.x * sx, b.y * sy, b.width * sx, b.height * sy, 0, 0, canvas.width, canvas.height);
    node.image = canvas.toDataURL('image/png');
    node.imageFit = 'FILL';
    node.rasterized = true;
    delete node.needsRaster;
  }
  return capture;
}
function offerBackup(capture) {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = URL.createObjectURL(new Blob([JSON.stringify(capture)], { type: 'application/json' }));
  const link = document.querySelector('#download');
  link.href = downloadURL;
  link.download = `${(capture.title || 'capture').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)}.layerbridge.json`;
  document.querySelector('#stats').textContent = `${capture.nodes.length}개 수집 레이어 · ${capture.viewport.width} × ${capture.viewport.height} · 확인 사항 ${capture.warnings.length}개`;
  document.querySelector('#result').hidden = false;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function watchJob(token) {
  // Bound this popup's polling; the accepted job remains on the bridge if the popup closes.
  for (let attempt = 0; attempt < 90; attempt++) {
    const job = await api(`/v1/jobs/${encodeURIComponent(pendingJob.id)}`, token);
    if (job.status === 'complete') {
      setStatus('피그마 플러그인이 레이어 생성을 완료했습니다. 대상 파일에서 생성된 프레임을 확인하세요.', 'success');
      pendingJob = null;
      return;
    }
    if (job.status === 'failed') {
      const detail = typeof job.error === 'string' ? job.error : job.error?.message;
      setStatus(`피그마 생성 실패: ${detail || '플러그인에서 오류 내용을 확인하세요.'}`, 'error');
      pendingJob = null;
      return;
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      setStatus('서버에서 작업 상태를 확인할 수 없습니다. 피그마에서 생성 여부를 확인하세요. 완료로 처리하지 않았습니다.', 'error');
      return;
    }
    setStatus(job.status === 'queued'
      ? '서버가 작업을 접수했습니다. 피그마 플러그인의 처리를 기다리고 있습니다…'
      : '피그마 플러그인에서 레이어를 생성하고 있습니다…');
    await pause(1000);
  }
  setStatus('작업이 아직 완료되지 않았습니다. 피그마 플러그인이 열려 있는지 확인한 뒤 생성 상태를 다시 확인하세요.');
}

captureButton.addEventListener('click', async () => {
  if (busy || pendingJob || !sessions.some(session => session.id === sessionSelect.value)) return;
  busy = true;
  updateControls();
  document.querySelector('#result').hidden = true;
  setStatus('현재 화면과 레이어를 수집하고 있습니다. 이 창을 유지하세요…');
  let submitting = false;
  try {
    const token = tokenInput.value.trim();
    const sessionId = sessionSelect.value;
    const capture = await captureCurrentTab();
    offerBackup(capture);
    setStatus('수집 완료. 연결된 피그마로 전송하고 있습니다…');
    submitting = true;
    const response = await api('/v1/captures', token, { method: 'POST', body: JSON.stringify({ sessionId, capture, reference: true }) });
    if (typeof response.jobId !== 'string' || !response.jobId) throw new Error('서버가 작업 번호를 반환하지 않았습니다.');
    pendingJob = { id: response.jobId };
    submitting = false;
    await watchJob(token);
  } catch (error) {
    setStatus(`${error.message}${pendingJob ? ' 접수된 작업은 유지됩니다. 생성 상태를 다시 확인하세요.' : submitting ? ' 전송 완료 여부를 확인하지 못했습니다. 다시 보내기 전에 피그마 플러그인의 작업 내역을 확인하세요.' : ''}`, 'error');
  } finally { busy = false; updateControls(); }
});
checkButton.addEventListener('click', async () => {
  if (busy || !pendingJob) return;
  busy = true;
  updateControls();
  try { await watchJob(tokenInput.value.trim()); }
  catch (error) { setStatus(`${error.message} 접수된 작업은 유지됩니다. 생성 상태를 다시 확인하세요.`, 'error'); }
  finally { busy = false; updateControls(); }
});
updateControls();
