import {importSite} from '../server/import-site.mjs';
const [manifestPath,sessionId]=process.argv.slice(2);if(!manifestPath||!sessionId)throw Error('Usage: node scripts/import-site.mjs MANIFEST_PATH SESSION_ID');
const result=await importSite(manifestPath,sessionId,{onProgress:p=>{if(p.imported%10===0||p.imported===p.total)console.log(JSON.stringify(p));}});
console.log(JSON.stringify({status:result.journal.status,journalPath:result.journalPath,frames:result.journal.entries.length}));
