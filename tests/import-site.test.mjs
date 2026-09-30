import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {importSite} from '../server/import-site.mjs';
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lb-import-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const manifest=path.join(dir,'manifest.json'),journal=path.join(dir,'figma-import.json');
 await writeFile(manifest,JSON.stringify({id:'site-test',screens:[{id:'screen-one',label:'Popup',url:'https://example.com/en',actions:[],status:'captured',path:'one.json'}]}));
 await writeFile(path.join(dir,'one.json'),JSON.stringify({viewport:{width:100,height:100},nodes:[],source:{}}));
 const base={collectionId:'site-test',pageId:'1:2',documentName:'Fixture',entries:[]};
 const calls=[];const bridge={ensureBridge:async()=>{},requestBridge:async(route,options)=>{calls.push(route);if(route==='/v1/sessions')return {sessions:[{id:'session',document:{pageId:'1:2',name:'Fixture'}}]};if(route==='/v1/commands'){const saved=JSON.parse(await readFile(journal));assert.equal(saved.entries[0].status,'submitting');return {id:'job-one',status:'queued'};}return {status:'complete',result:{nodeId:'3:4',editableRootId:'3:5',count:10,nativeSummary:{componentCount:2,autoLayoutCount:1}}};}};
 return {manifest,journal,base,bridge,calls};
}
test('batch import journals before submission and skips confirmed imports on resume',async t=>{
 const f=await fixture(t);await importSite(f.manifest,'session',{bridge:f.bridge});await importSite(f.manifest,'session',{bridge:f.bridge});
 assert.equal(f.calls.filter(c=>c==='/v1/commands').length,1);const j=JSON.parse(await readFile(f.journal));assert.equal(j.entries[0].nodeId,'3:4');assert.equal(j.entries[0].components,2);
});
test('resume queries saved pending job without submitting another mutation',async t=>{
 const f=await fixture(t);await writeFile(f.journal,JSON.stringify({...f.base,entries:[{screenId:'screen-one',status:'queued',jobId:'saved-job'}]}));
 await importSite(f.manifest,'session',{bridge:f.bridge});assert.ok(f.calls.includes('/v1/jobs/saved-job'));assert.ok(!f.calls.includes('/v1/commands'));
});
test('interrupted submission without a job ID blocks automatic resubmission',async t=>{
 const f=await fixture(t);await writeFile(f.journal,JSON.stringify({...f.base,entries:[{screenId:'screen-one',status:'submitting'}]}));
 await assert.rejects(importSite(f.manifest,'session',{bridge:f.bridge}),/interrupted/);assert.ok(!f.calls.includes('/v1/commands'));
 assert.equal(JSON.parse(await readFile(f.journal)).entries[0].status,'unknown');
});
