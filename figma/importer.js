/* global figma, LayerBridge, __html__ */
'use strict';
figma.showUI(__html__, { width: 380, height: 570, themeColors: true });
let commandQueue = Promise.resolve();
const seenCommands = new Set();
const commandResults = new Map();
function bytes(data) {
  const input = data.slice(data.indexOf(',') + 1).replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const result = []; let bits = 0, value = 0;
  for (const char of input) { if (char === '=') break; const n = alphabet.indexOf(char); if (n < 0) throw new Error('이미지 인코딩 오류'); value = (value << 6) | n; bits += 6; if (bits >= 8) { bits -= 8; result.push((value >> bits) & 255); } }
  return new Uint8Array(result);
}
function rasterFill(data, fit) { return [{ type: 'IMAGE', imageHash: figma.createImage(bytes(data)).hash, scaleMode: fit === 'FIT' ? 'FIT' : 'FILL' }]; }
function decorate(target, source) {
  const s = source.style || {};
  if ('fills' in target) target.fills = LayerBridge.paint(s.background);
  target.opacity = Number.isFinite(s.opacity) ? Math.max(0, Math.min(1, s.opacity)) : 1;
  if ('cornerRadius' in target && Array.isArray(s.radius)) {
    const limit = Math.min(source.bounds.width, source.bounds.height) / 2;
    ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].forEach((key, i) => { target[key] = Math.max(0, Math.min(limit, Number(s.radius[i]) || 0)); });
  }
  if (s.borderWidth > 0 && LayerBridge.paint(s.borderColor).length && s.borderStyle !== 'none') { target.strokes = LayerBridge.paint(s.borderColor); target.strokeWeight = Math.min(s.borderWidth, 100); target.strokeAlign = 'INSIDE'; }
  if (s.shadow && s.shadow !== 'none') {
    const c = s.shadow.match(/rgba?\([^)]+\)/)?.[0];
    const lengths = s.shadow.replace(/rgba?\([^)]+\)/g, '').match(/-?[\d.]+px/g);
    if (c && lengths && lengths.length >= 3) { const rgba = LayerBridge.color(c); if (rgba) target.effects = [{ type: s.shadow.includes('inset') ? 'INNER_SHADOW' : 'DROP_SHADOW', color: rgba, offset: { x: parseFloat(lengths[0]), y: parseFloat(lengths[1]) }, radius: Math.max(0, parseFloat(lengths[2])), spread: parseFloat(lengths[3] || 0), visible: true, blendMode: 'NORMAL' }]; }
  }
}
function layoutPlan(source, children) {
  let spec = source.layout;
  const flow = children.filter(c => !['absolute', 'fixed'].includes(c.source.flow?.position));
  if (!spec && ['button', 'link', 'input'].includes(source.semantic?.kind) && flow.length === 1 && flow[0].source.type === 'text') {
    const b = source.bounds, t = flow[0].source.bounds;
    const left = Math.max(0, t.x - b.x), top = Math.max(0, t.y - b.y);
    // Native inline controls have no flex metadata; their measured insets give
    // an equivalent editable row without inventing a different layout.
    spec = { mode: 'HORIZONTAL', gap: 0, padding: [top, Math.max(0, b.width - left - flow[0].target.width), Math.max(0, b.height - top - flow[0].target.height), left], justify: 'start', align: 'start', measured: true };
  }
  if (!spec) return null;
  const reject = reason => ({ skipped: reason });
  if (!['HORIZONTAL', 'VERTICAL'].includes(spec.mode)) return reject('줄바꿈·역방향 배치');
  if (!flow.length) return reject('일반 흐름 자식 없음');
  if (flow.some(c => c.source.flow?.margin?.some(v => Math.abs(v) > .1))) return reject('자식 margin');
  const justify = { 'flex-start': 'MIN', start: 'MIN', normal: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', 'space-between': 'SPACE_BETWEEN' }[spec.justify];
  const align = { 'flex-start': 'MIN', start: 'MIN', normal: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', stretch: 'MIN' }[spec.align];
  if (!justify || !align || flow.some(c => c.source.flow?.align && !['auto', 'normal', spec.align].includes(c.source.flow.align))) return reject('복합 정렬');
  const horizontal = spec.mode === 'HORIZONTAL';
  const mainSize = horizontal ? 'width' : 'height', crossSize = horizontal ? 'height' : 'width';
  const mainPos = horizontal ? 'x' : 'y', crossPos = horizontal ? 'y' : 'x';
  const border = spec.measured ? 0 : Math.max(0, source.style?.borderWidth || 0);
  const padding = spec.padding.map(v => v + border);
  const mainStart = padding[horizontal ? 3 : 0], mainEnd = padding[horizontal ? 1 : 2];
  const crossStart = padding[horizontal ? 0 : 3], crossEnd = padding[horizontal ? 2 : 1];
  const room = source.bounds[mainSize] - mainStart - mainEnd;
  const crossRoom = source.bounds[crossSize] - crossStart - crossEnd;
  const free = room - flow.reduce((sum, c) => sum + c.target[mainSize], 0) - spec.gap * (flow.length - 1);
  const spacing = justify === 'SPACE_BETWEEN' && flow.length > 1 ? spec.gap + Math.max(0, free) / (flow.length - 1) : spec.gap;
  let cursor = mainStart + (justify === 'CENTER' ? free / 2 : justify === 'MAX' ? free : 0);
  for (const child of flow) {
    const crossFree = crossRoom - child.target[crossSize];
    const cross = crossStart + (align === 'CENTER' ? crossFree / 2 : align === 'MAX' ? crossFree : 0);
    if (Math.abs(cursor - (child.source.bounds[mainPos] - source.bounds[mainPos])) > 3 ||
        Math.abs(cross - (child.source.bounds[crossPos] - source.bounds[crossPos])) > 3 ||
        (spec.align === 'stretch' && Math.abs(child.target[crossSize] - crossRoom) > 3)) return reject('측정 좌표와 Auto Layout 불일치');
    cursor += child.target[mainSize] + spacing;
  }
  if (free < -3) return reject('자식이 컨테이너보다 큼');
  return { mode: spec.mode, padding, spacing: spec.gap, justify, align, stretch: spec.align === 'stretch', flow };
}
function applyStructure(byId, warnings) {
  const entries = [...byId.values()], children = new Map();
  for (const entry of entries) { const list = children.get(entry.source.parentId) || []; list.push(entry); children.set(entry.source.parentId, list); }
  let autoLayoutCount = 0, preservedLayoutCount = 0;
  for (const { source, target } of [...entries].reverse()) {
    if (source.type !== 'frame') continue;
    const owned = children.get(source.id) || [], plan = layoutPlan(source, owned);
    if (plan?.skipped) { preservedLayoutCount++; target.setPluginData('layerBridgeLayoutFallback', plan.skipped); continue; }
    if (!plan) continue;
    target.layoutMode = plan.mode;
    target.primaryAxisSizingMode = 'FIXED'; target.counterAxisSizingMode = 'FIXED';
    target.layoutWrap = 'NO_WRAP'; target.itemSpacing = plan.spacing;
    target.primaryAxisAlignItems = plan.justify; target.counterAxisAlignItems = plan.align;
    [target.paddingTop, target.paddingRight, target.paddingBottom, target.paddingLeft] = plan.padding;
    for (const child of owned) {
      const isFlow = plan.flow.includes(child);
      child.target.layoutPositioning = isFlow ? 'AUTO' : 'ABSOLUTE';
      if (isFlow) { child.target.layoutGrow = 0; child.target.layoutAlign = plan.stretch ? 'STRETCH' : 'INHERIT'; }
      else { child.target.x = child.source.bounds.x - source.bounds.x; child.target.y = child.source.bounds.y - source.bounds.y; }
    }
    target.resize(source.bounds.width, source.bounds.height);
    autoLayoutCount++;
  }
  const components = [];
  for (const { source, target } of entries) if (target.type === 'COMPONENT') {
    const texts = [];
    function collect(id) {
      for (const child of children.get(id) || []) {
        if (child.target.type === 'COMPONENT') continue;
        if (child.target.type === 'TEXT') texts.push(child.target);
        collect(child.source.id);
      }
    }
    collect(source.id);
    for (const [index, text] of texts.slice(0, 16).entries()) {
      const label = texts.length === 1 ? (source.semantic.kind === 'input' ? 'Value' : 'Label') : `Text ${index + 1}`;
      const key = target.addComponentProperty(label, 'TEXT', text.characters);
      text.componentPropertyReferences = { ...(text.componentPropertyReferences || {}), characters: key };
    }
    target.description = 'Layer Bridge · ' + source.semantic.kind + ' · 텍스트 속성과 내부 레이어를 편집하거나 인스턴스로 재사용하세요.';
    components.push({ id: target.id, name: target.name, kind: source.semantic.kind, textProperties: Math.min(texts.length, 16) });
  }
  if (preservedLayoutCount) warnings.add(`${preservedLayoutCount}개 복합 배치는 원본 좌표를 유지했습니다. 레이어의 layerBridgeLayoutFallback에 사유를 기록했습니다.`);
  return { componentCount: components.length, autoLayoutCount, preservedLayoutCount, components: components.slice(0, 20) };
}
function collectionStages(page, id) {
  const stages=[];
  function walk(parent){for(const node of parent.children||[]){
    if(node.getPluginData('layerBridgeCollection')===id){stages.push(node);continue;}
    if(node.getPluginData('layerBridgePageCollection')===id||node.getPluginData('layerBridgeStateFamily'))walk(node);
  }}
  walk(page);return stages;
}
function organizeCollection(input) {
  if(!input||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)||!Array.isArray(input.plans)||input.plans.length>1000)throw Error('Invalid collection arrangement');
  const page=figma.currentPage, stages=collectionStages(page,input.id), prepared=[], unresolved=[];
  const plans=new Map(input.plans.map(p=>[p.screenId,p]));
  for(const stage of stages){
    const screenId=stage.getPluginData('layerBridgeCaptureKey').slice(input.id.length+1);
    const savedPlan=JSON.parse(stage.getPluginData('layerBridgeCompactPlan')||'null'),requested=plans.get(screenId);
    const plan=requested?{...requested,cropNative:savedPlan?.cropNative===false?false:requested.cropNative}:savedPlan;
    if(!plan)continue;
    if(!stage.getPluginData('layerBridgeResult')){
      unresolved.push({nodeId:stage.id,screenId});
      continue;
    }
    const c=plan.crop;
    if(typeof plan.url!=='string'||typeof plan.family!=='string'||typeof plan.label!=='string'||!c||!['x','y','width','height'].every(k=>Number.isFinite(c[k]))||c.x<0||c.y<0||c.width<=0||c.height<=0||c.width>20000||c.height>20000)throw Error('Invalid state region');
    prepared.push({stage,plan});
  }
  const pageFrames=new Map();
  const previous=page.children.filter(n=>n.getPluginData('layerBridgePageCollection')===input.id);
  for(const node of previous)pageFrames.set(node.getPluginData('layerBridgePageUrl'),node);
  let nextX=previous.length?Math.max(...previous.map(n=>n.x+n.width))+200:(prepared.length?Math.min(...prepared.map(p=>p.stage.x)):0);
  const top=previous.length?previous[0].y:(prepared.length?Math.min(...prepared.map(p=>p.stage.y)):0);
  for(const {stage,plan} of prepared){
    let board=pageFrames.get(plan.url);
    if(!board){board=figma.createFrame();page.appendChild(board);board.name='Page / '+(plan.pageLabel||plan.url);board.fills=LayerBridge.paint('#f3f5f8');board.clipsContent=false;board.x=nextX;board.y=top;nextX+=3440;board.resize(3240,100);board.setPluginData('layerBridgePageCollection',input.id);board.setPluginData('layerBridgePageUrl',plan.url);pageFrames.set(plan.url,board);}
    let family=board.children.find(n=>n.getPluginData('layerBridgeStateFamily')===plan.family);
    if(!family){family=figma.createFrame();board.appendChild(family);family.name=plan.family;family.fills=[];family.clipsContent=false;family.setPluginData('layerBridgeStateFamily',plan.family);}
    if(!stage.getPluginData('layerBridgeBeforeCompact'))stage.setPluginData('layerBridgeBeforeCompact',JSON.stringify({parentId:stage.parent.id,x:stage.x,y:stage.y,width:stage.width,height:stage.height,children:stage.children.map(n=>({id:n.id,x:n.x,y:n.y}))}));
    const original=JSON.parse(stage.getPluginData('layerBridgeBeforeCompact'));
    family.appendChild(stage);stage.name=plan.label;stage.clipsContent=true;
    if(plan.cropNative!==false){for(const child of stage.children){const pos=original.children.find(p=>p.id===child.id);if(pos){child.x=pos.x-plan.crop.x;child.y=pos.y-plan.crop.y;}}stage.resize(plan.crop.width,plan.crop.height);}
    stage.setPluginData('layerBridgeCompactPlan',JSON.stringify(plan));
  }
  for(const board of pageFrames.values()){
    let y=40;
    for(const family of board.children){let x=0,rowY=0,rowHeight=0,maxWidth=0;
      for(const stage of family.children){if(x&&x+stage.width>3160){x=0;rowY+=rowHeight+70;rowHeight=0;}stage.x=x;stage.y=rowY;x+=stage.width+40;rowHeight=Math.max(rowHeight,stage.height);maxWidth=Math.max(maxWidth,x-40);}
      family.x=40;family.y=y;family.resize(Math.max(1,maxWidth),Math.max(1,rowY+rowHeight));y+=family.height+100;
    }
    board.resize(Math.max(3240,...board.children.map(n=>n.width+80)),Math.max(100,y));
  }
  if(prepared.length){page.selection=[...pageFrames.values()];figma.viewport.scrollAndZoomIntoView(page.selection);}
  return {arranged:prepared.length,pageFrames:[...pageFrames.values()].map(n=>({id:n.id,name:n.name,groups:n.children.length})),unresolved,frames:prepared.map(({stage,plan})=>({screenId:plan.screenId,nodeId:stage.id,crop:plan.crop}))};
}

async function importCapture(capture, options) {
  const importPage = figma.currentPage;
  LayerBridge.validateCapture(capture);
  if (options.organizeCollection) return organizeCollection(options.organizeCollection);
  const collection = capture.source?.collection;
  const captureKey = collection && capture.source?.screenId ? collection.id + '/' + capture.source.screenId : null;
  if (captureKey) {
    const existing = collectionStages(importPage, collection.id).find(node => node.getPluginData('layerBridgeCaptureKey') === captureKey);
    if (existing) {
      const previous = existing.getPluginData('layerBridgeResult');
      if (!previous) throw new Error('이 화면의 기존 가져오기 상태를 확인해야 합니다.');
      return { ...JSON.parse(previous), reused: true };
    }
  }
  const warnings = new Set(capture.warnings || []);
  const available = await figma.listAvailableFontsAsync();
  if (figma.currentPage.id !== importPage.id) throw new Error('페이지가 변경되었습니다. 원하는 페이지에서 플러그인을 다시 연결하세요.');
  const loaded = new Map();
  async function fontFor(style) {
    const families = (style.fontFamily || 'Inter').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    const bold = style.fontWeight >= 600, italic = style.fontStyle === 'italic';
    const wanted = italic ? (bold ? 'Bold Italic' : 'Italic') : bold ? 'Bold' : 'Regular';
    let selected;
    const exact = ['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black'][Math.max(0, Math.min(8, Math.round((style.fontWeight || 400) / 100) - 1))] + (italic ? ' Italic' : '');
    for (const family of families) {
      const candidates = available.filter(f => f.fontName.family.toLowerCase() === family.toLowerCase());
      selected = candidates.find(f => f.fontName.style.replace(/\s/g, '').toLowerCase() === exact.replace(/\s/g, '').toLowerCase()) || candidates.find(f => f.fontName.style === wanted) || candidates.find(f => f.fontName.style === 'Regular') || candidates[0];
      if (selected) break;
    }
    if (!selected) { selected = available.find(f => f.fontName.family === 'Inter' && f.fontName.style === wanted) || available.find(f => f.fontName.family === 'Inter'); warnings.add(`대체 폰트: ${families[0]} → ${selected?.fontName.family || 'Inter'}`); }
    const font = selected?.fontName || { family: 'Inter', style: 'Regular' };
    const key = font.family + '/' + font.style;
    if (!loaded.has(key)) loaded.set(key, figma.loadFontAsync(font));
    await loaded.get(key); return font;
  }
  const previousStages = importPage.children.filter(node => node.type === 'FRAME' && (
    node.getPluginData('layerBridgeCapture') === '1' ||
    (node.name.startsWith('Layer Bridge / ') && !!node.getPluginData('source'))
  ));
  const rightmostStage = previousStages.reduce((rightmost, node) => !rightmost || node.x + node.width > rightmost.x + rightmost.width ? node : rightmost, null);
  const stage = figma.createFrame();
  importPage.appendChild(stage);
  stage.name = `Layer Bridge / ${capture.title || '화면'}`;
  stage.setPluginData('layerBridgeCapture', '1');
  stage.fills = []; stage.clipsContent = false;
  const w = capture.viewport.width, h = capture.viewport.height;
  stage.resize(w * (options.reference && capture.screenshot ? 2 : 1) + (options.reference && capture.screenshot ? 80 : 0), h);
  stage.x = rightmostStage ? rightmostStage.x + rightmostStage.width + 120 : figma.viewport.center.x - stage.width / 2;
  stage.y = rightmostStage ? rightmostStage.y : figma.viewport.center.y - h / 2;
  if (collection) {
    const members = previousStages.filter(node => node.getPluginData('layerBridgeCollection') === collection.id);
    const anchor = members.length ? JSON.parse(members[0].getPluginData('layerBridgeCollectionAnchor')) : { x: stage.x, y: stage.y };
    stage.x = anchor.x + (collection.index % 4) * (stage.width + 120);
    stage.y = anchor.y + Math.floor(collection.index / 4) * (h + 160);
    stage.setPluginData('layerBridgeCollection', collection.id);
    stage.setPluginData('layerBridgeCollectionAnchor', JSON.stringify(anchor));
    stage.setPluginData('layerBridgeCaptureKey', captureKey || '');
  }
  try {
    let offset = 0;
    if (options.reference && capture.screenshot) {
      const reference = figma.createRectangle(); stage.appendChild(reference); reference.name = '00 · 원본 화면 (잠금)'; reference.resize(w, h); reference.x = 0; reference.y = 0; reference.fills = rasterFill(capture.screenshot, 'FILL'); reference.locked = true; offset = w + 80;
    }
    const root = figma.createFrame(); stage.appendChild(root); root.name = '01 · 편집 가능한 재현'; root.resize(w, h); root.x = offset; root.y = 0; root.clipsContent = true;
    root.fills = LayerBridge.paint(capture.background).length ? LayerBridge.paint(capture.background) : LayerBridge.paint('#ffffff');
    const byId = new Map();
    // Figma forbids main components inside other main components. Keep
    // enclosing semantic containers as editable frames; leaf controls remain
    // reusable components with their own label properties.
    const sources = new Map(capture.nodes.map(node => [node.id, node]));
    const enclosingComponents = new Set();
    for (const source of capture.nodes) if (source.semantic?.component) {
      for (let parent = sources.get(source.parentId); parent; parent = sources.get(parent.parentId)) {
        if (parent.semantic?.component) enclosingComponents.add(parent.id);
      }
    }
    if (enclosingComponents.size) warnings.add(`${enclosingComponents.size}개 중첩 컨테이너는 편집 가능한 프레임으로 유지하고 내부 버튼·링크를 컴포넌트로 만들었습니다.`);
    for (let i = 0; i < capture.nodes.length; i++) {
      if (figma.currentPage.id !== importPage.id) throw new Error('가져오는 도중 페이지가 변경되어 생성 중인 프레임을 취소했습니다.');
      const source = capture.nodes[i];
      // The collector already splits DOM text into visual lines. Do not wrap a
      // line again when Figma uses slightly different font metrics or a fallback.
      const isDomLine = source.type === 'text' && source.source === 'dom-text' && !/[\r\n\u2028\u2029]/.test(source.text);
      let target;
      if (source.type === 'text') {
        target = figma.createText();
        // Attach immediately so a failed import can remove every newly created node.
        root.appendChild(target);
        const s = source.style || {};
        target.fontName = await fontFor(s);
        target.fontSize = Math.max(1, Math.min(1000, s.fontSize || 14));
        target.characters = source.text;
        target.fills = LayerBridge.paint(s.color).length ? LayerBridge.paint(s.color) : LayerBridge.paint('#202623');
        if (s.lineHeight > 0) target.lineHeight = { unit: 'PIXELS', value: Math.min(2000, s.lineHeight) };
        target.letterSpacing = { unit: 'PIXELS', value: Math.max(-100, Math.min(1000, s.letterSpacing || 0)) };
        target.textAutoResize = isDomLine ? 'WIDTH_AND_HEIGHT' : 'NONE';
        target.textAlignHorizontal = 'LEFT';
        if ((s.textDecoration || '').includes('underline')) target.textDecoration = 'UNDERLINE';
        else if ((s.textDecoration || '').includes('line-through')) target.textDecoration = 'STRIKETHROUGH';
        target.opacity = Number.isFinite(s.opacity) ? Math.max(0, Math.min(1, s.opacity)) : 1;
      } else if (source.type === 'svg') {
        target = figma.createNodeFromSvg(source.svg); root.appendChild(target);
      } else {
        target = source.type === 'frame' && source.semantic?.component && !enclosingComponents.has(source.id) ? figma.createComponent() : figma.createFrame();
        root.appendChild(target); decorate(target, source); target.clipsContent = !!source.clip;
        if (source.type === 'image') {
          if (source.image) target.fills = rasterFill(source.image, source.imageFit);
          else { target.fills = LayerBridge.paint('#e6e8e5'); warnings.add(`${source.name}: 이미지 누락`); }
        }
      }
      const parent = source.parentId ? byId.get(source.parentId) : null;
      (parent?.target || root).appendChild(target);
      const labels = { button: 'Button', input: 'Input', link: 'Link', card: 'Card', navigation: 'Navigation', header: 'Header', section: 'Section' };
      target.name = source.semantic ? `${labels[source.semantic.kind]} / ${source.semantic.label || source.name}` : source.name || source.type;
      const b = source.bounds;
      // SVG children must scale together; resize alone only changes its container.
      if (source.type === 'svg' && target.width > 0) { const ratio = b.width / target.width; target.rescale(ratio); }
      if (isDomLine) {
        if (Math.abs(target.width - b.width) > Math.max(2, b.width * .02)) warnings.add('웹 텍스트의 원본 줄바꿈을 유지했습니다. 피그마 폰트의 글자 폭 차이로 일부 줄 너비가 원본과 다를 수 있습니다.');
      } else target.resize(Math.max(.01, b.width), Math.max(.01, b.height));
      target.x = b.x - (parent?.source.bounds.x || 0);
      target.y = b.y - (parent?.source.bounds.y || 0);
      target.setPluginData('layerBridgeSource', source.source || 'manual');
      target.setPluginData('layerBridgeId', source.id);
      if (source.semantic) target.setPluginData('layerBridgeSemantic', JSON.stringify(source.semantic));
      byId.set(source.id, { target, source });
      if (i % 40 === 0) { figma.ui.postMessage({ type: 'progress', done: i, total: capture.nodes.length }); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    const structure = applyStructure(byId, warnings);
    stage.setPluginData('source', JSON.stringify(capture.source || {}));
    stage.setPluginData('warnings', JSON.stringify([...warnings]));
    if (figma.currentPage.id !== importPage.id) throw new Error('페이지가 변경되었습니다. 원하는 페이지에서 다시 실행하세요.');
    importPage.selection = [stage]; figma.viewport.scrollAndZoomIntoView([stage]);
    figma.notify(`${capture.nodes.length}개 편집 가능한 레이어를 가져왔습니다.`);
    // Return bounded evidence from the actual created nodes. Clients can verify
    // editability without walking the same large layer tree after every import.
    const created = [...byId.values()].map(item => item.target);
    const types = {};
    for (const node of created) types[node.type] = (types[node.type] || 0) + 1;
    const textSamples = created.filter(node => node.type === 'TEXT')
      .sort((a, b) => b.characters.length - a.characters.length).slice(0, 4)
      .map(node => ({ id: node.id, text: node.characters.slice(0, 120) }));
    const result = { nodeId: stage.id, editableRootId: root.id, pageId: importPage.id, count: capture.nodes.length,
      nativeSummary: { types, textSamples, ...structure }, warnings: [...warnings] };
    if (captureKey) stage.setPluginData('layerBridgeResult', JSON.stringify(result));
    if (collection && capture.source.presentation) {
      const plan = { ...capture.source.presentation, screenId: capture.source.screenId, cropNative: false };
      stage.setPluginData('layerBridgeCompactPlan', JSON.stringify(plan));
      organizeCollection({ id: collection.id, plans: [plan] });
    }
    return result;
  } catch (error) { stage.remove(); throw error; }
}
function documentInfo() {
  return { name: figma.root.name, pageName: figma.currentPage.name, pageId: figma.currentPage.id,
    ...(figma.fileKey ? { fileKey: figma.fileKey } : {}),
    pages: figma.root.children.map(page => ({ id: page.id, name: page.name })),
    frames: figma.currentPage.children.slice(0, 100).map(node => ({ id: node.id, name: node.name, type: node.type })),
    selection: (figma.currentPage.selection || []).map(node => node.id) };
}
function describeNode(node, depth, budget) {
  budget.left--;
  const result = { id: node.id, name: node.name, type: node.type };
  if(node.getPluginData('layerBridgeCaptureKey')) result.captureState={key:node.getPluginData('layerBridgeCaptureKey'),complete:!!node.getPluginData('layerBridgeResult')};
  for (const key of ['x', 'y', 'width', 'height', 'opacity', 'visible', 'locked']) if (typeof node[key] === 'number' || typeof node[key] === 'boolean') result[key] = node[key];
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    for (const key of ['layoutMode', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems', 'counterAxisAlignItems']) result[key] = node[key];
  }
  if (node.type === 'COMPONENT') result.componentPropertyDefinitions = Object.fromEntries(Object.entries(node.componentPropertyDefinitions).slice(0, 16));
  if (node.type === 'TEXT') {
    result.text = node.characters.slice(0, 10000);
    if (node.characters.length > 10000) result.textTruncated = true;
    if (typeof node.fontSize === 'number') result.fontSize = node.fontSize;
    if (node.fontName && node.fontName !== figma.mixed) result.fontName = node.fontName;
  }
  if ('fills' in node && Array.isArray(node.fills)) result.fills = node.fills.slice(0, 10).map(fill => fill.type === 'SOLID' ? { type: fill.type, color: fill.color, opacity: fill.opacity } : { type: fill.type });
  if ('children' in node) {
    result.childCount = node.children.length;
    if (depth > 0) {
      result.children = [];
      for (const child of node.children) { if (budget.left <= 0) break; result.children.push(describeNode(child, depth - 1, budget)); }
      if (result.children.length < result.childCount) result.childrenTruncated = true;
    }
  }
  return result;
}
async function findNode(id) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('올바른 nodeId가 필요합니다.');
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.removed) throw new Error('레이어를 찾을 수 없습니다: ' + id);
  if (node.type === 'PAGE') await node.loadAsync();
  return node;
}
function boundedNumber(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(name + ' 값은 ' + min + ' ~ ' + max + ' 범위의 숫자여야 합니다.');
}
async function loadNodeFonts(node) {
  if (node.hasMissingFont) throw new Error('원본 폰트가 없습니다. 피그마에서 폰트를 교체한 뒤 다시 시도하세요.');
  const fonts = node.characters.length ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
  const unique = new Map();
  for (const font of fonts) {
    if (!font || font === figma.mixed) throw new Error('텍스트 폰트를 확인할 수 없습니다.');
    unique.set(font.family + '/' + font.style, font);
  }
  await Promise.all([...unique.values()].map(font => figma.loadFontAsync(font)));
}
async function updateNode(payload) {
  const node = await findNode(payload.nodeId), changes = payload.changes;
  function checkPage() {
    if (payload.expectedPageId && payload.expectedPageId !== figma.currentPage.id) throw new Error('연결한 페이지가 변경되었습니다. 플러그인을 다시 연결하세요.');
    let parent = node;
    while (parent && parent.type !== 'PAGE') parent = parent.parent;
    if (!parent || parent.id !== figma.currentPage.id) throw new Error('현재 연결된 페이지의 레이어만 수정할 수 있습니다.');
  }
  checkPage();
  if (node.type === 'PAGE' || node.type === 'DOCUMENT') throw new Error('페이지와 문서는 수정할 수 없습니다.');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('changes 객체가 필요합니다.');
  const keys = Object.keys(changes), allowed = ['name', 'text', 'x', 'y', 'width', 'height', 'fontSize', 'fill'];
  if (!keys.length || keys.some(key => !allowed.includes(key))) throw new Error('지원하지 않는 수정 항목입니다.');
  for (const key of keys) {
    const value = changes[key];
    if (key === 'name' && (typeof value !== 'string' || value.length > 1000)) throw new Error('레이어 이름이 올바르지 않습니다.');
    if (key === 'text' && (node.type !== 'TEXT' || typeof value !== 'string' || value.length > 100000)) throw new Error('text는 텍스트 레이어에만 적용할 수 있습니다.');
    if (['x', 'y'].includes(key)) { if (!(key in node)) throw new Error('위치를 수정할 수 없는 레이어입니다.'); boundedNumber(value, key, -1000000, 1000000); }
    if (['width', 'height'].includes(key)) { if (typeof node.resize !== 'function') throw new Error('크기를 수정할 수 없는 레이어입니다.'); boundedNumber(value, key, .01, 100000); }
    if (key === 'fontSize') { if (node.type !== 'TEXT') throw new Error('fontSize는 텍스트 레이어에만 적용할 수 있습니다.'); boundedNumber(value, key, 1, 1000); }
    if (key === 'fill' && (!('fills' in node) || typeof value !== 'string' || (value !== 'transparent' && !LayerBridge.color(value)))) throw new Error('fill은 #RRGGBB, rgb(), rgba(), transparent 형식이어야 합니다.');
  }
  // All validation and font loading finish before the first document mutation.
  const touchesText = node.type === 'TEXT' && keys.some(key => ['text', 'fontSize', 'width', 'height'].includes(key));
  if (touchesText) await loadNodeFonts(node);
  checkPage();
  const before = { name: node.name, x: node.x, y: node.y, width: node.width, height: node.height, fills: node.fills };
  const styleKeys = ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'hyperlink'];
  if (touchesText) { before.text = node.characters; before.fontName = node.fontName; before.fontSize = node.fontSize; before.segments = node.characters.length && typeof node.getStyledTextSegments === 'function' ? node.getStyledTextSegments(styleKeys) : []; }
  try {
    if ('name' in changes) node.name = changes.name;
    if ('text' in changes) node.characters = changes.text;
    if ('fontSize' in changes) node.fontSize = changes.fontSize;
    if ('fill' in changes) node.fills = LayerBridge.paint(changes.fill);
    if ('width' in changes || 'height' in changes) node.resize(changes.width === undefined ? node.width : changes.width, changes.height === undefined ? node.height : changes.height);
    if ('x' in changes) node.x = changes.x;
    if ('y' in changes) node.y = changes.y;
  } catch (error) {
    try {
      node.name = before.name;
      if (touchesText) {
        node.characters = before.text;
        if (before.fontName !== figma.mixed) node.fontName = before.fontName;
        if (before.fontSize !== figma.mixed) node.fontSize = before.fontSize;
        for (const segment of before.segments) for (const key of styleKeys) {
          const setter = 'setRange' + key[0].toUpperCase() + key.slice(1);
          if (typeof node[setter] === 'function' && segment[key] !== undefined) node[setter](segment.start, segment.end, segment[key]);
        }
      }
      if (before.fills !== undefined) node.fills = before.fills;
      if (typeof node.resize === 'function') node.resize(before.width, before.height);
      if ('x' in node) node.x = before.x;
      if ('y' in node) node.y = before.y;
    } catch (rollbackError) { throw new Error((error.message || String(error)) + ' · 일부 변경 복구에 실패했습니다. 피그마 실행 취소로 확인하세요: ' + rollbackError.message); }
    throw error;
  }
  return { node: describeNode(node, 0, { left: 1 }), pageId: figma.currentPage.id };
}
function base64(data) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks = [];
  for (let i = 0; i < data.length; i += 3) {
    const n = (data[i] << 16) | ((data[i + 1] || 0) << 8) | (data[i + 2] || 0);
    chunks.push(alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < data.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < data.length ? alphabet[n & 63] : '='));
  }
  return chunks.join('');
}
async function executeCommand(operation, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('명령 데이터가 올바르지 않습니다.');
  if (['import_capture', 'update_node'].includes(operation) && payload.expectedPageId && payload.expectedPageId !== figma.currentPage.id) throw new Error('연결한 페이지가 변경되었습니다. 원하는 페이지에서 플러그인을 다시 연결하세요.');
  if (operation === 'import_capture') return importCapture(payload.capture, payload.options || {});
  if (operation === 'get_document') return documentInfo();
  if (operation === 'get_selection') {
    const budget = { left: 200 }, nodes = [];
    for (const node of figma.currentPage.selection || []) { if (budget.left <= 0) break; nodes.push(describeNode(node, 1, budget)); }
    return { pageId: figma.currentPage.id, nodes, count: (figma.currentPage.selection || []).length, truncated: nodes.length < (figma.currentPage.selection || []).length };
  }
  if (operation === 'inspect_node') {
    const depth = payload.depth === undefined ? 2 : payload.depth;
    boundedNumber(depth, 'depth', 0, 6); if (!Number.isInteger(depth)) throw new Error('depth는 정수여야 합니다.');
    return { node: describeNode(await findNode(payload.nodeId), depth, { left: 200 }) };
  }
  if (operation === 'update_node') return updateNode(payload);
  if (operation === 'export_png') {
    const node = await findNode(payload.nodeId), scale = payload.scale === undefined ? 1 : payload.scale;
    boundedNumber(scale, 'scale', .1, 4);
    if (typeof node.exportAsync !== 'function' || node.type === 'PAGE' || node.type === 'DOCUMENT') throw new Error('내보낼 프레임이나 레이어를 선택하세요.');
    if (node.width * scale * node.height * scale > 16000000) throw new Error('PNG는 1,600만 픽셀 이하여야 합니다. scale을 낮추세요.');
    const data = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    if (data.length > 16000000) throw new Error('PNG 결과가 16MB를 초과합니다. scale을 낮추세요.');
    // Read PNG IHDR: effects and fractional bounds may change actual export dimensions.
    const u32 = offset => ((data[offset] * 0x1000000) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]);
    return { base64: base64(data), mimeType: 'image/png', width: data.length >= 24 ? u32(16) : Math.ceil(node.width * scale), height: data.length >= 24 ? u32(20) : Math.ceil(node.height * scale) };
  }
  throw new Error('지원하지 않는 명령입니다: ' + operation);
}
function enqueue(task) {
  const result = commandQueue.then(task);
  commandQueue = result.catch(() => {});
  return result;
}
figma.ui.onmessage = message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'import') return enqueue(async () => {
    try { figma.ui.postMessage({ type: 'complete', ...await importCapture(message.capture, message.options || {}) }); }
    catch (error) { figma.ui.postMessage({ type: 'error', message: error.message || String(error) }); }
  });
  if (message.type !== 'bridge-command' || typeof message.id !== 'string' || !message.id || message.id.length > 200) return;
  const id = message.id;
  // Keep tombstones for this plugin lifetime. Even an evicted result never reruns a mutation.
  if (seenCommands.has(id)) return (commandResults.get(id) || Promise.resolve({ type: 'bridge-result', id, ok: false, error: '이미 처리된 명령입니다. 결과 보관 기간이 끝났으며 변경을 재실행하지 않았습니다.' })).then(result => figma.ui.postMessage(result));
  seenCommands.add(id);
  const pending = enqueue(async () => {
    try { return { type: 'bridge-result', id, ok: true, result: await executeCommand(message.operation, message.payload) }; }
    catch (error) { return { type: 'bridge-result', id, ok: false, error: error.message || String(error) }; }
  });
  commandResults.set(id, pending);
  return pending.then(result => {
    figma.ui.postMessage(result);
    if (commandResults.size > 64) commandResults.delete(commandResults.keys().next().value);
  });
};
