import { spawn } from 'node:child_process';
import { open, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, ROOT, URL_BASE, getToken } from './config.mjs';
export async function requestBridge(route, { method='GET', body, timeout=10000, base=URL_BASE, token } = {}) {
  const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token || await getToken()}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error||`Bridge HTTP ${response.status}`);error.status=response.status;throw error;}
  return data;
}
let starting;
export async function ensureBridge() {
  if(starting)return starting;
  starting=(async()=>{
    const token=await getToken();
    try { const status=await requestBridge('/health',{token,timeout:1200});if(status.name!=='layer-bridge')throw new Error('Unexpected bridge service');return status; }
    catch(error){if(error.status)throw error;}
    await mkdir(DATA_DIR,{recursive:true,mode:0o700});
    const log=await open(path.join(DATA_DIR,'bridge.log'),'a',0o600);
    const child=spawn(process.execPath,[path.join(ROOT,'server/bridge.mjs')],{cwd:ROOT,detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});
    let spawnError;child.on('error',error=>{spawnError=error;});child.unref();await log.close();
    for(let i=0;i<30;i++){
      if(spawnError)throw spawnError;
      await new Promise(resolve=>setTimeout(resolve,150));
      try{return await requestBridge('/health',{token,timeout:1000});}catch(error){if(error.status)throw error;}
    }
    throw new Error('로컬 브리지를 시작하지 못했습니다. .layer-bridge/bridge.log를 확인하세요.');
  })();
  try{return await starting;}finally{starting=null;}
}
