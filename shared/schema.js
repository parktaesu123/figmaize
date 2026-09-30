(function (scope) {
  'use strict';
  const VERSION = 1;
  const MAX_NODES = 5000;
  function validateCapture(value) {
    if (!value || value.format !== 'layer-bridge' || value.version !== VERSION) throw new Error('지원하지 않는 파일입니다. Layer Bridge v1 JSON을 선택하세요.');
    const size = value.viewport;
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 1 || size.height < 1 || size.width > 20000 || size.height > 20000) throw new Error('화면 크기가 올바르지 않습니다.');
    if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) throw new Error('레이어 수가 허용 범위를 벗어났습니다.');
    const ids = new Set();
    const kinds = new Map();
    const depths = new Map();
    for (const node of value.nodes) {
      if (!node || typeof node.id !== 'string' || ids.has(node.id)) throw new Error('레이어 ID가 없거나 중복됩니다.');
      if (!['frame', 'text', 'image', 'svg'].includes(node.type)) throw new Error('알 수 없는 레이어 종류입니다.');
      if (node.parentId && !ids.has(node.parentId)) throw new Error('부모 레이어가 자식보다 먼저 있어야 합니다.');
      if (node.parentId && kinds.get(node.parentId) !== 'frame') throw new Error('부모 레이어는 프레임이어야 합니다.');
      const depth = node.parentId ? depths.get(node.parentId) + 1 : 0;
      if (depth > 100) throw new Error('레이어 중첩이 너무 깊습니다.');
      depths.set(node.id, depth);
      ids.add(node.id);
      kinds.set(node.id, node.type);
      if (typeof node.name !== 'string') throw new Error('레이어 이름이 올바르지 않습니다.');
      const b = node.bounds;
      if (!b || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) || b.width <= 0 || b.height <= 0 || b.width > 100000 || b.height > 100000 || Math.abs(b.x) > 1000000 || Math.abs(b.y) > 1000000) throw new Error('레이어 좌표가 올바르지 않습니다.');
      if (node.type === 'text' && (typeof node.text !== 'string' || node.text.length > 100000)) throw new Error('텍스트 데이터가 올바르지 않습니다.');
      if (node.type === 'svg' && (typeof node.svg !== 'string' || node.svg.length > 2000000 || /<\s*(script|foreignObject)\b|\bon\w+\s*=|(?:href|url)\s*[=(]\s*["']?\s*(?:https?:|javascript:|\/\/)/i.test(node.svg))) throw new Error('외부 참조나 실행 콘텐츠가 있는 SVG는 가져올 수 없습니다.');
      if (node.image && !isImage(node.image)) throw new Error('이미지는 PNG/JPEG/WebP 데이터로 포함해야 합니다.');
      if (node.semantic !== undefined) {
        const s = node.semantic;
        if (!s || !['button','input','link','card','navigation','header','section'].includes(s.kind) || typeof s.label !== 'string' || s.label.length > 100 || typeof s.component !== 'boolean' || s.component && !['button','input','link','card'].includes(s.kind)) throw new Error('컴포넌트 의미 정보가 올바르지 않습니다.');
      }
      if (node.layout !== undefined) {
        const l = node.layout;
        if (!l || !['HORIZONTAL','VERTICAL','PRESERVE'].includes(l.mode) || !Number.isFinite(l.gap) || l.gap < 0 || l.gap > 10000 || !Array.isArray(l.padding) || l.padding.length !== 4 || l.padding.some(n => !Number.isFinite(n) || n < 0 || n > 10000) || typeof l.justify !== 'string' || l.justify.length > 40 || typeof l.align !== 'string' || l.align.length > 40) throw new Error('Auto Layout 정보가 올바르지 않습니다.');
      }
      if (node.flow !== undefined) {
        const f = node.flow;
        if (!f || !['static','relative','absolute','fixed','sticky'].includes(f.position) || !Number.isFinite(f.grow) || f.grow < 0 || f.grow > 10000 || typeof f.align !== 'string' || f.align.length > 40 || !Array.isArray(f.margin) || f.margin.length !== 4 || f.margin.some(n => !Number.isFinite(n) || Math.abs(n) > 100000)) throw new Error('레이아웃 흐름 정보가 올바르지 않습니다.');
      }
    }
    if (value.screenshot && !isImage(value.screenshot)) throw new Error('원본 이미지 형식이 올바르지 않습니다.');
    if (value.warnings && (!Array.isArray(value.warnings) || value.warnings.some(w => typeof w !== 'string'))) throw new Error('확인 사항 형식이 올바르지 않습니다.');
    if (value.source?.collection !== undefined) {
      const c = value.source.collection;
      if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || !Number.isInteger(c.index) || c.index < 0 || c.index > 1000 || typeof value.source.screenId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.source.screenId)) throw new Error('화면 모음 정보가 올바르지 않습니다.');
    }
    return value;
  }
  function isImage(value) { return typeof value === 'string' && value.length < 40000000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value); }
  const colorComponent = '([+-]?(?:\\d*\\.\\d+|\\d+)(?:e[+-]?\\d+)?%?)';
  const srgbColor = new RegExp('^color\\(\\s*srgb\\s+' + colorComponent + '\\s+' + colorComponent + '\\s+' + colorComponent + '(?:\\s*/\\s*' + colorComponent + ')?\\s*\\)$', 'i');
  function color(value) {
    if (typeof value !== 'string' || !value || value === 'transparent') return null;
    const clamp = n => Math.max(0, Math.min(1, n));
    let parts;
    if ((parts = /^#([a-f\d]{6})$/i.exec(value))) { const n = parseInt(parts[1], 16); return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a: 1 }; }
    if ((parts = srgbColor.exec(value.trim()))) {
      const channels = parts.slice(1).map(part => part === undefined ? 1 : parseFloat(part) / (part.endsWith('%') ? 100 : 1));
      if (!channels.every(Number.isFinite)) return null;
      const [r, g, b, a] = channels.map(clamp);
      return { r, g, b, a };
    }
    parts = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
    if (!parts || !parts.slice(1).every(part => part === undefined || Number.isFinite(+part))) return null;
    return { r: clamp(+parts[1] / 255), g: clamp(+parts[2] / 255), b: clamp(+parts[3] / 255), a: clamp(parts[4] === undefined ? 1 : +parts[4]) };
  }
  function paint(value) { const c = color(value); return c && c.a > 0 ? [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }] : []; }
  scope.LayerBridge = { VERSION, MAX_NODES, validateCapture, color, paint, isImage };
})(globalThis);
