(function (scope) {
  'use strict';
  function capture() {
    const width = window.innerWidth, height = window.innerHeight;
    const nodes = [], warnings = new Set();
    let seq = 0, visited = 0;
    const MAX = 2500;
    const round = n => Math.round(n * 100) / 100;
    const bounds = rect => ({ x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) });
    const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const intersect = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) });
    const add = node => { if (nodes.length >= MAX) { warnings.add('화면이 복잡해 2,500개 레이어까지만 수집했습니다.'); return null; } node.id = `n${++seq}`; nodes.push(node); return node.id; };
    const num = v => parseFloat(v) || 0;
    function styleOf(s) {
      return { background: s.backgroundColor, color: s.color, opacity: Number(s.opacity), radius: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(num), borderColor: s.borderTopColor, borderWidth: num(s.borderTopWidth), borderStyle: s.borderTopStyle, shadow: s.boxShadow, fontFamily: s.fontFamily, fontSize: num(s.fontSize), fontWeight: num(s.fontWeight), fontStyle: s.fontStyle, lineHeight: s.lineHeight === 'normal' ? num(s.fontSize) * 1.2 : num(s.lineHeight), letterSpacing: num(s.letterSpacing), textAlign: s.textAlign, textDecoration: s.textDecorationLine };
    }
    function semantics(el) {
      const tag = el.tagName.toLowerCase(), role = el.getAttribute('role');
      let kind = tag === 'button' || role === 'button' ? 'button'
        : ['input', 'textarea', 'select'].includes(tag) || ['textbox', 'combobox', 'checkbox', 'radio', 'switch'].includes(role) ? 'input'
        : tag === 'a' && el.hasAttribute('href') ? 'link'
        : tag === 'nav' || role === 'navigation' ? 'navigation'
        : tag === 'header' || role === 'banner' ? 'header'
        : tag === 'article' || /(?:^|[-_\s])card(?:$|[-_\s])/i.test(el.className || '') ? 'card'
        : tag === 'section' ? 'section' : null;
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) kind = 'button';
      if (!kind) return undefined;
      // Labels never contain form values, passwords or destination URLs.
      const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
        (kind === 'input' ? el.getAttribute('name') : el.textContent) || kind).replace(/\s+/g, ' ').trim().slice(0, 100);
      return { kind, label, component: ['button', 'input', 'link', 'card'].includes(kind) };
    }
    function layoutOf(s) {
      if (!['flex', 'inline-flex'].includes(s.display)) return undefined;
      const mode = s.flexWrap !== 'nowrap' || !['row', 'column'].includes(s.flexDirection) ? 'PRESERVE' : s.flexDirection === 'row' ? 'HORIZONTAL' : 'VERTICAL';
      return { mode, gap: num(s.flexDirection === 'column' ? s.rowGap : s.columnGap),
        padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(num),
        justify: s.justifyContent, align: s.alignItems };
    }
    function controlLabel(el, semantic, parentId, s, clip) {
      if (!semantic || !['button', 'link'].includes(semantic.kind) || el.querySelector('svg,img,canvas,video,input,button,a')) return false;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), parts = [];
      const controlBounds = el.getBoundingClientRect();
      let text, scanned = 0;
      while ((text = walker.nextNode()) && scanned++ < 200) {
        if (!text.textContent) continue;
        let visible = true;
        for (let parent = text.parentElement; parent && parent !== el; parent = parent.parentElement) {
          const cs = getComputedStyle(parent);
          if (cs.display === 'none' || cs.visibility !== 'visible' || +cs.opacity === 0) { visible = false; break; }
        }
        if (!visible) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        const rect = range.getBoundingClientRect();
        if (!intersects(rect, controlBounds) || !intersects(rect, clip)) continue;
        parts.push({ text, rect, rects });
      }
      if (!parts.length || scanned >= 200) return false;
      const firstStyle = getComputedStyle(parts[0].text.parentElement);
      if (parts.some(part => {
        const cs = getComputedStyle(part.text.parentElement);
        return ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'letterSpacing', 'textTransform'].some(k => cs[k] !== firstStyle[k]);
      })) return false;
      const rects = parts.flatMap(part => part.rects);
      if (rects.some(r => Math.abs(r.y - rects[0].y) > 3)) return false;
      const left = Math.min(...rects.map(r => r.x)), top = Math.min(...rects.map(r => r.y));
      const rect = { x: left, y: top, width: Math.max(...rects.map(r => r.right)) - left, height: Math.max(...rects.map(r => r.bottom)) - top };
      let label = parts.map(part => part.text.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!label) return false;
      if (firstStyle.textTransform === 'uppercase') label = label.toUpperCase();
      if (firstStyle.textTransform === 'lowercase') label = label.toLowerCase();
      const context = document.createElement('canvas').getContext('2d');
      context.font = `${firstStyle.fontStyle} ${firstStyle.fontWeight} ${firstStyle.fontSize} ${firstStyle.fontFamily}`;
      const expectedWidth = context.measureText(label).width + Math.max(0, label.length - 1) * num(firstStyle.letterSpacing);
      if (Math.abs(expectedWidth - rect.width) > 3) return false;
      if (!el.getAttribute('aria-label')) semantic.label = label.slice(0, 100);
      add({ type: 'text', parentId, name: 'Label', text: label, bounds: bounds(rect), style: { ...styleOf(firstStyle), opacity: 1 }, source: 'dom-text' });
      return true;
    }
    function imageData(el) {
      try {
        const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
        if (!w || !h) return null;
        const scale = Math.min(1, 2048 / Math.max(w, h));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, w * scale); canvas.height = Math.max(1, h * scale);
        canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      } catch { return null; }
    }
    function svgMarkup(el) {
      const clone = el.cloneNode(true);
      const originals = [el, ...el.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
      originals.forEach((original, i) => {
        const cs = getComputedStyle(original), copy = copies[i];
        for (const key of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color']) copy.setAttribute(key, cs.getPropertyValue(key));
        for (const attr of [...copy.attributes]) if (/^on/i.test(attr.name)) copy.removeAttribute(attr.name);
      });
      clone.querySelectorAll('script,foreignObject').forEach(n => n.remove());
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const rect = el.getBoundingClientRect(); clone.setAttribute('width', rect.width); clone.setAttribute('height', rect.height);
      const result = new XMLSerializer().serializeToString(clone);
      if (/(?:href|url)\s*[=(]\s*["']?\s*(?:https?:|javascript:|\/\/)/i.test(result) || clone.querySelector('use')) return null;
      return result;
    }
    function textNodes(textNode, parentId, s, clip) {
      const raw = textNode.textContent;
      if (!raw.trim()) return;
      if (raw.length > 6000) { warnings.add('6,000자를 넘는 텍스트 블록은 앞부분만 수집했습니다.'); }
      const range = document.createRange();
      let line = null;
      const flush = () => {
        if (!line || !line.text.trim()) { line = null; return; }
        let text = line.text;
        if (s.textTransform === 'uppercase') text = text.toUpperCase();
        else if (s.textTransform === 'lowercase') text = text.toLowerCase();
        add({ type: 'text', parentId, name: text.trim().slice(0, 48), text, bounds: bounds(line), style: { ...styleOf(s), opacity: 1 }, source: 'dom-text' });
        line = null;
      };
      for (let i = 0; i < Math.min(raw.length, 6000);) {
        const length = raw.codePointAt(i) > 0xffff ? 2 : 1;
        range.setStart(textNode, i); range.setEnd(textNode, i + length);
        const rect = range.getBoundingClientRect();
        let char = raw.slice(i, i + length); i += length;
        if (s.whiteSpace === 'normal' || s.whiteSpace === 'nowrap') char = char.replace(/\s/g, ' ');
        if (rect.width < .01 || rect.height < .01 || !intersects(rect, clip)) continue;
        if (!line || Math.abs(line.y - rect.y) > 2 || rect.x < line.x - 2) {
          flush(); line = { text: char, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        } else { line.text += char; line.width = Math.max(line.width, rect.right - line.x); line.height = Math.max(line.height, rect.height); }
      }
      flush();
    }
    function walk(el, parentId, clip, depth) {
      if (nodes.length >= MAX || visited++ > 20000 || depth > 80) { warnings.add('화면 복잡도 제한으로 일부 요소가 생략되었습니다.'); return; }
      if (!(el instanceof Element) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD'].includes(el.tagName)) return;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || +s.opacity === 0) return;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && intersects(rect, clip);
      if (s.display === 'contents' || (!visible && s.overflow === 'visible')) { for (const child of el.childNodes) { if (child.nodeType === 3) textNodes(child, parentId, s, clip); else walk(child, parentId, clip, depth + 1); } return; }
      if (!visible) return;
      const name = (el.getAttribute('aria-label') || el.id || el.getAttribute('data-testid') || `${el.tagName.toLowerCase()}${el.classList.length ? '.' + el.classList[0] : ''}`).slice(0, 90);
      const style = styleOf(s);
      const node = { type: 'frame', parentId, name, bounds: bounds(rect), style, source: 'dom', clip: /hidden|clip|scroll|auto/.test(`${s.overflowX} ${s.overflowY}`) };
      node.semantic = semantics(el);
      node.layout = layoutOf(s);
      node.flow = { position: s.position, grow: Math.max(0, num(s.flexGrow)), align: s.alignSelf,
        margin: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].map(num) };
      node.stack = { z: num(s.zIndex), boundary: el === document.body || s.position === 'fixed' || s.position === 'sticky' ||
        (s.position !== 'static' && s.zIndex !== 'auto') || +s.opacity < 1 || s.transform !== 'none' || s.filter !== 'none' || s.isolation === 'isolate' || s.contain.includes('paint') };
      if (s.transform !== 'none') warnings.add('CSS transform은 화면의 외접 사각형으로 근사합니다. 회전된 요소를 확인하세요.');
      if (s.filter !== 'none' || s.backdropFilter && s.backdropFilter !== 'none') warnings.add('필터·블러 효과는 완전히 재현되지 않습니다.');
      if (s.backgroundImage !== 'none') warnings.add('CSS 배경 이미지·그라디언트는 기본 배경색으로 대체합니다. 원본과 비교하세요.');
      if (s.clipPath && s.clipPath !== 'none') warnings.add('clip-path는 재현하지 않습니다.');
      if (s.borderTopWidth !== s.borderBottomWidth || s.borderTopWidth !== s.borderLeftWidth || s.borderTopWidth !== s.borderRightWidth) warnings.add('비대칭 테두리는 위쪽 테두리 기준으로 근사합니다.');
      for (const pseudo of ['::before', '::after']) { const ps = getComputedStyle(el, pseudo); if (ps.content && !['none', 'normal', '""'].includes(ps.content)) warnings.add('가상 요소(::before/::after)는 제외됩니다. 아이콘·장식을 확인하세요.'); }
      if (el.tagName.toLowerCase() === 'svg') {
        node.svg = svgMarkup(el); node.type = node.svg ? 'svg' : 'image';
        if (!node.svg) { node.needsRaster = true; warnings.add('외부 참조 SVG는 화면 이미지로 유지합니다.'); }
        add(node); return;
      }
      if (['IMG', 'CANVAS', 'VIDEO', 'IFRAME'].includes(el.tagName)) {
        node.type = 'image';
        node.image = ['IMG', 'CANVAS'].includes(el.tagName) ? imageData(el) : null;
        node.imageFit = s.objectFit === 'contain' ? 'FIT' : 'FILL';
        if (!node.image) { node.needsRaster = true; warnings.add('일부 이미지·캔버스·iframe은 화면 캡처로 유지합니다. 겹쳐진 요소가 있으면 확인하세요.'); }
        add(node); return;
      }
      const id = add(node); if (!id) return;
      const childClip = node.clip ? intersect(clip, rect) : clip;
      if (controlLabel(el, node.semantic, id, s, childClip)) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        let text = el.type === 'password' ? '••••••' : el.value || el.getAttribute('placeholder') || '';
        if (el.tagName === 'SELECT') text = el.selectedOptions[0]?.text || '';
        if (['checkbox', 'radio', 'range', 'color', 'file'].includes(el.type)) warnings.add('네이티브 폼 컨트롤은 배경·텍스트만 재구성합니다.');
        if (text) add({ type: 'text', parentId: id, name: '입력 내용', text, bounds: { x: rect.x + num(s.paddingLeft) + num(s.borderLeftWidth), y: rect.y + num(s.paddingTop) + num(s.borderTopWidth), width: Math.max(1, rect.width - num(s.paddingLeft) - num(s.paddingRight) - 2 * num(s.borderLeftWidth)), height: Math.max(1, num(s.fontSize) * 1.2) }, style: { ...style, opacity: 1 }, source: 'dom-input' });
        return;
      }
      const children = [...el.childNodes];
      // Stable local z-index ordering; complex nested stacking contexts need visual review.
      const ordered = children.map((child, index) => ({ child, index, z: child.nodeType === 1 ? num(getComputedStyle(child).zIndex) : 0 })).sort((a, b) => a.z - b.z || a.index - b.index);
      for (const { child } of ordered) { if (child.nodeType === 3) textNodes(child, id, s, childClip); else walk(child, id, childClip, depth + 1); }
      if (el.shadowRoot) { warnings.add('Shadow DOM은 열린 루트만 수집합니다.'); for (const child of el.shadowRoot.children) walk(child, id, childClip, depth + 1); }
    }
    const clip = { x: 0, y: 0, width, height };
    walk(document.body, null, clip, 0);
    // Fixed headers escape normal-flow wrappers in CSS. Preserve clipping and
    // stacking boundaries, and only lift through transparent structural frames.
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) if (node.flow?.position === 'fixed') {
      let parent = byId.get(node.parentId);
      while (parent && !parent.stack?.boundary && !parent.clip && parent.parentId) {
        node.parentId = parent.parentId; parent = byId.get(parent.parentId);
      }
    }
    const children = new Map();
    for (const node of nodes) { const list = children.get(node.parentId) || []; list.push(node); children.set(node.parentId, list); }
    const sorted = [];
    function emit(parent) {
      const list = children.get(parent) || [];
      list.sort((a, b) => (a.stack?.z || 0) - (b.stack?.z || 0));
      for (const node of list) { sorted.push(node); emit(node.id); }
    }
    emit(null); nodes.splice(0, nodes.length, ...sorted);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return { format: 'layer-bridge', version: 1, title: document.title || 'Untitled screen', source: { kind: 'web', url: location.origin + location.pathname, capturedAt: new Date().toISOString(), scrollX: window.scrollX, scrollY: window.scrollY }, viewport: { width, height, devicePixelRatio: window.devicePixelRatio }, background: bodyBg === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : bodyBg, nodes, warnings: [...warnings] };
  }
  scope.LayerBridgeCollector = { capture };
})(globalThis);
