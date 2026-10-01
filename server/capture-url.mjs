import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import '../shared/schema.js';

const require = createRequire(import.meta.url);
const CAPTURE_TIMEOUT = 38_000; // Reserve two seconds for browser cleanup.
const MAX_RASTER_PIXELS = 16_000_000;

// Runs in the disposable source page. Keep video pixels separate from editable
// text laid over them. The returned handle retains DOM references only locally.
function snapshotVideoFrames(nodes) {
  const videos = [];
  const roots = [document];
  while (roots.length) {
    const root = roots.pop();
    videos.push(...root.querySelectorAll('video'));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  const snapshots = [], failed = [], used = new Set();
  for (const node of nodes) {
    const video = videos.find(el => {
      if (used.has(el)) return false;
      const name = (el.getAttribute('aria-label') || el.id || el.getAttribute('data-testid') || `video${el.classList.length ? '.' + el.classList[0] : ''}`).slice(0, 90);
      const rect = el.getBoundingClientRect();
      return name === node.name && ['x', 'y', 'width', 'height'].every(key => Math.abs(rect[key] - node.bounds[key]) < 0.1);
    });
    if (!video) continue;
    used.add(video);
    try {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Video frame unavailable');
      const b = node.bounds, style = getComputedStyle(video);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2048 / Math.max(b.width, b.height));
      canvas.width = Math.max(1, Math.round(b.width * scale));
      canvas.height = Math.max(1, Math.round(b.height * scale));
      let drawWidth = b.width, drawHeight = b.height;
      if (style.objectFit !== 'fill') {
        const contain = Math.min(b.width / video.videoWidth, b.height / video.videoHeight);
        const factor = style.objectFit === 'cover' ? Math.max(b.width / video.videoWidth, b.height / video.videoHeight)
          : style.objectFit === 'none' ? 1 : style.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
        drawWidth = video.videoWidth * factor; drawHeight = video.videoHeight * factor;
      }
      const position = style.objectPosition.split(/\s+/);
      const offset = (value, freeSpace, axisScale) => {
        if (value === 'left' || value === 'top') return 0;
        if (value === 'right' || value === 'bottom') return freeSpace;
        if (value?.endsWith('%')) return freeSpace * parseFloat(value) / 100;
        if (value?.endsWith('px')) return parseFloat(value) * axisScale;
        return freeSpace / 2;
      };
      const dx = offset(position[0], b.width - drawWidth, b.width / (parseFloat(style.width) || b.width));
      const dy = offset(position[1], b.height - drawHeight, b.height / (parseFloat(style.height) || b.height));
      canvas.getContext('2d').drawImage(video, dx * scale, dy * scale, drawWidth * scale, drawHeight * scale);
      snapshots.push({ id: node.id, image: canvas.toDataURL('image/png') });
    } catch { failed.push({ id: node.id, video }); }
  }
  return { snapshots, failed };
}

function viewportIntersection(b, width, height) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, width: Math.max(0, Math.min(width, b.x + b.width) - x), height: Math.max(0, Math.min(height, b.y + b.height) - y) };
}

function captureOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('URL 수집 옵션을 입력하세요.');
  const { url, width = 1440, height = 900, title, waitMs = 800 } = value;
  let target;
  try { if (typeof url !== 'string' || url.length > 8192) throw new Error(); target = new URL(url); }
  catch { throw new Error('유효한 http 또는 https URL을 입력하세요.'); }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('URL 수집은 http 또는 https만 지원합니다.');
  if (target.username || target.password) throw new Error('URL에 로그인 정보를 넣을 수 없습니다. 로그인된 화면은 브라우저 확장으로 수집하세요.');
  for (const [key, number] of Object.entries({ width, height })) {
    if (!Number.isInteger(number) || number < 240 || number > 3840) throw new Error(`${key}는 240~3840 사이의 정수여야 합니다.`);
  }
  if (width * height > 8_294_400) throw new Error('화면 크기는 총 8,294,400 픽셀 이하여야 합니다.');
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw new Error('waitMs는 0~5000 사이의 정수여야 합니다.');
  if (title !== undefined && (typeof title !== 'string' || title.length > 160)) throw new Error('title은 160자 이하의 문자열이어야 합니다.');
  return { url: target.href, width, height, title: title?.trim(), waitMs };
}

export async function chromiumRuntime() {
  let playwright;
  try { playwright = require('playwright'); }
  catch {
    const modulesPath = process.env.LB_NODE_MODULES || path.join(process.env.HOME || homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
    try { playwright = require(path.join(modulesPath, 'playwright')); }
    catch { throw new Error('URL 수집에 Playwright가 필요합니다. 프로젝트에서 npm install --save-dev playwright 후 npx playwright install chromium을 실행하거나 LB_NODE_MODULES를 지정하세요.'); }
  }
  const candidates = process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : [playwright.chromium.executablePath(), ...(process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : [])];
  for (const executablePath of candidates) {
    try { await access(executablePath); return { chromium: playwright.chromium, executablePath }; }
    catch { /* Try the next installed browser. Never install or download implicitly. */ }
  }
  throw new Error('실행 가능한 Chromium을 찾지 못했습니다. npx playwright install chromium을 실행하거나 CHROME_PATH를 지정하세요.');
}

/**
 * Capture a URL in a new disposable Chromium context. This intentionally never
 * uses CDP, a persistent user profile, storageState, cookies, or saved passwords.
 * The result is the visible first viewport, including any login/error screen.
 */
export async function captureUrl(options) {
  const { url, width, height, title, waitMs } = captureOptions(options);
  let browser;
  let stopped = false;
  let deadlineTimer;
  const checkActive = () => { if (stopped) throw new Error('URL 수집이 취소되었습니다.'); };
  const run = async () => {
    const { chromium, executablePath } = await chromiumRuntime();
    checkActive();
    browser = await chromium.launch({ executablePath, headless: true, timeout: 12_000, chromiumSandbox: true });
    if (stopped) { await browser.close(); checkActive(); }
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
    checkActive();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    // Dismiss page-authored dialogs; collecting a page never submits a dialog.
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    checkActive();
    await page.evaluate(async () => {
      await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 1500))]);
    });
    if (waitMs) await page.waitForTimeout(waitMs);
    checkActive();
    return captureRenderedPage(browser, page, { width, height, title, response, checkActive });
  };
  try {
    return await Promise.race([
      run(),
      new Promise((_, reject) => { deadlineTimer = setTimeout(() => {
        stopped = true;
        reject(new Error('URL 수집 제한 시간(40초)을 초과했습니다. 더 작은 화면이나 브라우저 확장으로 다시 시도하세요.'));
      }, CAPTURE_TIMEOUT); }),
    ]);
  } catch (error) {
    // Avoid reflecting query strings containing tokens in a tool error.
    const visibleUrl = new URL(url).origin + new URL(url).pathname;
    throw new Error(`URL 수집 실패: ${String(error?.message || error).split(url).join(visibleUrl)}`, { cause: error });
  } finally {
    stopped = true;
    clearTimeout(deadlineTimer);
    if (browser) {
      let cleanupTimer;
      await Promise.race([browser.close().catch(() => {}), new Promise(resolve => { cleanupTimer = setTimeout(resolve, 2000); })]);
      clearTimeout(cleanupTimer);
    }
  }
}


/** Capture an already-rendered, isolated page after navigation or a UI action. */
export async function captureRenderedPage(browser, page, { width, height, title, response, checkActive = () => {} }) {
    await page.evaluate(async () => {
      // Do not freeze a newly attached stream before its first decoded frame.
      await Promise.all([...document.querySelectorAll('video')].map(video => {
        if (video.readyState >= 2 || video.paused) return;
        return new Promise(resolve => {
          const done = () => { clearTimeout(timer); video.removeEventListener('loadeddata', done); resolve(); };
          const timer = setTimeout(done, 1500);
          video.addEventListener('loadeddata', done, { once: true });
        });
      }));
      for (const animation of document.getAnimations()) { try { animation.pause(); } catch {} }
      for (const video of document.querySelectorAll('video')) video.pause();
    });
    const collector = await readFile(new URL('../extension/collector.js', import.meta.url), 'utf8');
    // This is checked-in collector code, never JavaScript extracted from a page.
    await page.evaluate(collector);
    const capture = await page.evaluate(() => globalThis.LayerBridgeCollector.capture());
    const screenshot = await page.screenshot({ type: 'png', fullPage: false, caret: 'hide', timeout: 5000 });
    checkActive();
    capture.screenshot = `data:image/png;base64,${screenshot.toString('base64')}`;
    if (title) capture.title = title;
    capture.warnings.push('로그인 정보·쿠키를 공유하지 않는 새 브라우저에서 수집했습니다.');
    capture.warnings.push('현재 보이는 화면 영역만 수집합니다. 동적 콘텐츠와 겹친 이미지 영역은 원본과 비교하세요.');
    if (response && response.status() >= 400) capture.warnings.push(`페이지가 HTTP ${response.status()} 상태를 반환했습니다. 표시된 오류 화면을 확인하세요.`);

    const byId = new Map(capture.nodes.map(node => [node.id, node]));
    const videoState = await page.evaluateHandle(snapshotVideoFrames, capture.nodes.filter(node => node.needsRaster));
    const videoSnapshots = await videoState.evaluate(state => state.snapshots);
    const failedVideoIds = await videoState.evaluate(state => state.failed.map(item => item.id));
    const failedVideos = new Set(failedVideoIds);
    for (const snapshot of videoSnapshots) {
      const node = byId.get(snapshot.id);
      Object.assign(node, { image: snapshot.image, imageFit: 'FILL', rasterized: true });
      delete node.needsRaster;
    }
    try {
      for (const id of failedVideoIds.slice(0, 8)) {
        const node = byId.get(id), b = viewportIntersection(node.bounds, width, height);
        if (!b.width || !b.height) continue;
        const video = await videoState.evaluateHandle((state, id) => state.failed.find(item => item.id === id).video, id);
        let visibility;
        try {
          // A cross-origin video may taint drawImage. Hide all other elements in
          // this temporary browser, preserving layout, clips and the paused frame.
          // Do not crop the original screenshot: it contains editable headlines.
          visibility = await page.evaluateHandle(video => {
            const styles = [], roots = [document];
            while (roots.length) {
              const root = roots.pop();
              for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) roots.push(el.shadowRoot);
                styles.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
                el.style.setProperty('visibility', 'hidden', 'important');
              }
            }
            video.style.setProperty('visibility', 'visible', 'important');
            return styles;
          }, video);
          const pixels = await page.screenshot({ type: 'png', clip: b, omitBackground: true, caret: 'hide', timeout: 3000 });
          Object.assign(node, { image: `data:image/png;base64,${pixels.toString('base64')}`, imageFit: 'FILL', rasterized: true, bounds: b });
          delete node.needsRaster;
          capture.warnings.push(`${node.name}: 영상의 보이는 영역을 정지 이미지로 유지합니다.`);
        } catch {
          capture.warnings.push(`${node.name}: 독립 영상 프레임을 읽지 못했습니다. 원본 화면에서 확인하세요.`);
        } finally {
          if (visibility) {
            await visibility.evaluate(styles => { for (const [el, value, priority] of styles) { if (value) el.style.setProperty('visibility', value, priority); else el.style.removeProperty('visibility'); } }).catch(() => {});
            await visibility.dispose();
          }
          await video.dispose();
        }
      }
    } finally { await videoState.dispose(); }

    const rasterNodes = [];
    let rasterPixels = 0;
    for (const node of capture.nodes) {
      if (!node.needsRaster || failedVideos.has(node.id)) continue;
      const b = viewportIntersection(node.bounds, width, height);
      if (!b.width || !b.height) continue;
      rasterPixels += Math.ceil(b.width) * Math.ceil(b.height);
      if (rasterPixels > MAX_RASTER_PIXELS || rasterNodes.length >= 500) {
        capture.warnings.push('이미지 추출 용량 제한으로 일부 영역은 원본 화면에서 확인해야 합니다.');
        break;
      }
      rasterNodes.push({ id: node.id, bounds: b });
    }
    if (rasterNodes.length) {
      // Crop on a second, empty origin: the captured page cannot inspect the
      // screenshot, alter canvas operations, or attach its own script handlers.
      const cropContext = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
      const cropPage = await cropContext.newPage();
      const crops = await cropPage.evaluate(async ({ screenshot, nodes }) => {
        const image = new Image(); image.src = screenshot; await image.decode();
        return nodes.map(({ id, bounds: b }) => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(b.width)); canvas.height = Math.max(1, Math.round(b.height));
          canvas.getContext('2d').drawImage(image, b.x, b.y, b.width, b.height, 0, 0, canvas.width, canvas.height);
          return { id, image: canvas.toDataURL('image/png') };
        });
      }, { screenshot: capture.screenshot, nodes: rasterNodes });
      await cropContext.close();
      const byId = new Map(capture.nodes.map(node => [node.id, node]));
      for (const crop of crops) {
        const node = byId.get(crop.id);
        Object.assign(node, { image: crop.image, imageFit: 'FILL', rasterized: true, bounds: viewportIntersection(node.bounds, width, height) });
        delete node.needsRaster;
      }
    }
    checkActive();
    capture.warnings = [...new Set(capture.warnings)];
    return globalThis.LayerBridge.validateCapture(capture);
}
