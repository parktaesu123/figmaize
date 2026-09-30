import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
import {planCompactSite} from '../server/compact-site.mjs';import {requestBridge} from '../server/client.mjs';
const [manifestPath,sessionId]=process.argv.slice(2);if(!manifestPath||!sessionId)throw Error('Usage: node scripts/compact-site.mjs MANIFEST SESSION_ID');
const {manifest,plans,captures}=await planCompactSite(manifestPath),file=path.join(path.dirname(manifestPath),'compact-job.json');
let previous;try{previous=JSON.parse(await readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;}
if(previous&&previous.status!=='complete')throw Error('Inspect the saved compact job before another mutation');
await writeFile(file,JSON.stringify({status:'submitting',submittedAt:new Date().toISOString()}));
const job=await requestBridge('/v1/commands',{method:'POST',body:{operation:'import_capture',sessionId,payload:{capture:captures.values().next().value,options:{organizeCollection:{id:manifest.id,plans}}}}});
await writeFile(file,JSON.stringify(job,null,2));console.log(JSON.stringify({jobId:job.id,status:job.status}));
