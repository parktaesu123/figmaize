import test from 'node:test';import assert from 'node:assert/strict';
import {changeRegion,cropCapture} from '../server/compact-site.mjs';
const frame={id:'f',type:'frame',name:'Wrapper',bounds:{x:0,y:0,width:1000,height:800},style:{background:'transparent'}};
const text={id:'t',parentId:'f',type:'text',name:'Label',text:'Open',bounds:{x:800,y:100,width:100,height:30}};
const base={viewport:{width:1000,height:800},nodes:[frame,text]};
test('state crop detects changed label while ignoring sequential IDs and video pixels',()=>{
 const changed={...base,nodes:[{...frame,id:'new'}, {...text,id:'t2',parentId:'new',text:'Closed'}]};
 assert.deepEqual(changeRegion(changed,base),{x:788,y:88,width:124,height:54});
 assert.equal(changeRegion({...base,nodes:base.nodes.map(n=>({...n,id:n.id+'2',image:'different'}))},base),null);
});
test('cropped capture preserves ancestors, relative geometry and editable text',()=>{
 const c=cropCapture({...base,screenshot:'image',nodes:[...base.nodes,{...text,id:'outside',bounds:{x:0,y:0,width:20,height:20}}]}, {x:788,y:88,width:124,height:54});
 assert.equal(c.nodes.length,2);assert.equal(c.nodes[1].text,'Open');assert.equal(c.nodes[1].bounds.x-c.nodes[0].bounds.x,800);assert.equal(c.screenshot,undefined);
});
