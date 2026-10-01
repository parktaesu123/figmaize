import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PORT, getToken } from './config.mjs';
import '../shared/schema.js';

const OPERATIONS = new Set(['import_capture','get_document','get_selection','inspect_node','update_node','export_png','prepare_site']);
const LIMIT = 50 * 1024 * 1024;
export function createBridge({ token, now = Date.now, sessionTTL = 45000, jobTTL = 120000, siteService } = {}) {
  if (!token || token.length < 24) throw new Error('A pairing token of at least 24 characters is required');
  const sessions = new Map(), jobs = new Map();
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  function settle() {
    const time = now();
    for (const job of jobs.values()) {
      if (job.status === 'queued' && time - job.createdAt > jobTTL) { job.status = 'failed'; job.error = '피그마가 작업을 받기 전에 대기 시간이 만료되었습니다.'; delete job.payload; }
      if (job.status === 'running' && time - job.startedAt > jobTTL) { job.status = 'unknown'; job.error = '피그마 실행 결과를 받지 못했습니다. 캔버스를 확인하세요. 중복 실행을 막기 위해 자동 재전송하지 않습니다.'; delete job.payload; }
      if (['complete','failed','unknown'].includes(job.status) && time - (job.completedAt || job.startedAt || job.createdAt) > 30 * 60 * 1000) jobs.delete(job.id);
    }
    for (const [id,s] of sessions) if (time - s.lastSeen > 30 * 60 * 1000) sessions.delete(id);
  }
  function live(s) { return s && !s.disconnected && (now() - s.lastSeen < sessionTTL || [...jobs.values()].some(j => j.sessionId === s.id && j.status === 'running')); }
  function session(id) { const s = sessions.get(id); if (!s || s.disconnected) throw fail('피그마 연결이 없습니다. 플러그인에서 다시 연결하세요.', 404); return s; }
  function activeSessions() { settle(); return [...sessions.values()].filter(live).map(s => ({ id:s.id, document:s.document, connected:true })); }
  function chooseSession(id) {
    if (id) { const s = session(id); if (!live(s)) throw fail('피그마 플러그인이 응답하지 않습니다. 다시 연결하세요.', 409); return s; }
    const list = activeSessions();
    if (!list.length) throw fail('연결된 피그마가 없습니다. Layer Bridge 플러그인을 실행하고 연결 코드를 입력하세요.', 409);
    if (list.length !== 1) throw fail('피그마가 여러 개 연결되어 있습니다. sessionId를 지정하세요.', 409);
    return session(list[0].id);
  }
  function summary(j) { const {payload,...rest}=j; return rest; }
  function queue(operation, payload, sessionId) {
    settle();
    if (!OPERATIONS.has(operation)) throw fail('허용되지 않은 피그마 작업입니다.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('작업 데이터가 올바르지 않습니다.');
    const s = chooseSession(sessionId);
    if (['import_capture','update_node','prepare_site'].includes(operation) && [...jobs.values()].some(j=>j.sessionId===s.id&&j.status==='unknown')) throw fail('이 연결에 결과를 확인하지 못한 작업이 있습니다. 캔버스를 조회해 확인하고 플러그인을 다시 연결한 뒤 수정하세요.',409);
    if ([...jobs.values()].filter(j => ['queued','running'].includes(j.status)).length >= 20) throw fail('대기 중인 작업이 너무 많습니다.', 429);
    if(operation==='prepare_site'&&(typeof payload.collectionId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(payload.collectionId)||typeof payload.title!=='string'||payload.title.length>200))throw fail('Invalid site target');
    if (operation === 'import_capture') globalThis.LayerBridge.validateCapture(payload.capture);
    if (['inspect_node','update_node','export_png'].includes(operation) && (typeof payload.nodeId !== 'string' || !payload.nodeId)) throw fail('nodeId가 필요합니다.');
    if (['import_capture','update_node','prepare_site'].includes(operation)) payload.expectedPageId = s.document.pageId;
    const job = { id:randomUUID(), sessionId:s.id, operation, payload, status:'queued', createdAt:now() };
    jobs.set(job.id,job); return summary(job);
  }
  function originOK(origin) { return !origin || origin === 'null' || origin === 'https://www.figma.com' || origin === 'https://figma.com' || /^chrome-extension:\/\/[a-p]{32}$/.test(origin); }
  function authorized(header) { const supplied = Buffer.from(String(header || '').replace(/^Bearer /, '')); const expected = Buffer.from(token); return supplied.length === expected.length && timingSafeEqual(supplied,expected); }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('Content-Type must be application/json',415);
    if (Number(req.headers['content-length']) > LIMIT) throw fail('50MB 이하의 데이터를 보내세요.',413);
    let length=0;const chunks=[];
    for await (const chunk of req) { length += chunk.length; if (length > LIMIT) throw fail('50MB 이하의 데이터를 보내세요.',413); chunks.push(chunk); }
    let result; try { result=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('JSON object required');
    return result;
  }
  const server = http.createServer(async (req,res) => {
    const send = (code,data) => { if (res.writableEnded) return; res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
    try {
      const expectedHost=`127.0.0.1:${server.address().port}`;
      if (![expectedHost, `localhost:${server.address().port}`].includes(req.headers.host)) throw fail('Invalid Host',403);
      if (!originOK(req.headers.origin)) throw fail('Origin not allowed',403);
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin',req.headers.origin); res.setHeader('Vary','Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Private-Network','true'); res.writeHead(204); return res.end(); }
      if (!authorized(req.headers.authorization)) throw fail('연결 코드가 올바르지 않습니다.',401);
      settle();
      const url = new URL(req.url, `http://${expectedHost}`);
      if(url.pathname.startsWith('/v1/sites')){
        const service=siteService||await import('./site-jobs.mjs');
        if(req.method==='GET'&&url.pathname==='/v1/sites')return send(200,await service.listSiteCollections());
        if(req.method==='GET'&&url.pathname==='/v1/sites/status')return send(200,await service.siteCaptureStatus(url.searchParams.get('manifestPath')));
        if(req.method==='POST'){
          const data=await body(req);
          const action=url.pathname.slice('/v1/sites/'.length);
          if(action==='discover')return send(200,await service.discoverSite(data));
          if(action==='start')return send(202,await service.startSiteCapture(data));
          if(action==='cancel')return send(200,await service.cancelSite(data.manifestPath));
          if(action==='resume')return send(202,await service.resumeSiteCapture(data.manifestPath,data));
          if(action==='import'){chooseSession(data.sessionId);return send(202,await service.startSiteImport(data.manifestPath,data.sessionId,data.options));}
        }
        throw fail('Unknown site operation',404);
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(200,{name:'layer-bridge',version:'0.3.0-alpha.1',apiVersion:1,sessions:activeSessions().length});
      if (req.method === 'GET' && url.pathname === '/v1/sessions') return send(200,{sessions:activeSessions()});
      if (req.method === 'POST' && url.pathname === '/v1/connect') {
        const data=await body(req);
        if (typeof data.clientId !== 'string' || data.clientId.length < 8 || data.clientId.length > 160 || typeof data.document?.pageId !== 'string') throw fail('clientId와 document.pageId가 필요합니다.');
        // A new connection receives a new session. Never silently move queued work to another file.
        for (const s of sessions.values()) if (s.clientId === data.clientId) { s.disconnected=true; for (const j of jobs.values()) if(j.sessionId===s.id && j.status==='queued') { j.status='failed';j.error='플러그인이 다시 연결되어 이전 대기 작업을 취소했습니다.';delete j.payload; } }
        const id=randomUUID(); sessions.set(id,{id,clientId:data.clientId,document:{name:String(data.document.name||'Figma').slice(0,200),pageName:String(data.document.pageName||'').slice(0,200),pageId:data.document.pageId,fileKey:typeof data.document.fileKey==='string'?data.document.fileKey:undefined},lastSeen:now()});
        return send(200,{sessionId:id});
      }
      if (req.method === 'GET' && url.pathname === '/v1/poll') {
        const s=session(url.searchParams.get('sessionId'));s.lastSeen=now();
        if ([...jobs.values()].some(j=>j.sessionId===s.id&&j.status==='running')) return send(200,{job:null});
        const unresolved=[...jobs.values()].some(j=>j.sessionId===s.id&&j.status==='unknown');
        const job=[...jobs.values()].find(j=>j.sessionId===s.id&&j.status==='queued'&&!(unresolved&&['import_capture','update_node','prepare_site'].includes(j.operation)));
        if (!job) return send(200,{job:null});
        job.status='running';job.startedAt=now();
        return send(200,{job:{id:job.id,operation:job.operation,payload:job.payload}});
      }
      if (req.method === 'POST' && url.pathname === '/v1/result') {
        const data=await body(req);const s=session(data.sessionId);s.lastSeen=now();const job=jobs.get(data.jobId);
        if (!job || job.sessionId !== s.id) throw fail('이 연결에 속한 작업이 아닙니다.',404);
        if (['complete','failed'].includes(job.status)) return send(200,{accepted:true,duplicate:true});
        if (!['running','unknown'].includes(job.status) || typeof data.ok !== 'boolean') throw fail('작업 상태가 올바르지 않습니다.',409);
        job.status=data.ok?'complete':'failed';job.completedAt=now();delete job.payload;delete job.error;
        if(data.ok&&job.operation==='prepare_site'&&data.result?.document?.pageId)s.document={...s.document,...data.result.document};
        if (data.ok) job.result=data.result;else job.error=String(data.error||'피그마 작업 실패').slice(0,4000);
        return send(200,{accepted:true});
      }
      if (req.method === 'POST' && url.pathname === '/v1/disconnect') {
        const data=await body(req);const s=session(data.sessionId);s.disconnected=true;
        for (const j of jobs.values()) if(j.sessionId===s.id && j.status==='queued'){j.status='failed';j.error='피그마 연결이 종료되었습니다.';delete j.payload;}
        return send(200,{disconnected:true});
      }
      if (req.method === 'POST' && url.pathname === '/v1/captures') {
        const data=await body(req);const job=queue('import_capture',{capture:data.capture,options:{reference:data.reference!==false}},data.sessionId);
        return send(202,{jobId:job.id,status:job.status});
      }
      if (req.method === 'POST' && url.pathname === '/v1/commands') { const data=await body(req);return send(202,queue(data.operation,data.payload||{},data.sessionId)); }
      if (req.method === 'GET' && /^\/v1\/jobs\/[\w-]+$/.test(url.pathname)) { const job=jobs.get(url.pathname.split('/').pop());if(!job)throw fail('작업이 없거나 보관 시간이 지났습니다.',404);return send(200,summary(job)); }
      throw fail('Not found',404);
    } catch(error) { send(error.status || 400,{error:error.message}); }
  });
  server.requestTimeout=30000;
  const maintenance=setInterval(settle,10000);maintenance.unref();server.on('close',()=>clearInterval(maintenance));
  return {server, activeSessions, jobs, sessions, queue};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token=await getToken();const {server}=createBridge({token});
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Layer Bridge가 이미 실행 중입니다. node scripts/connection.mjs로 연결 정보를 확인하세요.':error.message);process.exitCode=1;});
  server.listen(PORT,'127.0.0.1',()=>console.error(`Layer Bridge listening on 127.0.0.1:${PORT}. Run node scripts/connection.mjs for pairing.`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
