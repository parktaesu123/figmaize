import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {captureSite,discoverSite,siteOptions} from '../server/site-capture.mjs';
import {createBridge} from '../server/bridge.mjs';
const token='test-figmaize-token-with-sufficient-length';
test('authenticated site API routes share one service and never accept unauthenticated jobs',async t=>{
 const calls=[];const service={startSiteCapture:async data=>{calls.push(data);return {status:'started'};},listSiteCollections:async()=>({collections:[]})};
 const {server}=createBridge({token,siteService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;
 const body=JSON.stringify({url:'https://example.com'}),headers={'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/v1/sites/start',{method:'POST',headers,body})).status,401);assert.equal(calls.length,0);
 assert.equal((await fetch(base+'/v1/sites/start',{method:'POST',headers:{...headers,Authorization:'Bearer '+token},body})).status,202);assert.equal(calls.length,1);
});
test('page and selected capture scopes are validated independently',()=>{
 const page=siteOptions({url:'https://example.com/?test=1',mode:'page',maxPages:50});assert.equal(page.maxPages,1);assert.equal(page.url,'https://example.com/?test=1');
 assert.throws(()=>siteOptions({url:'https://example.com/en',mode:'selected',selectedUrls:['https://elsewhere.test/en']}));
 assert.throws(()=>siteOptions({url:'https://example.com',mode:'unknown'}));
});
test('three site types capture editable content, selected pages stay scoped, cancellation resumes without duplicates',{skip:process.env.LB_TEST_BROWSER!=='1',timeout:90000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'figmaize-product-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>${req.url}</title><style>body{font:16px Arial}nav{display:flex;gap:12px}button{padding:12px}dialog{background:white}</style><nav><a href="/landing">Landing</a><a href="/dashboard">Dashboard</a><a href="/cards">Cards</a></nav>${req.url==='/landing'?'<h1>Editable landing</h1><button id="cta">Try the demo</button>':req.url==='/dashboard'?'<h1>Dashboard</h1><div style="display:flex;gap:20px"><article>Revenue 120</article><article>Users 240</article></div>':'<h1>Cards</h1><article><button id="open" onclick="document.querySelector(\'dialog\').showModal()">Details</button></article><dialog>Editable popup<button onclick="this.parentNode.close()">Close</button></dialog>'}`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin='http://127.0.0.1:'+server.address().port;
 const found=await discoverSite({url:origin});assert.ok(found.pages.some(p=>p.url===origin+'/cards'));
 const options={url:origin,mode:'selected',selectedUrls:['/landing','/dashboard','/cards'],width:640,height:480,scroll:false,maxPages:5,maxScreens:20};let cancel=false;
 const first=await captureSite(options,{outputDir:dir,shouldCancel:async()=>cancel,onProgress:p=>{if(p.captured===1)cancel=true;}});assert.equal(first.manifest.status,'cancelled');assert.equal(first.manifest.screens.filter(s=>s.status==='captured').length,1);
 const resumed=await captureSite(options,{outputDir:dir});assert.equal(resumed.manifest.pages.length,3);assert.ok(resumed.manifest.complete);assert.equal(new Set(resumed.manifest.screens.map(s=>s.id)).size,resumed.manifest.screens.length);
 const texts=[];for(const s of resumed.manifest.screens.filter(s=>s.path)){const c=JSON.parse(await readFile(path.join(dir,s.path)));texts.push(...c.nodes.filter(n=>n.type==='text').map(n=>n.text));}
 for(const expected of ['Editable landing','Dashboard','Editable popup'])assert.ok(texts.some(s=>s.includes(expected)),expected);
 const single=await captureSite({url:origin,mode:'page',scroll:false,interactions:false},{outputDir:path.join(dir,'single')});assert.equal(single.manifest.pages.length,1);
});

test('background workers and setup CLI complete a collection through the real HTTP service',{skip:process.env.LB_TEST_BROWSER!=='1',timeout:60000},async t=>{
 const {spawn,execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const root=new URL('../',import.meta.url),dir=await mkdtemp(path.join(os.tmpdir(),'figmaize-workers-'));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const env={...process.env,FIGMAIZE_DATA_DIR:dir,LAYER_BRIDGE_PORT:String(port),LAYER_BRIDGE_TOKEN:token};
 const child=spawn(process.execPath,['server/bridge.mjs'],{cwd:root,env,stdio:'pipe'});let log='';child.stderr.on('data',d=>log+=d);child.stdout.resume();
 t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.exitCode===null?child.once('exit',r):r());await rm(dir,{recursive:true,force:true});});
 const request=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 const wait=async fn=>{const until=Date.now()+25000;while(Date.now()<until){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Worker timeout: '+log);};
 await wait(async()=>{try{return await request('/health');}catch{return false;}});
 const setup=await promisify(execFile)(process.execPath,['bin/figmaize.mjs','setup'],{cwd:root,env});assert.match(setup.stdout,/Figma development manifest/);assert.equal(JSON.parse(await readFile(path.join(dir,'plugin/manifest.json'))).name,'figmaize');
 const mcp=JSON.parse(await readFile(path.join(dir,'mcp-config.json')));assert.equal(mcp.mcpServers.figmaize.env.LAYER_BRIDGE_PORT,String(port));
 const site=http.createServer((req,res)=>res.end('<!doctype html><h1>Worker fixture</h1><button>Editable button</button>'));await new Promise(r=>site.listen(0,'127.0.0.1',r));t.after(()=>{site.closeAllConnections();site.close();});
 const started=await request('/v1/sites/start',{url:'http://127.0.0.1:'+site.address().port,mode:'page',scroll:false,interactions:false,width:640,height:480});
 const status=()=>request('/v1/sites/status?manifestPath='+encodeURIComponent(started.manifestPath));const captured=await wait(async()=>{const s=await status();return !s.capturing&&s;});assert.equal(captured.captureStatus,'complete',JSON.stringify(captured));assert.equal(captured.screens.captured,1);
 const {sessionId}=await request('/v1/connect',{clientId:'worker-test-client',document:{name:'Fixture',pageId:'old',pageName:'Original'}});
 await request('/v1/sites/import',{manifestPath:started.manifestPath,sessionId,options:{newPage:true,reuseComponents:true}});
 const operations=[];
 const imported=await wait(async()=>{
  const {job}=await request('/v1/poll?sessionId='+sessionId);
  if(job){operations.push(job.operation);const result=job.operation==='prepare_site'?{document:{name:'Fixture',pageId:'site-page',pageName:'Site / fixture'}}:{nodeId:'frame:1',editableRootId:'root:1',count:job.payload.capture.nodes.length,nativeSummary:{componentCount:1,autoLayoutCount:0}};await request('/v1/result',{sessionId,jobId:job.id,ok:true,result});}
  const s=await status();return !s.importing&&s;
 });
 assert.equal(imported.importStatus,'complete',JSON.stringify(imported));assert.equal(imported.imported,1);assert.deepEqual(operations,['prepare_site','import_capture']);
 await request('/v1/sites/import',{manifestPath:started.manifestPath,sessionId,options:{newPage:true}});const resumed=await wait(async()=>{const s=await status();return !s.importing&&s;});assert.equal(resumed.imported,1);assert.equal((await request('/v1/poll?sessionId='+sessionId)).job,null);
 const doctor=await promisify(execFile)(process.execPath,['bin/figmaize.mjs','doctor'],{cwd:root,env});assert.equal(JSON.parse(doctor.stdout).siteAPI,true);
});
