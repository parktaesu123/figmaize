import path from 'node:path';
import {captureSite} from '../server/site-capture.mjs';
const args=process.argv.slice(2),url=args.shift();
if(!url)throw Error('Usage: figmaize capture URL --out DIRECTORY [--mode page|site|selected] [--select URL] [--max-pages N] [--max-screens N] [--width N] [--height N] [--no-scroll] [--no-interactions]');
const input={url};let outputDir,discoverOnly=false,cancelled=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{cancelled=true;});
while(args.length){
 const key=args.shift();
 if(key==='--out'){if(!args[0])throw Error('--out requires a directory');outputDir=path.resolve(args.shift());}
 else if(['--max-pages','--max-screens','--width','--height'].includes(key))input[{'--max-pages':'maxPages','--max-screens':'maxScreens','--width':'width','--height':'height'}[key]]=Number(args.shift());
 else if(key==='--mode')input.mode=args.shift();
 else if(key==='--select'){if(!args[0])throw Error('--select requires a URL');(input.selectedUrls||=[]).push(args.shift());}
 else if(key==='--no-scroll')input.scroll=false;
 else if(key==='--no-interactions')input.interactions=false;
 else if(key==='--discover-only')discoverOnly=true;
 else throw Error('Unknown option '+key);
}
const result=await captureSite(input,{outputDir,discoverOnly,shouldCancel:async()=>cancelled,onProgress:p=>{if(p.pages||p.captured%10===0)console.log(JSON.stringify(p));}});
const m=result.manifest;
console.log(JSON.stringify({manifestPath:result.manifestPath,status:m.status,pages:m.pages.length,captured:m.screens.filter(s=>['captured','imported'].includes(s.status)).length,duplicates:m.screens.filter(s=>s.status==='duplicate').length,failed:m.screens.filter(s=>s.status==='failed').length,excluded:m.excluded.length,skipped:m.skipped.length,complete:m.complete,limitReached:m.limitReached}));
