import path from 'node:path';import {readFile,writeFile,unlink} from 'node:fs/promises';
import {captureSite} from '../server/site-capture.mjs';import {importSite} from '../server/import-site.mjs';import {atomicJSON} from '../server/site-jobs.mjs';import {requestBridge} from '../server/client.mjs';
const [directory,kind]=process.argv.slice(2);if(!directory||!['capture','import'].includes(kind))throw Error('Invalid worker');
const file=name=>path.join(directory,name),manifestPath=file('manifest.json'),runFile=file(kind+'-run.json');
const run={pid:process.pid,status:'running',startedAt:new Date().toISOString()};
const shouldCancel=async()=>!!await readFile(file(kind+'.cancel')).catch(()=>null);
await writeFile(file(kind+'-run.lock'),String(process.pid));await atomicJSON(runFile,run);
try{
 const request=JSON.parse(await readFile(file(kind+'-request.json')));
 if(kind==='capture'){
  const result=await captureSite(request.config,{outputDir:directory,shouldCancel,onProgress:p=>{if(p.pages||p.captured%10===0)console.log(JSON.stringify(p));}});run.status=result.manifest.status;
 }else{
  if(request.options.newPage&&!await shouldCancel()){
   const m=JSON.parse(await readFile(manifestPath)),targetFile=file('target-job.json');let job;
   try{job=JSON.parse(await readFile(targetFile));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(job?.status==='submitting')throw Error('Target page submission unresolved; inspect Figma');
   if(!job){await atomicJSON(targetFile,{status:'submitting'});job=await requestBridge('/v1/commands',{method:'POST',body:{sessionId:request.sessionId,operation:'prepare_site',payload:{collectionId:m.id,title:new URL(m.config.url).hostname}}});await atomicJSON(targetFile,job);}
   const until=Date.now()+130000;
   while(job.status!=='complete'&&Date.now()<until){job=await requestBridge('/v1/jobs/'+job.id);await atomicJSON(targetFile,job);if(['failed','unknown'].includes(job.status))throw Error(job.error);if(job.status!=='complete')await new Promise(r=>setTimeout(r,300));}
   if(job.status!=='complete')throw Error('Target page unresolved');
   const {sessions}=await requestBridge('/v1/sessions');const current=sessions.find(s=>s.id===request.sessionId);
   if(!current||current.document.pageId!==job.result?.document.pageId||current.document.name!==job.result?.document.name)throw Error('Select the recorded site page in Figma and reconnect before resuming.');
  }
  const result=await importSite(manifestPath,request.sessionId,{shouldCancel,options:request.options});run.status=result.journal.status;
 }
}catch(error){run.status='failed';run.error=error.message;console.error(error.message);process.exitCode=1;}
finally{run.finishedAt=new Date().toISOString();await atomicJSON(runFile,run);await unlink(file(kind+'-run.lock')).catch(()=>{});}
