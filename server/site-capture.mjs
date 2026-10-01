import {collectionCoverage} from './site-report.mjs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromiumRuntime, captureRenderedPage } from './capture-url.mjs';
import { DATA_DIR } from './config.mjs';

export function siteOptions(input) {
  const url = new URL(input.url);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('Public HTTP(S) URL required');
  const prefix = input.pathPrefix ?? (url.pathname.replace(/\/$/, '') || '/');
  if (!prefix.startsWith('/') || prefix.includes('?') || prefix.includes('#')) throw Error('Invalid path prefix');
  url.hash='';
  const mode=input.mode||'site';if(!['page','selected','site'].includes(mode))throw Error('Invalid capture mode');
  const config = { url: url.href, origin: url.origin, pathPrefix: prefix, mode, selectedUrls: [],
    width: input.width ?? 1440, height: input.height ?? 1000, maxPages: input.maxPages ?? 5,
    maxScreens: input.maxScreens ?? 40, scroll: input.scroll !== false, interactions: input.interactions !== false };
  for (const [key,min,max] of [['width',240,3840],['height',240,3840],['maxPages',1,250],['maxScreens',1,1000]])
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw Error('Invalid '+key);
  if(config.width*config.height>8294400)throw Error('Viewport too large');
  if(mode==='page')config.maxPages=1;
  if(mode==='selected'){
    if(!Array.isArray(input.selectedUrls)||!input.selectedUrls.length||input.selectedUrls.length>250)throw Error('Select 1–250 pages');
    config.selectedUrls=[...new Set(input.selectedUrls.map(u=>{const safe=scopedUrl(u,config);if(!safe)throw Error('Selected URL outside scope');return safe;}))];
  }
  return config;
}
export function scopedUrl(href, config) {
  try {
    const u = new URL(href, config.url);
    if (u.origin !== config.origin || u.username || u.password || !['http:','https:'].includes(u.protocol)) return null;
    if (config.pathPrefix !== '/' && u.pathname !== config.pathPrefix && !u.pathname.startsWith(config.pathPrefix+'/')) return null;
    if (/\.(pdf|zip|dmg|exe|apk|png|jpg|mp4|woff2?)$/i.test(u.pathname)) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
const digest = value => createHash('sha256').update(value).digest('hex').slice(0,20);
export function screenDigest(capture) {
  return digest(JSON.stringify(capture.nodes.map(n=>[n.type,n.text,n.semantic?.label,Math.round(n.bounds.x),Math.round(n.bounds.y),Math.round(n.bounds.width),Math.round(n.bounds.height),n.style?.background,n.style?.color])));
}
// This function executes only in a fresh, public-site browser context.
export function inspectPage() {
  function visible(el) {
    const b=el.getBoundingClientRect();if(!b.width||!b.height)return false;
    const offscreen=b.bottom<0||b.top>innerHeight;
    for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||(!offscreen&&+s.opacity===0))return false;}
    return true;
  }
  function selector(el) {
    if(el.id && document.querySelectorAll('#'+CSS.escape(el.id)).length===1)return '#'+CSS.escape(el.id);
    const parts=[];
    for(let p=el;p&&p!==document.documentElement;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
    return 'html > '+parts.join(' > ');
  }
  const links=[...document.querySelectorAll('a[href]')].filter(visible).map(el=>({url:el.href,label:(el.getAttribute('aria-label')||el.innerText||el.querySelector('img')?.alt||el.href).trim().slice(0,100),selector:selector(el)}));
  const controls=[],skipped=[];
  for(const el of document.querySelectorAll('button,[role="button"],[role="tab"],summary')){
    if(!visible(el))continue;
    let label=(el.getAttribute('aria-label')||el.textContent||el.getAttribute('title')||'').replace(/\s+/g,' ').trim().slice(0,100);
    if(label.length%2===0&&label.slice(0,label.length/2)===label.slice(label.length/2))label=label.slice(0,label.length/2);
    const nav=el.closest('nav,header'),global=!!nav&&nav.getBoundingClientRect().height<120;
    const action={type:'click',selector:selector(el),label,global};
    if(!label||el.disabled||el.closest('form')||/\b(submit|apply|sign.?up|log.?in|sign.?in|accept|agree|purchase|delete|send)\b/i.test(label)){skipped.push({...action,reason:'Unlabelled, disabled, form, or consequential control'});continue;}
    controls.push(action);
    if(el.closest('nav,header')||el.hasAttribute('aria-haspopup'))controls.push({...action,type:'hover'});
  }
  for(const link of links){const u=new URL(link.url);if(u.origin===location.origin&&u.pathname===location.pathname&&u.hash)controls.push({type:'click',selector:link.selector,label:link.label});}
  return {title:document.title,url:location.href,height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),links,controls,skipped};
}
export async function applyAction(page, action) {
  if(action.type==='scroll') {await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),action.y);}
  else if(['click','hover'].includes(action.type)) {
    const target=page.locator(action.selector);
    if(await target.count()!==1)throw Error('Control selector is no longer unique');
    if(await target.evaluate(el=>!!el.closest('form')||el.disabled))throw Error('Form/disabled controls are not activated');
    await target.scrollIntoViewIfNeeded({timeout:2500});
    if(action.type==='click')await target.click({timeout:3500});else await target.hover({timeout:3500});
  } else throw Error('Unsupported action');
  await page.waitForTimeout(action.type==='scroll'?500:650);
}
async function save(file, data){const temp=file+'.tmp';await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,file);}
export async function captureSite(input, { outputDir, onProgress=()=>{}, discoverOnly=false, shouldCancel=async()=>false }={}) {
  const config=siteOptions(input);
  const directory=outputDir || path.join(DATA_DIR,'sites',digest(config.url+'|'+Date.now()));await mkdir(directory,{recursive:true});
  const manifestPath=path.join(directory,'manifest.json');
  let manifest;
  try {manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(manifest.config.url!==config.url||manifest.config.pathPrefix!==config.pathPrefix||manifest.config.width!==config.width||manifest.config.height!==config.height)throw Error('Collection config mismatch');}
  catch(e){if(e.code!=='ENOENT')throw e;manifest={version:1,id:'site-'+digest(directory),config,createdAt:new Date().toISOString(),pages:[],screens:[],excluded:[],skipped:[],complete:false};}
  manifest.config=config;manifest.complete=false;manifest.status='running';delete manifest.finishedAt;delete manifest.error;
  const {chromium,executablePath}=await chromiumRuntime();const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true});
  let page;
  try {
    const context=await browser.newContext({viewport:{width:config.width,height:config.height},deviceScaleFactor:1,acceptDownloads:false,serviceWorkers:'block'});
    await context.addInitScript(()=>document.addEventListener('submit',e=>e.preventDefault(),true));
    page=await context.newPage();page.setDefaultTimeout(5000);page.on('dialog',d=>void d.dismiss());page.on('download',d=>void d.cancel());
  } catch(error) {await browser.close();throw error;}
  const popups=[];page.on('popup',p=>{popups.push(p.url());void p.close();});
  const allowed=u=>config.mode==='page'?u===config.url:config.mode==='selected'?config.selectedUrls.includes(u):true;
  const queue=[...new Set([...(config.mode==='selected'?config.selectedUrls:[config.url]),...manifest.pages.map(p=>p.url),...(manifest.pendingUrls||[])])].filter(allowed),seen=new Set(),signatures=new Map(manifest.screens.filter(s=>s.digest&&s.status!=='duplicate').map(s=>[s.url+'|'+s.digest,s.id]));
  let limited=false;
  const cancelled=()=>Object.assign(Error('Collection cancelled'),{cancelled:true});
  async function checkActive(){if(await shouldCancel())throw cancelled();if(!browser.isConnected()||page.isClosed())throw Object.assign(Error('Capture browser closed'),{fatal:true});}
  function rethrow(error){if(error.cancelled||error.fatal||!browser.isConnected()||page.isClosed())throw error;}
  async function checkpoint(){manifest.pendingUrls=[...queue];manifest.updatedAt=new Date().toISOString();await save(manifestPath,manifest);}
  function addLinks(inventory){for(const link of inventory.links){const url=scopedUrl(link.url,config);if(url&&allowed(url)&&!seen.has(url)&&!queue.includes(url))queue.push(url);else if(!url&&!manifest.excluded.some(e=>e.url===link.url))manifest.excluded.push({url:link.url,label:link.label,reason:'Outside language scope or non-page resource'});}}
  async function navigate(url){await checkActive();await page.unroute('**/*');const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await page.evaluate(async()=>{await Promise.race([document.fonts?.ready,new Promise(r=>setTimeout(r,1500))]);});await page.waitForTimeout(900);if(!scopedUrl(page.url(),config))throw Error('Redirect outside collection scope');if(response?.status()>=400)throw Error('HTTP '+response.status());return response;}
  async function captureState(url,label,actions,response){
    await checkActive();
    const key=digest(url+'|'+JSON.stringify(actions));const existing=manifest.screens.find(s=>s.key===key);
    if(existing && ['captured','imported','duplicate'].includes(existing.status))return existing;
    if(manifest.screens.filter(s=>s.status==='captured'||s.status==='imported').length>=config.maxScreens){limited=true;return null;}
    const entry=existing||{id:'screen-'+key,key,url,label,actions,status:'pending'};
    if(!existing)manifest.screens.push(entry);
    try {
      const capture=await captureRenderedPage(browser,page,{width:config.width,height:config.height,title:label,response});
      const signature=screenDigest(capture),duplicate=signatures.get(url+'|'+signature);
      if(duplicate){Object.assign(entry,{status:'duplicate',duplicateOf:duplicate,digest:signature});await checkpoint();return entry;}
      const index=manifest.screens.filter(s=>s.status==='captured'||s.status==='imported').length;
      capture.source.collection={id:manifest.id,index};capture.source.screenId=entry.id;capture.source.actions=actions;
      capture.source.url=page.url();capture.source.trigger=label;
      const file=entry.id+'.layerbridge.json';await writeFile(path.join(directory,file),JSON.stringify(capture));
      Object.assign(entry,{status:'captured',path:file,digest:signature,nodeCount:capture.nodes.length,index});signatures.set(url+'|'+signature,entry.id);
      onProgress({captured:index+1,label,nodes:capture.nodes.length});
    }catch(error){rethrow(error);Object.assign(entry,{status:'failed',error:error.message});}
    await checkpoint();return entry;
  }
  try {
    while(queue.length&&seen.size<config.maxPages&&!limited){
      await checkActive();
      const url=queue.shift();if(seen.has(url))continue;seen.add(url);
      let record=manifest.pages.find(p=>p.url===url);if(!record){record={url};manifest.pages.push(record);}
      try {
        if(record.status==='processed'&&!record.controlsLimited&&!record.actionErrors){addLinks({links:record.links||[]});continue;}
        record.actionErrors=false;record.controlsLimited=false;
        let response=await navigate(url);const inventory=await page.evaluate(inspectPage);Object.assign(record,{title:inventory.title,height:inventory.height,links:inventory.links,status:'discovered'});addLinks(inventory);
        manifest.skipped.push(...inventory.skipped.filter(c=>!manifest.skipped.some(s=>s.url===url&&s.selector===c.selector)).map(c=>({url,...c})));
        const pathLabel=new URL(url).pathname.replace(config.pathPrefix,'')||'Home';
        if(!discoverOnly)await captureState(url,pathLabel+' · Default',[],response);
        if(config.interactions&&!discoverOnly){
          const controlKeys=new Set();const actions=[...inventory.controls];
          while(actions.length&&!limited){
            await checkActive();
            const action=actions.shift(),actionKey=JSON.stringify(action);if(controlKeys.has(actionKey))continue;controlKeys.add(actionKey);
            const sharedKey=action.type+'|'+action.label;
            const shared=(manifest.globalControls||[]).find(c=>c.key===sharedKey);
            if(action.global&&shared){(record.sharedControls||=[]).push(shared);continue;}
            if(controlKeys.size>120){record.controlsLimited=true;break;}
            try {
              response=await navigate(url);
              await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
              await applyAction(page,action);
              if(!scopedUrl(page.url(),config)||!allowed(scopedUrl(page.url(),config))){manifest.skipped.push({url,...action,reason:'Navigation outside language scope'});continue;}
              const after=await page.evaluate(inspectPage);addLinks(after);
              const screen=!discoverOnly?await captureState(url,pathLabel+' · '+action.type+' · '+action.label,[action],response):null;
              if(action.global&&screen)(manifest.globalControls||=[]).push({key:sharedKey,screenId:screen.duplicateOf||screen.id});
              // Newly revealed nested controls are recorded for explicit follow-up,
              // rather than replayed incorrectly without their opening action.
              for(const nested of after.controls)if(!inventory.controls.some(c=>c.selector===nested.selector&&c.label===nested.label)){
                const chain=[action,nested],key=digest(JSON.stringify(chain));
                if(record.nested?.some(n=>n.key===key))continue;
                (record.nested||=[]).push({key,actions:chain});
              }
            }catch(error){rethrow(error);record.actionErrors=true;manifest.skipped.push({url,...action,reason:error.message});}
          }
          for(const nested of record.nested||[]){
            if(limited)break;
            await checkActive();
            try{
              response=await navigate(url);await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
              for(const action of nested.actions)await applyAction(page,action);if(!scopedUrl(page.url(),config)||!allowed(scopedUrl(page.url(),config)))continue;
              const after=await page.evaluate(inspectPage);addLinks(after);
              const screen=!discoverOnly?await captureState(url,pathLabel+' · '+nested.actions.map(a=>a.label).join(' → '),nested.actions,response):null;
              if(screen?.status!=='duplicate')for(const action of after.controls){
                if(inventory.controls.some(c=>c.selector===action.selector&&c.label===action.label)||record.nested.some(n=>n.actions.at(-1).selector===action.selector&&n.actions.at(-1).label===action.label))continue;
                if(nested.actions.length>=4||record.nested.length>=120){record.controlsLimited=true;continue;}
                const chain=[...nested.actions,action];record.nested.push({key:digest(JSON.stringify(chain)),actions:chain});
              }
            }catch(error){rethrow(error);record.actionErrors=true;manifest.skipped.push({url,actions:nested.actions,reason:error.message});}
          }
        }
        record.status=discoverOnly?'discovered-only':limited?'interrupted':'processed';
      }catch(error){rethrow(error);record.status='failed';record.error=error.message;}
      await checkpoint();onProgress({pages:seen.size,queuedPages:queue.length,url});
    }
    manifest.pendingUrls=queue;
    if(!discoverOnly&&config.scroll&&!limited)for(const record of manifest.pages.filter(p=>p.status==='processed'&&!p.scrollComplete)){
      if(limited)break;
      await checkActive();
      try{
        const response=await navigate(record.url);const step=Math.floor(config.height*.85);
        for(let y=step;y<Math.min(record.height,200000);y+=step){
          await checkActive();const action={type:'scroll',y};await applyAction(page,action);
          const actual=await page.evaluate(()=>({y:scrollY,height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)}));
          record.height=Math.max(record.height,actual.height);
          await captureState(record.url,(new URL(record.url).pathname.replace(config.pathPrefix,'')||'Home')+' · Scroll '+Math.round(actual.y),[action],response);
          if(limited||actual.y+config.height>=actual.height-2)break;
        }
        record.scrollComplete=!limited&&record.height<=200000;
      }catch(error){rethrow(error);record.scrollError=error.message;}
      await checkpoint();
    }
    manifest.popups=[...new Set([...(manifest.popups||[]),...popups])];
    manifest.limitReached=limited||queue.length>0;
    manifest.complete=!discoverOnly&&!manifest.limitReached&&manifest.pages.every(p=>p.status==='processed'&&!p.controlsLimited&&(!config.scroll||p.scrollComplete))&&!manifest.screens.some(s=>s.status==='failed')&&!collectionCoverage(manifest).unresolvedControls.length;
    manifest.status=manifest.complete?'complete':'partial';manifest.finishedAt=new Date().toISOString();await checkpoint();return {directory,manifestPath,manifest};
  }catch(error){
    manifest.status=error.cancelled?'cancelled':'failed';manifest.error=error.message;manifest.complete=false;
    for(const record of manifest.pages)if(record.status==='discovered')record.status='interrupted';
    await checkpoint();if(!error.cancelled)throw error;return {directory,manifestPath,manifest};
  }finally{await browser.close();}
}

export async function discoverSite(input){
 const config=siteOptions({...input,mode:'site'}),{chromium,executablePath}=await chromiumRuntime();
 const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true});
 try{const page=await browser.newPage({viewport:{width:config.width,height:config.height}});
  await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:20000});await page.waitForTimeout(500);
  if(!scopedUrl(page.url(),config))throw Error('Redirect outside collection scope');
  const inventory=await page.evaluate(inspectPage),links=new Map([[config.url,{url:config.url,label:inventory.title}]]);
  for(const link of inventory.links){const url=scopedUrl(link.url,config);if(url&&!links.has(url))links.set(url,{url,label:link.label});}
  return {url:config.url,pages:[...links.values()].slice(0,250),note:'Links on the starting page; deeper pages are discovered during a site crawl.'};
 }finally{await browser.close();}
}
