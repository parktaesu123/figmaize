import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { captureUrl } from '../server/capture-url.mjs';

// Read one 8-bit RGB/RGBA browser PNG without an image library in tests.
function pngPixel(dataUrl, x, y) {
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.ok([2, 6].includes(png[25]));
  const channels = png[25] === 6 ? 4 : 3;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  let previous = Buffer.alloc(stride);
  for (let row = 0; row <= y; row++) {
    const type = raw[row * (stride + 1)], current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0, up = previous[i], corner = i >= channels ? previous[i - channels] : 0;
      const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
      const prediction = type === 0 ? 0 : type === 1 ? left : type === 2 ? up : type === 3 ? Math.floor((left + up) / 2) : pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      current[i] = (raw[row * (stride + 1) + i + 1] + prediction) & 255;
    }
    previous = current;
  }
  const pixel = [...previous.subarray(x * channels, x * channels + channels)];
  if (channels === 3) pixel.push(255);
  return { width, height, pixel };
}

test('URL capture rejects unsafe schemes and embedded credentials before browser launch', async () => {
  for (const url of [undefined, '', 'not-a-url', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'https://name:password@example.com/']) {
    await assert.rejects(captureUrl({ url }), /URL/);
  }
});

test('URL capture validates viewport, wait and title bounds before browser launch', async () => {
  for (const options of [{ width: 1 }, { height: 4000 }, { width: 240.5 }, { width: '1440' }, { width: 3840, height: 3840 }, { waitMs: 5001 }, { waitMs: -1 }, { waitMs: NaN }, { title: 42 }, { title: 'x'.repeat(161) }]) {
    await assert.rejects(captureUrl({ url: 'https://example.com/', ...options }));
  }
  await assert.rejects(captureUrl(null));
});

// Opt in so the ordinary unit suite works without Chrome installed or browser
// permissions. This fixture only listens on loopback and never contacts a site.
test('isolated URL capture produces editable text, vector and raster layers', { skip: process.env.LB_TEST_BROWSER !== '1', timeout: 45_000 }, async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const forceTaint = req.url === '/tainted' ? "const serialize=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){if(this.width===240&&this.height===240)throw new DOMException('Tainted canvas','SecurityError');return serialize.apply(this,args)};" : '';
    res.end(`<!doctype html><title>Fixture</title><style>body{margin:0;background:white}h1{font:24px Arial}iframe{width:100px;height:50px;border:0}</style><h1>Editable heading</h1><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="red"/></svg><iframe title="Raster fixture" srcdoc="<body style='margin:0;background:blue'>Raster</body>"></iframe><iframe id="offscreen" style="position:absolute;left:-20px;top:120px" srcdoc="<body style='margin:0;background:blue'></body>"></iframe><input type="password" value="SECRET"><canvas id="source" width="480" height="120" style="display:none"></canvas><video id="hero-video" autoplay muted playsinline style="position:absolute;left:-40px;top:200px;width:240px;height:240px;object-fit:cover;object-position:25% 50%"></video><div style="position:absolute;left:0;top:220px;width:100px;height:40px;background:red">Editable overlay</div><script>document.cookie='fixture=private';${forceTaint}const canvas=document.querySelector('#source'),ctx=canvas.getContext('2d');ctx.fillStyle='#008000';ctx.fillRect(0,0,240,120);ctx.fillStyle='blue';ctx.fillRect(240,0,240,120);const video=document.querySelector('video');video.srcObject=canvas.captureStream(5);video.play();</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  const capture = await captureUrl({ url, width: 640, height: 480, title: 'MCP capture', waitMs: 300 });
  assert.equal(capture.title, 'MCP capture');
  assert.deepEqual(capture.viewport, { width: 640, height: 480, devicePixelRatio: 1 });
  assert.match(capture.screenshot, /^data:image\/png;base64,/);
  assert.equal(capture.source.url, url);
  const text = capture.nodes.filter(node => node.type === 'text').map(node => node.text).join('|');
  assert.match(text, /Editable heading/);
  assert.match(text, /••••••/);
  assert.doesNotMatch(text, /SECRET/);
  assert.ok(capture.nodes.some(node => node.type === 'svg' && node.svg.includes('<circle')));
  const raster = capture.nodes.find(node => node.name === 'iframe');
  assert.equal(raster.rasterized, true);
  assert.equal(raster.needsRaster, undefined);
  assert.match(raster.image, /^data:image\/png;base64,/);
  const partial = capture.nodes.find(node => node.name === 'offscreen');
  assert.equal(partial.rasterized, true);
  assert.deepEqual(partial.bounds, { x: 0, y: 120, width: 80, height: 50 });
  assert.deepEqual(pngPixel(partial.image, 20, 20), { width: 80, height: 50, pixel: [0, 0, 255, 255] });
  const video = capture.nodes.find(node => node.name === 'hero-video');
  assert.equal(video.rasterized, true);
  assert.equal(video.needsRaster, undefined);
  assert.deepEqual(video.bounds, { x: -40, y: 200, width: 240, height: 240 });
  // The source frame stays green beneath the red editable overlay. Sampling
  // its right edge also checks object-position:25% with a cover-cropped video.
  const frame = pngPixel(video.image, 230, 40);
  assert.equal(frame.width, 240); assert.equal(frame.height, 240);
  assert.ok(frame.pixel[0] < 5 && frame.pixel[1] > 120 && frame.pixel[2] < 5, JSON.stringify(frame));
  assert.match(text, /Editable.*overlay/);
  assert.ok(capture.warnings.some(warning => warning.includes('로그인 정보')));
  assert.equal(requests.find(req => req.path === '/fixture').cookie, undefined);
  const fallback = await captureUrl({ url: url.replace('/fixture', '/tainted'), width: 640, height: 480, waitMs: 300 });
  const fallbackVideo = fallback.nodes.find(node => node.name === 'hero-video');
  assert.equal(fallbackVideo.rasterized, true);
  assert.equal(fallbackVideo.needsRaster, undefined);
  assert.deepEqual(fallbackVideo.bounds, { x: 0, y: 200, width: 200, height: 240 });
  const fallbackFrame = pngPixel(fallbackVideo.image, 50, 40);
  assert.ok(fallbackFrame.pixel[0] < 5 && fallbackFrame.pixel[1] > 120 && fallbackFrame.pixel[2] < 5, JSON.stringify(fallbackFrame));
  assert.ok(fallback.warnings.some(warning => warning.includes('영상의 보이는 영역')));
  assert.equal(requests.find(req => req.path === '/tainted').cookie, undefined);
});

test('browser captures semantic components, merged labels, flex metrics and fixed header order', {skip:process.env.LB_TEST_BROWSER!=='1',timeout:45000}, async t=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>body{margin:0;font:16px Arial}.actions{display:flex;gap:12px;padding:16px;align-items:center}button{display:flex;align-items:center;justify-content:center;gap:4px;padding:10px 16px;border:0}.card{width:300px;padding:20px;display:flex;flex-direction:column;gap:16px}nav{position:fixed;z-index:100;top:0;right:0}main{background:white}</style><div id="header-wrapper"><nav id="fixed-header"><a href="/">Home</a></nav></div><main><article class="card" aria-label="Account"><div class="actions"><button aria-label="Save"><span><span>S</span><span>a</span><span>v</span><span>e</span></span><span style="opacity:0;position:absolute">Save</span></button><a href="/help">Help</a></div><input aria-label="Email" placeholder="Email"><input type="password" value="SECRET"></article></main>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const capture=await captureUrl({url:`http://127.0.0.1:${server.address().port}/`,width:640,height:480,waitMs:0});
  const button=capture.nodes.find(n=>n.semantic?.kind==='button');
  assert.equal(button.semantic.label,'Save');assert.equal(button.semantic.component,true);assert.equal(button.layout.mode,'HORIZONTAL');
  assert.deepEqual(button.layout.padding,[10,16,10,16]);
  const label=capture.nodes.filter(n=>n.parentId===button.id);assert.equal(label.length,1);assert.equal(label[0].text,'Save');
  assert.ok(capture.nodes.some(n=>n.semantic?.kind==='card'));
  assert.ok(capture.nodes.some(n=>n.semantic?.kind==='input'&&n.semantic.label==='Email'));
  assert.ok(capture.nodes.some(n=>n.semantic?.kind==='link'));
  assert.ok(!JSON.stringify(capture.nodes.map(({image,...n})=>n)).includes('SECRET'));
  const header=capture.nodes.find(n=>n.name==='fixed-header'),body=capture.nodes.find(n=>!n.parentId);
  assert.equal(header.parentId,body.id);assert.equal(capture.nodes.filter(n=>n.parentId===body.id).at(-1).id,header.id);
});
