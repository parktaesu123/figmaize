import path from 'node:path';
import {captureSite} from '../server/site-capture.mjs';
const args=process.argv.slice(2),url=args.shift();
if(!url)throw Error('Usage: node scripts/capture-site.mjs URL --out DIRECTORY [--max-pages N] [--max-screens N] [--no-scroll]');
const input={url};let outputDir,discoverOnly=false;
while(args.length){const key=args.shift();if(key==='--out')outputDir=path.resolve(args.shift());else if(key==='--max-pages')input.maxPages=Number(args.shift());else if(key==='--max-screens')input.maxScreens=Number(args.shift());else if(key==='--no-scroll')input.scroll=false;else if(key==='--discover-only')discoverOnly=true;else throw Error('Unknown option '+key);}
const result=await captureSite(input,{outputDir,discoverOnly,onProgress:p=>{if(p.pages||p.captured%10===0)console.log(JSON.stringify(p));}});
const m=result.manifest;
console.log(JSON.stringify({manifestPath:result.manifestPath,pages:m.pages.length,captured:m.screens.filter(s=>['captured','imported'].includes(s.status)).length,duplicates:m.screens.filter(s=>s.status==='duplicate').length,failed:m.screens.filter(s=>s.status==='failed').length,excluded:m.excluded.length,skipped:m.skipped.length,complete:m.complete,limitReached:m.limitReached}));
