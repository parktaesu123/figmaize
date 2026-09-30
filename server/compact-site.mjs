import {readFile} from 'node:fs/promises';
import path from 'node:path';
const actionKey=a=>JSON.stringify([a?.type,a?.selector,a?.label,a?.y]);
const rect=(n,v)=>({x:Math.max(0,n.bounds.x),y:Math.max(0,n.bounds.y),right:Math.min(v.width,n.bounds.x+n.bounds.width),bottom:Math.min(v.height,n.bounds.y+n.bounds.height)});
function signature(n){return JSON.stringify([n.type,n.name,n.text,n.semantic,n.style,n.svg, ...['x','y','width','height'].map(k=>Math.round(n.bounds[k]/2)*2)]);}
function paints(n){return n.type!=='frame'||n.semantic?.component||n.style?.borderWidth>0||!['transparent','rgba(0, 0, 0, 0)',undefined].includes(n.style?.background);}
export function changeRegion(capture,base){
 const v=capture.viewport,full={x:0,y:0,width:v.width,height:v.height};
 if(!base||base.viewport.width!==v.width||base.viewport.height!==v.height)return full;
 // Compare visible editable content, not video pixels or sequential DOM IDs.
 const a=new Set(base.nodes.map(signature)),b=new Set(capture.nodes.map(signature));
 const changed=[...capture.nodes.filter(n=>!a.has(signature(n))),...base.nodes.filter(n=>!b.has(signature(n)))].filter(paints).map(n=>rect(n,v)).filter(r=>r.right>r.x&&r.bottom>r.y);
 if(!changed.length)return null;
 const x=Math.max(0,Math.floor(Math.min(...changed.map(r=>r.x))-12)),y=Math.max(0,Math.floor(Math.min(...changed.map(r=>r.y))-12));
 const right=Math.min(v.width,Math.ceil(Math.max(...changed.map(r=>r.right))+12)),bottom=Math.min(v.height,Math.ceil(Math.max(...changed.map(r=>r.bottom))+12));
 return {x,y,width:right-x,height:bottom-y};
}
export function cropCapture(capture,crop){
 if(!crop)return capture;
 const copy=structuredClone(capture),byId=new Map(copy.nodes.map(n=>[n.id,n])),keep=new Set();
 for(const n of copy.nodes){const b=n.bounds;if(b.x<crop.x+crop.width&&b.y<crop.y+crop.height&&b.x+b.width>crop.x&&b.y+b.height>crop.y){for(let p=n;p;p=byId.get(p.parentId))keep.add(p.id);}}
 copy.nodes=copy.nodes.filter(n=>keep.has(n.id)).map(n=>({...n,bounds:{...n.bounds,x:n.bounds.x-crop.x,y:n.bounds.y-crop.y}}));
 copy.viewport={width:crop.width,height:crop.height};delete copy.screenshot;
 return copy;
}
export async function planCompactSite(manifestPath){
 const m=JSON.parse(await readFile(manifestPath)),dir=path.dirname(manifestPath),screens=m.screens.filter(s=>['captured','imported'].includes(s.status));
 const captures=new Map();for(const s of screens){const file=path.resolve(dir,s.path);if(!file.startsWith(path.resolve(dir)+path.sep))throw Error('Capture path escaped collection');captures.set(s.id,JSON.parse(await readFile(file)));}
 const plans=[];
 for(const s of screens){
  const actions=s.actions||[],siblings=screens.filter(p=>p.url===s.url&&p.id!==s.id);
  const candidates=siblings.filter(p=>(p.actions||[]).length<actions.length&&(p.actions||[]).every((a,i)=>actionKey(a)===actionKey(actions[i]))).sort((a,b)=>(b.actions||[]).length-(a.actions||[]).length);
  const base=candidates[0]||siblings.find(p=>!p.actions?.length),capture=captures.get(s.id);
  const family=!actions.length?'00 · 대표 화면':actions[0].type==='scroll'?'02 · 본문 구간':actions.length===1&&actions[0].global?'01 · 공통 메뉴':`상태 · ${actions[0].label||'Interaction'}`;
  const region=actions.length?changeRegion(capture,captures.get(base?.id)):null;
  plans.push({screenId:s.id,url:s.url,pageLabel:new URL(s.url).pathname,family,label:s.label,baseScreenId:base?.id||null,crop:region||{x:0,y:0,width:capture.viewport.width,height:capture.viewport.height},unchanged:actions.length>0&&region===null});
 }
 return {manifest:m,plans,captures};
}
