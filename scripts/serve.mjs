import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4317);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requested === '/') requested = '/workbench/index.html';
    if (requested === '/app.js' || requested === '/style.css') requested = '/workbench' + requested;
    const allowed = /^\/(workbench|shared|examples)\//.test(requested);
    const file = path.resolve(root, '.' + requested);
    if (!allowed || !file.startsWith(root + path.sep) || requested.split('/').some(p => p.startsWith('.'))) { res.writeHead(403); return res.end('Forbidden'); }
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Open http://127.0.0.1:${port} or set PORT.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Layer Bridge: ${url}`);
  if (process.argv.includes('--open') && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
});
