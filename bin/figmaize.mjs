#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
import {ROOT,DATA_DIR,URL_BASE,getToken} from '../server/config.mjs';
const require=createRequire(import.meta.url),args=process.argv.slice(2),command=args.shift()||'help';
async function run(file,argv=[]){const child=spawn(process.execPath,[file,...argv],{stdio:'inherit',env:process.env});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{process.exitCode=code??1;resolve();});});}
try{
 if(command==='mcp'){const {serveStdio}=await import('../server/mcp.mjs');serveStdio();}
 else if(command==='start')await run(path.join(ROOT,'server/bridge.mjs'));
 else if(command==='doctor'){
  const checks={node:process.version,dataDirectory:DATA_DIR,bridge:URL_BASE,browser:false,connectedDocuments:0};
  try{const {chromiumRuntime}=await import('../server/capture-url.mjs');const b=await chromiumRuntime();checks.browser=!!b.executablePath;}catch(e){checks.browserError=e.message;}
  try{const token=process.env.LAYER_BRIDGE_TOKEN||(await readFile(path.join(DATA_DIR,'pairing-token'),'utf8')).trim();const {requestBridge}=await import('../server/client.mjs');const status=await requestBridge('/health',{token,timeout:1000});checks.server=status.version;checks.siteAPI=status.apiVersion===1;checks.connectedDocuments=status.sessions;}catch(e){checks.serverError='Start the local bridge with figmaize setup or figmaize start.';}
  console.log(JSON.stringify(checks,null,2));if(!checks.browser||!checks.siteAPI)process.exitCode=1;
 }
 else if(command==='setup'){
  if(args.includes('--install-browser'))await run(path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),['install','chromium']);
  if(process.exitCode)throw Error('Browser installation failed');
  const directory=path.join(DATA_DIR,'plugin');await mkdir(directory,{recursive:true});
  for(const file of ['code.js','ui.html','manifest.json'])await copyFile(path.join(ROOT,'figma',file),path.join(directory,file));
  const idIndex=args.indexOf('--figma-id');if(idIndex!==-1){const id=args[idIndex+1];if(!/^\d+$/.test(id||''))throw Error('Use the plugin ID assigned by Figma');const file=path.join(directory,'manifest.json'),manifest=JSON.parse(await readFile(file));manifest.id=id;manifest.networkAccess={allowedDomains:['http://localhost:4318'],reasoning:'Connects only to the user-installed local figmaize capture service to import editable layers.'};await writeFile(file,JSON.stringify(manifest,null,2));}
  const {ensureBridge}=await import('../server/client.mjs');const status=await ensureBridge();
  const clientConfig={mcpServers:{figmaize:{command:process.execPath,args:[path.join(ROOT,'bin/figmaize.mjs'),'mcp'],env:{FIGMAIZE_DATA_DIR:DATA_DIR,...(process.env.LAYER_BRIDGE_PORT?{LAYER_BRIDGE_PORT:process.env.LAYER_BRIDGE_PORT}:{})}}}};
  await writeFile(path.join(DATA_DIR,'mcp-config.json'),JSON.stringify(clientConfig,null,2));
  console.log(`figmaize is ready.\nFigma development manifest: ${path.join(directory,'manifest.json')}\nLocal connection code: ${await getToken()}\nOptional MCP configuration: ${path.join(DATA_DIR,'mcp-config.json')}\nKeep the plugin open while importing.`);
  if(status.apiVersion!==1)console.log('An older bridge is running. Restart that bridge before using site capture.');
  if(!args.includes('--install-browser'))console.log('If Chromium is missing, run figmaize setup --install-browser.');
 }
 else if(command==='capture')await run(path.join(ROOT,'scripts/capture-site.mjs'),args);
 else if(command==='import')await run(path.join(ROOT,'scripts/import-site.mjs'),args);
 else if(command==='compact')await run(path.join(ROOT,'scripts/compact-site.mjs'),args);
 else if(command==='version'||command==='--version')console.log(JSON.parse(await readFile(path.join(ROOT,'package.json'))).version);
 else if(['help','--help','-h'].includes(command))console.log('figmaize\n  setup [--install-browser] [--figma-id ID]\n  doctor\n  start\n  mcp\n  capture URL --out DIRECTORY\n  import MANIFEST SESSION_ID\n  compact MANIFEST SESSION_ID\n\nFigma URL controls work without an MCP client.');
 else throw Error('Unknown command: '+command);
}catch(error){console.error('figmaize: '+error.message);process.exitCode=1;}
