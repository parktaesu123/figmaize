import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,realpath,readdir,unlink,rename} from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR,ROOT} from './config.mjs';
import {siteOptions,discoverSite} from './site-capture.mjs';
import {requestBridge} from './client.mjs';
const root=path.join(DATA_DIR,'sites');
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}};
async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function atomicJSON(file,value){await writeFile(file+'.tmp',JSON.stringify(value,null,2));await rename(file+'.tmp',file);}
async function collection(file){
 if(typeof file!=='string')throw Error('Collection path required');
 const dir=await realpath(path.dirname(path.resolve(file))),base=await realpath(root);
 if(!dir.startsWith(base+path.sep)||path.basename(file)!=='manifest.json')throw Error('Use a collection returned by figmaize');
 const resolved=await realpath(path.join(dir,'manifest.json'));
 if(path.dirname(resolved)!==dir)throw Error('Collection manifest escaped its directory');
 return resolved;
}
async function launch(directory,kind,request){
 const lockPath=path.join(directory,kind+'-run.lock');let lock;
 try{lock=await open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lockPath,'utf8'));if(alive(pid))return false;await unlink(lockPath);lock=await open(lockPath,'wx');}
 await lock.writeFile(String(process.pid));await lock.close();
 let log;
 try{
  await unlink(path.join(directory,kind+'.cancel')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await atomicJSON(path.join(directory,kind+'-request.json'),request);
  log=await open(path.join(directory,kind+'.log'),'a',0o600);
  const child=spawn(process.execPath,[path.join(ROOT,'scripts/site-worker.mjs'),directory,kind],{cwd:ROOT,detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return true;
 }catch(error){await unlink(lockPath).catch(()=>{});throw error;}finally{await log?.close();}
}
export async function startSiteCapture(input){
 const config=siteOptions(input),directory=path.join(root,'site-'+randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
 const id=path.basename(directory),manifestPath=path.join(directory,'manifest.json');
 await atomicJSON(manifestPath,{version:1,id,config,createdAt:new Date().toISOString(),pages:[],screens:[],excluded:[],skipped:[],complete:false,status:'starting'});
 await launch(directory,'capture',{config});return {status:'started',manifestPath};
}
export async function siteCaptureStatus(manifestPath){
 const file=await collection(manifestPath),directory=path.dirname(file),m=await optional(file),journal=await optional(path.join(directory,'figma-import.json'));
 const runs={};for(const kind of ['capture','import']){const r=await optional(path.join(directory,kind+'-run.json'));let pid=Number(await readFile(path.join(directory,kind+'-run.lock'),'utf8').catch(()=>0));runs[kind]={...r,active:alive(pid),cancelRequested:!!await optional(path.join(directory,kind+'.cancel'))};}
 const counts={};for(const s of m?.screens||[])counts[s.status]=(counts[s.status]||0)+1;
 return {manifestPath:file,id:m?.id,url:m?.config.url,config:m?.config,capturing:runs.capture.active,captureStatus:runs.capture.active?(m?.status||'running'):(runs.capture.status||m?.status||'starting'),captureComplete:m?.complete||false,limitReached:m?.limitReached||false,pages:m?.pages.length||0,screens:counts,excluded:m?.excluded.length||0,skipped:m?.skipped.length||0,
 importing:runs.import.active,importStatus:runs.import.active?'running':runs.import.status||journal?.status||'not-started',imported:journal?.entries.filter(e=>e.status==='complete').length||0,error:runs.import.error||runs.capture.error||journal?.error||m?.error,cancelRequested:(runs.capture.active&&runs.capture.cancelRequested)||(runs.import.active&&runs.import.cancelRequested),
 failures:[...(m?.pages||[]).filter(p=>p.status==='failed').map(p=>({label:p.url,error:p.error})),...(m?.screens||[]).filter(s=>s.status==='failed').map(s=>({label:s.label,error:s.error}))].slice(0,10),
 recentFrames:(journal?.entries||[]).filter(e=>e.status==='complete').slice(-5).map(e=>({label:e.label,nodeId:e.nodeId}))};
}
export async function listSiteCollections(){
 await mkdir(root,{recursive:true});const entries=await readdir(root,{withFileTypes:true}),result=[];
 for(const e of entries.filter(e=>e.isDirectory()).slice(-100)){try{const status=await siteCaptureStatus(path.join(root,e.name,'manifest.json'));if(status.id)result.push(status);}catch{}}
 return {collections:result};
}
export async function cancelSite(manifestPath){
 const file=await collection(manifestPath);for(const kind of ['capture','import'])await atomicJSON(path.join(path.dirname(file),kind+'.cancel'),{requestedAt:new Date().toISOString()});
 return {status:'cancel-requested',note:'Capture stops at the next checkpoint; an already submitted Figma mutation is allowed to finish before import stops.'};
}
export async function resumeSiteCapture(manifestPath,limits={}){
 const file=await collection(manifestPath),manifest=await optional(file);if(!manifest)throw Error('Collection manifest missing');
 if((await siteCaptureStatus(file)).importing)throw Error('Wait for import to finish before resuming capture');
 const config=siteOptions({...manifest.config,...(limits.maxPages?{maxPages:limits.maxPages}:{}),...(limits.maxScreens?{maxScreens:limits.maxScreens}:{})});
 const started=await launch(path.dirname(file),'capture',{config});return {status:started?'started':'already-running',manifestPath:file};
}
export async function startSiteImport(manifestPath,sessionId,options={}){
 const file=await collection(manifestPath),directory=path.dirname(file),state=await siteCaptureStatus(file);
 if(state.capturing)throw Error('Wait for capture to finish before importing');
 const journal=await optional(path.join(directory,'figma-import.json'));
 if(journal?.entries.some(e=>['unknown','blocked','submitting'].includes(e.status)))throw Error('Unresolved import: inspect Figma before retrying.');
 if(!(state.screens.captured||state.screens.imported))throw Error('No captured screens');
 const {sessions}=await requestBridge('/v1/sessions');const chosen=sessionId?sessions.find(s=>s.id===sessionId):sessions.length===1?sessions[0]:null;if(!chosen)throw Error('Choose a connected Figma document/page');
 const safeOptions={newPage:options.newPage===true,reuseComponents:options.reuseComponents===true,variants:options.variants===true,prototype:options.prototype===true};
 const started=await launch(directory,'import',{sessionId:chosen.id,options:safeOptions});return {status:started?'started':'already-running',manifestPath:file,document:chosen.document};
}
export {discoverSite};
