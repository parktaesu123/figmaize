import {planCompactSite,cropCapture} from './compact-site.mjs';
import path from 'node:path';
import {readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {ensureBridge,requestBridge} from './client.mjs';
const save=async(file,value)=>{await writeFile(file+'.tmp',JSON.stringify(value,null,2));await rename(file+'.tmp',file);};
export async function importSite(manifestPath,sessionId,{onProgress=()=>{},bridge={ensureBridge,requestBridge},shouldCancel=async()=>false,options={}}={}){
  const {ensureBridge:ensure,requestBridge:request}=bridge;
  manifestPath=path.resolve(manifestPath);const directory=path.dirname(manifestPath),journalPath=path.join(directory,'figma-import.json'),lockPath=journalPath+'.lock';
  // Only one process may submit mutations for this collection at a time.
  let lock;
  try{lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));}
  catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(await readFile(lockPath,'utf8'));try{process.kill(pid,0);throw Error('This collection is already importing');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(lockPath);lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));}
  let journal;
  try{
    await ensure();const {sessions}=await request('/v1/sessions');const chosen=sessions.find(s=>s.id===sessionId);if(!chosen)throw Error('Connect the intended Figma page first');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    const compact=await planCompactSite(manifestPath);const plans=new Map(compact.plans.map(p=>[p.screenId,p]));
    try{journal=JSON.parse(await readFile(journalPath,'utf8'));if(journal.pageId!==chosen.document.pageId||journal.documentName!==chosen.document.name)throw Error('Collection import target differs from the recorded Figma document/page');}
    catch(e){if(e.code!=='ENOENT')throw e;journal={collectionId:manifest.id,pageId:chosen.document.pageId,documentName:chosen.document.name,entries:[]};}
    journal.status='running';delete journal.error;delete journal.finishedAt;journal.pid=process.pid;await save(journalPath,journal);
    for(const screen of manifest.screens.filter(s=>['captured','imported'].includes(s.status))){
      if(await shouldCancel()){journal.status='cancelled';await save(journalPath,journal);return {journalPath,journal};}
      let entry=journal.entries.find(e=>e.screenId===screen.id);if(entry?.status==='complete')continue;
      if(entry?.status==='unknown'||entry?.status==='blocked')throw Error('Unresolved mutation '+entry.screenId+'; inspect Figma before retrying');
      if(!entry){entry={screenId:screen.id,label:screen.label,status:'not-submitted'};journal.entries.push(entry);}
      if(entry.status==='submitting'&&!entry.jobId){entry.status='unknown';await save(journalPath,journal);throw Error('Submission was interrupted before its job ID was recorded; inspect Figma before retrying');}
      if(!entry.jobId){
        const resolved=path.resolve(directory,screen.path);if(!resolved.startsWith(directory+path.sep))throw Error('Capture path escaped collection');
        const raw=JSON.parse(await readFile(resolved,'utf8')),plan=plans.get(screen.id);
        const capture=plan?cropCapture(raw,plan.crop):raw;
        if(plan)capture.source={...capture.source,presentation:plan};
        entry.status='submitting';await save(journalPath,journal);
        let job;
        try{job=await request('/v1/commands',{method:'POST',body:{operation:'import_capture',sessionId,payload:{capture,options:{reference:false,...options}}},timeout:30000});}
        catch(error){entry.status='unknown';entry.error=error.message;await save(journalPath,journal);throw error;}
        entry.jobId=job.id;entry.status=job.status;await save(journalPath,journal);
      }
      // A pending job is queried, never re-submitted when a process resumes.
      const deadline=Date.now()+130000;
      while(Date.now()<deadline){
        let job;try{job=await request('/v1/jobs/'+encodeURIComponent(entry.jobId));}catch(error){entry.status='blocked';entry.error='Saved job is unavailable: '+error.message;await save(journalPath,journal);throw Error(entry.error);}
        entry.status=job.status;
        if(job.status==='complete'){
          entry.nodeId=job.result.nodeId;entry.editableRootId=job.result.editableRootId;entry.count=job.result.count;
          entry.components=job.result.nativeSummary?.componentCount||0;entry.autoLayout=job.result.nativeSummary?.autoLayoutCount||0;
          entry.warnings=job.result.warnings;entry.completedAt=new Date().toISOString();await save(journalPath,journal);
          onProgress({imported:journal.entries.filter(e=>e.status==='complete').length,total:manifest.screens.filter(s=>['captured','imported'].includes(s.status)).length,label:entry.label,nodeId:entry.nodeId});break;
        }
        if(['failed','unknown'].includes(job.status)){entry.error=job.error;await save(journalPath,journal);throw Error('Import '+job.status+': '+job.error);}
        await new Promise(r=>setTimeout(r,300));
      }
      if(entry.status!=='complete'){entry.status='unknown';await save(journalPath,journal);throw Error('Import result timeout; do not resubmit');}
    }
    journal.status='complete';journal.finishedAt=new Date().toISOString();await save(journalPath,journal);return {journalPath,journal};
  }catch(error){if(journal){journal.status='blocked';journal.error=error.message;await save(journalPath,journal);}throw error;}
  finally{await lock?.close();await unlink(lockPath).catch(()=>{});}
}
