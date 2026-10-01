import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromiumRuntime} from '../server/capture-url.mjs';
test('plugin URL controls discover, select, capture and import through the authenticated service', {skip:process.env.LB_TEST_BROWSER!=='1',timeout:20000}, async t=>{
 const {chromium,executablePath}=await chromiumRuntime();const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:460,height:760}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const html=await readFile(new URL('../figma/ui.html',import.meta.url),'utf8');
 await page.setContent('<iframe title="Plugin" style="width:420px;height:700px;border:0"></iframe>');
 await page.evaluate(()=>window.addEventListener('message',event=>{const m=event.data.pluginMessage;if(m?.type==='bridge-command')event.source.postMessage({pluginMessage:{type:'bridge-result',id:m.id,ok:true,result:{name:'Fixture file',pageName:'Page',pageId:'page'}}},'*');}));
 let collection=false;const calls=[];
 await page.route('http://localhost:4318/**',async route=>{
  const req=route.request(),url=new URL(req.url());calls.push({route:url.pathname,body:req.postDataJSON(),auth:req.headers().authorization});
  let data={};const status={manifestPath:'/fixture/manifest.json',id:'fixture',url:'https://example.com',screens:{captured:2},pages:1,imported:0,capturing:false,importing:false,captureStatus:'complete',importStatus:'not-started'};
  if(url.pathname==='/v1/connect')data={sessionId:'fixture-session'};
  if(url.pathname==='/v1/poll')data={job:null};
  if(url.pathname==='/v1/sites')data={collections:collection?[status]:[]};
  if(url.pathname==='/v1/sites/status')data=status;
  if(url.pathname==='/v1/sites/discover')data={pages:[{url:'https://example.com',label:'Home'},{url:'https://example.com/help',label:'Help'}]};
  if(url.pathname==='/v1/sites/start'){collection=true;data={manifestPath:status.manifestPath};}
  await route.fulfill({json:data});
 });
 await page.locator('iframe').evaluate((el,html)=>el.srcdoc=html,html);const ui=page.frameLocator('iframe');
 await ui.locator('#token').fill('test-token-with-sufficient-length');await ui.locator('#connect').click();
 await ui.locator('#disconnect').waitFor({state:'visible'});
 await ui.locator('#site-url').fill('https://example.com');await ui.locator('#site-discover').click();
 await ui.locator('#page-list input').first().waitFor();await ui.locator('#page-list input').last().uncheck();
 await ui.locator('#site-start').click();await ui.locator('#site-import:enabled').waitFor();
 await ui.locator('#reuse-components').check();await ui.locator('#site-import').click();
 await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#site-status').textContent.includes('피그마 완료'));
 const capture=calls.find(c=>c.route==='/v1/sites/start');assert.equal(capture.body.mode,'selected');assert.deepEqual(capture.body.selectedUrls,['https://example.com']);
 const imported=calls.find(c=>c.route==='/v1/sites/import');assert.equal(imported.body.options.reuseComponents,true);assert.equal(imported.body.options.newPage,true);
 assert.ok(calls.every(c=>c.auth==='Bearer test-token-with-sufficient-length'));assert.deepEqual(errors,[]);
});
