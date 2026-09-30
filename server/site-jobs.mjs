import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR,ROOT} from './config.mjs';
import {siteOptions} from './site-capture.mjs';
import {requestBridge} from './client.mjs';
const root=path.join(DATA_DIR,'sites');
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function collection(file){const resolved=await realpath(file),base=await realpath(root);if(!resolved.startsWith(base+path.sep)||path.basename(resolved)!=='manifest.json')throw Error('Use a manifest returned by site_capture_start');return resolved;}
async function launch(script,args,directory,kind){
  const log=await open(path.join(directory,kind+'.log'),'a',0o600);
  const child=spawn(process.execPath,[path.join(ROOT,'scripts',script),...args],{cwd:ROOT,detached:true,stdio:['ignore',log.fd,log.fd]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
  await writeFile(path.join(directory,kind+'-run.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()}));
}
export async function startSiteCapture(input){
  const c=siteOptions(input);const directory=path.join(root,'site-'+randomUUID());await mkdir(directory,{recursive:true});
  await launch('capture-site.mjs',[c.url,'--out',directory,'--max-pages',String(c.maxPages),'--max-screens',String(c.maxScreens),...(c.scroll?[]:['--no-scroll'])],directory,'capture');
  return {status:'started',manifestPath:path.join(directory,'manifest.json'),note:'Use site_capture_status; capture completion does not mean Figma import completion.'};
}
export async function siteCaptureStatus(manifestPath){
  // A newly launched process may not have written the manifest yet.
  let file;try{file=await collection(manifestPath);}catch(e){if(e.code!=='ENOENT')throw e;const dir=await realpath(path.dirname(manifestPath)),base=await realpath(root);if(!dir.startsWith(base+path.sep)||path.basename(manifestPath)!=='manifest.json')throw Error('Invalid collection path');file=path.join(dir,'manifest.json');}
  const directory=path.dirname(file),m=await optional(file),capture=await optional(path.join(directory,'capture-run.json')),importRun=await optional(path.join(directory,'import-run.json')),journal=await optional(path.join(directory,'figma-import.json'));
  const counts={};for(const s of m?.screens||[])counts[s.status]=(counts[s.status]||0)+1;
  return {manifestPath:file,capturing:!!capture&&alive(capture.pid),captureComplete:m?.complete||false,limitReached:m?.limitReached||false,pages:m?.pages.length||0,screens:counts,excluded:m?.excluded.length||0,skipped:m?.skipped.length||0,
    importing:!!importRun&&alive(importRun.pid),importStatus:journal?.status||'not-started',imported:journal?.entries.filter(e=>e.status==='complete').length||0,error:journal?.error,
    failures:(m?.screens||[]).filter(s=>s.status==='failed').slice(0,10).map(s=>({label:s.label,error:s.error})),
    recentFrames:(journal?.entries||[]).filter(e=>e.status==='complete').slice(-5).map(e=>({label:e.label,nodeId:e.nodeId}))};
}
export async function startSiteImport(manifestPath,sessionId){
  const file=await collection(manifestPath),directory=path.dirname(file);
  const running=await optional(path.join(directory,'import-run.json'));if(running&&alive(running.pid))return {status:'already-running',manifestPath:file};
  const journal=await optional(path.join(directory,'figma-import.json'));
  if(journal?.entries.some(e=>['unknown','blocked','submitting'].includes(e.status)))throw Error('Unresolved import: inspect Figma and the journal before retrying.');
  const {sessions}=await requestBridge('/v1/sessions');const chosen=sessionId?sessions.find(s=>s.id===sessionId):sessions.length===1?sessions[0]:null;if(!chosen)throw Error('Choose a connected Figma document/page with bridge_status');
  await launch('import-site.mjs',[file,chosen.id],directory,'import');return {status:'started',manifestPath:file,document:chosen.document,note:'Keep the Figma plugin open; check site_capture_status for confirmed imported frames.'};
}
