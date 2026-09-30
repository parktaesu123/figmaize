'use strict';
const $ = selector => document.querySelector(selector);
let capture = null, selectedId = null, tool = 'select', zoom = .75, overlay = false, drag = null, toastTimer;
const form = $('#properties');
function toast(text) { $('#toast').textContent = text; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').style.display = 'none', 4500); }
function hex(css, fallback = '#ffffff') { const c = LayerBridge.color(css); return c ? '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : fallback; }
function selected() { return capture?.nodes.find(n => n.id === selectedId); }
function setCapture(value) {
  capture = LayerBridge.validateCapture(value); selectedId = null; overlay = capture.source?.kind === 'screenshot';
  tool = 'select'; drag = null; $('#drawing').style.display = 'none'; $('#stage').style.cursor = 'default';
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
  $('#canvas-tip').textContent = '레이어를 선택하면 속성을 수정할 수 있어요';
  $('#title').textContent = capture.title || '이름 없는 화면';
  $('#subtitle').textContent = capture.source?.kind === 'screenshot' ? '영역을 그려 텍스트·도형·이미지를 직접 분리하세요.' : '수집한 화면의 구조를 살펴보고, 레이어를 다듬으세요.';
  $('#screen-size').textContent = `${capture.viewport.width} × ${capture.viewport.height}`;
  $('#search').value = ''; render(); fit(); inspect();
}
function render() {
  if (!capture) return;
  $('#stage').style.width = capture.viewport.width + 'px'; $('#stage').style.height = capture.viewport.height + 'px';
  $('#stage').style.background = LayerBridge.color(capture.background)?.a ? capture.background : '#ffffff';
  const root = $('#render'); root.replaceChildren(); const map = new Map();
  for (const node of capture.nodes) {
    const el = document.createElement('div'); el.className = `node ${node.type === 'text' ? 'text-node' : ''}`; el.dataset.id = node.id;
    const parent = map.get(node.parentId), b = node.bounds, s = node.style || {};
    el.style.left = (b.x - (parent?.node.bounds.x || 0)) + 'px'; el.style.top = (b.y - (parent?.node.bounds.y || 0)) + 'px'; el.style.width = b.width + 'px'; el.style.height = b.height + 'px';
    el.style.opacity = s.opacity ?? 1;
    if (node.type === 'text') {
      el.textContent = node.text; el.style.color = s.color || '#26352e'; el.style.fontFamily = s.fontFamily || 'sans-serif'; el.style.fontSize = (s.fontSize || 14) + 'px'; el.style.fontWeight = s.fontWeight || 400; el.style.fontStyle = s.fontStyle || 'normal'; el.style.lineHeight = (s.lineHeight || s.fontSize * 1.2 || 17) + 'px'; el.style.letterSpacing = (s.letterSpacing || 0) + 'px'; el.style.textDecoration = s.textDecoration || 'none';
    } else if (node.type === 'svg') {
      const doc = new DOMParser().parseFromString(node.svg, 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.localName === 'svg') {
        for (const item of [svg, ...svg.querySelectorAll('*')]) {
          if (['script', 'foreignObject', 'style', 'image', 'use', 'animate', 'set'].includes(item.localName)) { item.remove(); continue; }
          for (const a of [...item.attributes]) if (/^on/i.test(a.name) || /href|style/i.test(a.name) || /url\(\s*[^#]/i.test(a.value)) item.removeAttribute(a.name);
        }
        el.append(document.importNode(svg, true));
      }
    } else {
      el.style.background = LayerBridge.color(s.background) ? s.background : 'transparent';
      if (node.type === 'image') { if (node.image) { const img = new Image(); img.src = node.image; img.alt = node.name; img.draggable = false; img.style.objectFit = node.imageFit === 'FIT' ? 'contain' : 'cover'; el.append(img); } else el.style.background = '#e6e8e5'; }
      if (s.radius) el.style.borderRadius = s.radius.map(v => v + 'px').join(' ');
      if (s.borderWidth) el.style.border = `${s.borderWidth}px solid ${s.borderColor || 'transparent'}`;
      if (s.shadow) el.style.boxShadow = s.shadow;
      el.style.overflow = node.clip || node.type === 'image' ? 'hidden' : 'visible';
    }
    (parent?.el || root).append(el); map.set(node.id, { node, el });
  }
  $('#reference').src = capture.screenshot || '';
  $('#reference').style.display = overlay && capture.screenshot ? 'block' : 'none';
  $('#reference').style.opacity = capture.nodes.length ? '.5' : '1';
  $('#compare').disabled = !capture.screenshot; $('#compare').setAttribute('aria-pressed', String(overlay));
  $('#layer-count').textContent = capture.nodes.length;
  renderLayers(); drawSelection(); renderWarnings();
}
function renderLayers() {
  $('#layers').replaceChildren(); if (!capture) return;
  const query = $('#search').value.toLowerCase(); const depth = new Map();
  for (const node of capture.nodes) {
    const d = node.parentId ? (depth.get(node.parentId) || 0) + 1 : 0; depth.set(node.id, d);
    if (query && !node.name.toLowerCase().includes(query) && !node.text?.toLowerCase().includes(query)) continue;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'layer' + (node.id === selectedId ? ' selected' : ''); row.style.paddingLeft = (10 + Math.min(d, 5) * 9) + 'px'; row.title = node.name;
    const symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = { frame: '▱', text: 'T', image: '▧', svg: '◇' }[node.type];
    const label = document.createElement('span'); label.textContent = node.name;
    row.append(symbol, label); row.onclick = () => select(node.id); $('#layers').append(row);
  }
}
function renderWarnings() {
  const items = capture?.warnings || []; $('#warning-count').textContent = items.length; $('#warnings').replaceChildren();
  for (const text of items.length ? items : ['확인 사항이 없습니다. 피그마에서 폰트와 줄바꿈을 한 번 더 확인하세요.']) { const p = document.createElement('p'); p.textContent = text; $('#warnings').append(p); }
}
function select(id) { selectedId = id; renderLayers(); drawSelection(); inspect(); }
function drawSelection() { const node = selected(); const el = $('#selection'); el.style.display = node ? 'block' : 'none'; if (node) for (const k of ['x', 'y', 'width', 'height']) el.style[{ x: 'left', y: 'top', width: 'width', height: 'height' }[k]] = node.bounds[k] + 'px'; }
function inspect() {
  const node = selected(); form.hidden = !node; $('#empty-properties').hidden = !!node; if (!node) return;
  $('#node-type').textContent = node.type.toUpperCase(); form.elements.name.value = node.name;
  for (const k of ['x', 'y', 'width', 'height']) form.elements[k].value = node.bounds[k];
  const text = node.type === 'text'; $('#text-field').hidden = !text; $('#font-fields').hidden = !text; $('#radius-field').hidden = text || node.type === 'svg';
  form.elements.text.value = node.text || ''; form.elements.fontSize.value = node.style?.fontSize || 14; form.elements.fontWeight.value = node.style?.fontWeight || 400;
  form.elements.color.value = hex(text ? node.style?.color : node.style?.background, text ? '#26352e' : '#ffffff'); $('#color-label').textContent = form.elements.color.value.toUpperCase(); form.elements.radius.value = node.style?.radius?.[0] || 0;
}
form.addEventListener('submit', e => e.preventDefault());
form.addEventListener('input', event => {
  const node = selected(); if (!node) return;
  const field = event.target.name, value = event.target.value; node.style ||= {};
  if (['x', 'y', 'width', 'height'].includes(field)) {
    if (value.trim() === '' || !Number.isFinite(+value)) return;
    if ((field === 'width' || field === 'height') && (+value < 1 || +value > 100000)) return;
    if (Math.abs(+value) > 1000000) return;
    if (field === 'x' || field === 'y') { const delta = +value - node.bounds[field], children = descendants(node.id); for (const child of capture.nodes) if (children.has(child.id)) child.bounds[field] += delta; }
    node.bounds[field] = +value;
  } else if (field === 'name') node.name = value;
  else if (field === 'text') node.text = value;
  else if (field === 'fontSize') { if (+value < 1 || +value > 1000) return; node.style.fontSize = +value; node.style.lineHeight = +value * 1.2; }
  else if (field === 'fontWeight') node.style.fontWeight = +value;
  else if (field === 'color') { node.style[node.type === 'text' ? 'color' : 'background'] = value; $('#color-label').textContent = value.toUpperCase(); }
  else if (field === 'radius') node.style.radius = Array(4).fill(Math.max(0, Math.min(10000, +value || 0)));
  render();
});
function descendants(id) { const result = new Set([id]); for (const node of capture.nodes) if (result.has(node.parentId)) result.add(node.id); result.delete(id); return result; }
function deleteSelected() { const node = selected(); if (!node) return; const remove = descendants(node.id); remove.add(node.id); capture.nodes = capture.nodes.filter(n => !remove.has(n.id)); select(null); render(); toast(`${remove.size}개 레이어를 삭제했습니다.`); }
$('#delete').onclick = deleteSelected;
function setZoom(value) { zoom = value; $('#stage').style.transform = `scale(${zoom})`; $('#stage-wrap').style.width = capture.viewport.width * zoom + 'px'; $('#stage-wrap').style.height = capture.viewport.height * zoom + 'px'; const select = $('#zoom'); let option = select.querySelector('[data-fit]'); if (option) option.remove(); if (![...select.options].some(o => +o.value === zoom)) { option = new Option(Math.round(zoom * 100) + '%', zoom); option.dataset.fit = 'true'; select.add(option); } select.value = String(zoom); }
function fit() { if (capture) setZoom(Math.min(1, Math.max(.05, ($('#canvas').clientWidth - 70) / capture.viewport.width), Math.max(.05, ($('#canvas').clientHeight - 120) / capture.viewport.height))); }
$('#zoom').onchange = e => capture && setZoom(+e.target.value); $('#fit').onclick = fit;
$('#compare').onclick = () => { overlay = !overlay; render(); };
$('#search').oninput = renderLayers;
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => { tool = button.dataset.tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === button)); $('#stage').style.cursor = tool === 'select' ? 'default' : 'crosshair'; $('#canvas-tip').textContent = tool === 'select' ? '레이어를 선택하면 속성을 수정할 수 있어요' : '화면 위를 드래그하여 영역을 지정하세요'; if (tool === 'image' && !capture?.screenshot) toast('이미지 분리에는 원본 스크린샷이 필요합니다.'); });
function point(event) { const rect = $('#stage').getBoundingClientRect(); return { x: Math.max(0, Math.min(capture.viewport.width, (event.clientX - rect.left) / zoom)), y: Math.max(0, Math.min(capture.viewport.height, (event.clientY - rect.top) / zoom)) }; }
$('#stage').addEventListener('pointerdown', event => {
  if (!capture || event.button !== 0) return;
  if (tool === 'select') { select(event.target.closest('[data-id]')?.dataset.id || null); return; }
  if (tool === 'image' && !capture.screenshot) return;
  event.preventDefault(); drag = { start: point(event), tool }; $('#stage').setPointerCapture(event.pointerId);
});
$('#stage').addEventListener('pointermove', event => { if (!drag) return; const p = point(event); drag.bounds = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), width: Math.abs(p.x - drag.start.x), height: Math.abs(p.y - drag.start.y) }; const b = drag.bounds; Object.assign($('#drawing').style, { display: 'block', left: b.x + 'px', top: b.y + 'px', width: b.width + 'px', height: b.height + 'px' }); });
$('#stage').addEventListener('pointerup', async () => {
  if (!drag) return; const current = drag; drag = null; $('#drawing').style.display = 'none';
  const b = current.bounds; if (!b || b.width < 3 || b.height < 3) return;
  if (capture.nodes.length >= LayerBridge.MAX_NODES) return toast('최대 레이어 수를 초과했습니다.');
  const targetCapture = capture;
  try {
    const node = { id: 'manual-' + crypto.randomUUID(), parentId: null, type: current.tool, name: { text: '새 텍스트', frame: '새 도형', image: '분리한 이미지' }[current.tool], bounds: Object.fromEntries(Object.entries(b).map(([k,v]) => [k, Math.round(v)])), source: 'manual', style: { opacity: 1 } };
    if (current.tool === 'text') { node.text = '텍스트를 입력하세요'; node.style = { ...node.style, fontFamily: 'Inter', fontSize: 18, fontWeight: 400, lineHeight: 24, color: '#26352e' }; }
    else if (current.tool === 'frame') { node.style.background = '#e5ebdf'; node.style.radius = [8,8,8,8]; }
    else { const img = new Image(); img.src = capture.screenshot; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(b.width * img.width / capture.viewport.width)); canvas.height = Math.max(1, Math.round(b.height * img.height / capture.viewport.height)); canvas.getContext('2d').drawImage(img, b.x * img.width / capture.viewport.width, b.y * img.height / capture.viewport.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height); node.image = canvas.toDataURL('image/png'); node.imageFit = 'FILL'; }
    if (targetCapture !== capture) return;
    capture.nodes.push(node); select(node.id); render(); if (node.type === 'text') { form.elements.text.focus(); form.elements.text.select(); }
  } catch(e) { toast(e.message); }
});
$('#stage').addEventListener('pointercancel', () => { drag = null; $('#drawing').style.display = 'none'; });
$('#export').onclick = () => {
  try { if (!capture) return; LayerBridge.validateCapture(capture); const blob = new Blob([JSON.stringify(capture)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (capture.title || 'screen').replace(/[\\/:*?"<>|]/g, '-').slice(0,80) + '.layerbridge.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('저장한 파일을 피그마의 Layer Bridge 플러그인에서 열어주세요.'); } catch(e) { toast(e.message); }
};
$('#upload').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 50000000) throw new Error('50MB 이하 파일을 선택하세요.');
    if (file.name.toLowerCase().endsWith('.json')) setCapture(JSON.parse(await file.text()));
    else {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPG, WebP 또는 JSON 파일을 선택하세요.');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const img = new Image(); img.src = data; await img.decode();
      setCapture({ format: 'layer-bridge', version: 1, title: file.name.replace(/\.[^.]+$/, ''), source: { kind: 'screenshot', capturedAt: new Date().toISOString() }, viewport: { width: img.naturalWidth, height: img.naturalHeight, devicePixelRatio: 1 }, background: '#ffffff', screenshot: data, nodes: [], warnings: ['스크린샷 원본입니다. 텍스트·도형 도구로 영역을 지정하고 내용을 입력하세요. 사진·아이콘은 이미지 분리 도구로 잘라낼 수 있습니다.'] });
    }
    toast('화면을 불러왔습니다.');
  } catch (e) { toast(e.message); }
  event.target.value = '';
};
async function loadSample() { try { const response = await fetch('/examples/demo.layerbridge.json'); if (!response.ok) throw new Error('샘플 파일을 읽지 못했습니다.'); setCapture(await response.json()); } catch(e) { toast(e.message); } }
$('#sample').onclick = loadSample;
for (const id of ['help', 'download-plugin']) $('#' + id).onclick = () => $('#guide').showModal();
$('#close-guide').onclick = () => $('#guide').close();
$('#demo-link').onclick = () => window.open('/examples/demo.html', '_blank', 'noopener');
window.addEventListener('keydown', event => { if (event.key === 'Escape') { drag = null; $('#drawing').style.display = 'none'; select(null); } });
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 120); });
loadSample();
