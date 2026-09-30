import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {siteOptions,scopedUrl,screenDigest,captureSite} from '../server/site-capture.mjs';
test('site scope respects locale boundaries, limits and file exclusions',()=>{
  const c=siteOptions({url:'https://example.com/en-us'});
  assert.equal(scopedUrl('/en-us/company#team',c),'https://example.com/en-us/company');
  for(const u of ['/en-us-evil','/career','https://outside.test/en-us','/en-us/a.pdf','javascript:alert(1)'])assert.equal(scopedUrl(u,c),null);
  for(const options of [{maxPages:0},{maxScreens:1001},{width:10},{url:'https://user:password@example.com/'}])assert.throws(()=>siteOptions({url:c.url,...options}));
});
test('screen fingerprint ignores changing video pixels but detects editable content and layout',()=>{
  const node={type:'text',text:'Menu',bounds:{x:1,y:2,width:3,height:4},image:'A'};
  const a={nodes:[node]};assert.equal(screenDigest(a),screenDigest({nodes:[{...node,image:'B'}]}));
  assert.notEqual(screenDigest(a),screenDigest({nodes:[{...node,text:'Modal'}]}));
});
test('site collection captures internal pages and modal states, records exclusions and resumes', {skip:process.env.LB_TEST_BROWSER!=='1',timeout:60000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lb-site-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let submitted=0;
  const server=http.createServer((req,res)=>{if(req.method==='POST')submitted++;res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Fixture</title><body><a href="/en/second">Second</a><a href="/outside">Outside</a><button aria-label="Info" onclick="document.querySelector('#modal').style.display='block'">Info</button><div id="modal" style="display:none">Editable dialog text</div><form method="post"><button>Submit</button></form><p>${req.url}</p></body>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const options={url:`http://127.0.0.1:${server.address().port}/en`,maxPages:4,maxScreens:10,scroll:false,width:640,height:480};
  const first=await captureSite(options,{outputDir:dir});
  assert.equal(first.manifest.pages.length,2);assert.equal(first.manifest.screens.filter(s=>s.status==='captured').length,4);
  assert.ok(first.manifest.excluded.some(e=>e.url.endsWith('/outside')));assert.ok(first.manifest.skipped.some(e=>e.label==='Submit'));assert.equal(submitted,0);
  const modal=first.manifest.screens.find(s=>s.actions.length);const capture=JSON.parse(await readFile(path.join(dir,modal.path),'utf8'));
  assert.ok(capture.nodes.some(n=>n.text==='Editable dialog text'));assert.equal(capture.source.collection.id,first.manifest.id);
  const second=await captureSite(options,{outputDir:dir});assert.equal(second.manifest.screens.length,4);
});
