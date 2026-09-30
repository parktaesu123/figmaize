import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const schema=await readFile(new URL('../shared/schema.js',import.meta.url),'utf8');
const code=await readFile(new URL('../figma/importer.js',import.meta.url),'utf8');
function harness(failFont=false){
  const nodes=[],messages=[];
  class Node{
    constructor(type){this.id='node:'+nodes.length;this.type=type;this.name=type;this.children=[];this.width=100;this.height=100;this.x=0;this.y=0;this.fills=[];this.cornerRadius=0;this.data={};this.characters='';this.resizeCalls=[];nodes.push(this);}
    appendChild(n){if(!['FRAME','PAGE','COMPONENT'].includes(this.type))throw new Error('Cannot append to '+this.type);if(n.type==='COMPONENT')for(let p=this;p;p=p.parent)if(p.type==='COMPONENT')throw new Error('Nested main components are forbidden');if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);this.children.push(n);n.parent=this;}
    addComponentProperty(name,type,defaultValue){this.componentPropertyDefinitions||={};const key=name+'#'+this.id;this.componentPropertyDefinitions[key]={type,defaultValue};return key;}
    resize(w,h){if(w<=0||h<=0)throw new Error('Invalid size');this.resizeCalls.push([w,h]);this.width=w;this.height=h;}
    set textAutoResize(mode){this._textAutoResize=mode;if(mode==='WIDTH_AND_HEIGHT'){this.width=this.characters.length*this.fontSize*.6;this.height=this.lineHeight?.value||this.fontSize*1.2;}}
    get textAutoResize(){return this._textAutoResize;}
    rescale(n){this.width*=n;this.height*=n;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.removed=true;for(const child of this.children)child.remove();}
    setPluginData(k,v){this.data[k]=v;}
    getPluginData(k){return this.data[k]||'';}
    getRangeAllFontNames(){return [this.fontName];}
    async exportAsync(){return new Uint8Array([137,80,78,71]);}
  }
  const page=new Node('PAGE');
  const create=type=>()=>{const n=new Node(type);page.appendChild(n);return n;};
  const figma={root:{name:'Test file',children:[page]},currentPage:page,mixed:Symbol('mixed'),getNodeByIdAsync:async id=>nodes.find(n=>n.id===id),showUI(){},ui:{postMessage:m=>messages.push(m)},viewport:{center:{x:0,y:0},scrollAndZoomIntoView(){}},notify(){},listAvailableFontsAsync:async()=>[{fontName:{family:'Inter',style:'Regular'}}],loadFontAsync:async()=>{if(failFont)throw new Error('Font unavailable');},createFrame:create('FRAME'),createRectangle:create('RECTANGLE'),createText:create('TEXT'),createNodeFromSvg:create('FRAME'),createImage:data=>({hash:'image-'+data.length})};
  figma.createComponent=create('COMPONENT');
  vm.runInNewContext(schema+'\n'+code,{figma,__html__:'',setTimeout,Uint8Array,console});return {figma,nodes,messages,page};
}
const scene=()=>({format:'layer-bridge',version:1,title:'Test',viewport:{width:390,height:844},warnings:[],nodes:[{id:'card',type:'frame',name:'Card',parentId:null,bounds:{x:20,y:40,width:300,height:200},style:{background:'#ffffff'}},{id:'title',type:'text',name:'Title',parentId:'card',text:'편집 가능한 제목',bounds:{x:36,y:56,width:240,height:30},style:{fontFamily:'Unknown',fontSize:20,color:'#202623'}}]});
test('import creates editable text and preserves relative coordinates',async()=>{const h=harness();await h.figma.ui.onmessage({type:'import',capture:scene(),options:{}});const text=h.nodes.find(n=>n.type==='TEXT');assert.equal(text.characters,'편집 가능한 제목');assert.equal(text.x,16);assert.equal(text.y,16);assert.equal(text.parent.name,'Card');assert.equal(h.page.children.length,1);assert.equal(h.messages.at(-1).type,'complete');assert.match(h.messages.at(-1).warnings.join(' '),/대체 폰트/);});
test('font failures roll back all generated nodes',async()=>{const h=harness(true);await h.figma.ui.onmessage({type:'import',capture:scene()});assert.equal(h.messages.at(-1).type,'error');assert.equal(h.page.children.length,0);});
test('invalid captures leave the document untouched',async()=>{const h=harness();const v=scene();v.nodes[1].parentId='missing';await h.figma.ui.onmessage({type:'import',capture:v});assert.equal(h.messages.at(-1).type,'error');assert.equal(h.page.children.length,0);});
test('reference screenshot is separate and locked',async()=>{const h=harness();const v=scene();v.screenshot='data:image/png;base64,AA==';await h.figma.ui.onmessage({type:'import',capture:v,options:{reference:true}});const ref=h.nodes.find(n=>n.type==='RECTANGLE');assert.equal(ref.locked,true);assert.equal(ref.fills[0].type,'IMAGE');assert.equal(h.page.children[0].children[1].x,470);});
test('captured DOM lines preserve their baseline positions without rewrapping fallback text',async()=>{
  const h=harness(),v=scene();
  v.nodes[1]={...v.nodes[1],source:'dom-text',text:'A longer captured line',bounds:{x:36,y:56,width:120,height:24},style:{fontFamily:'system-ui',fontSize:20,lineHeight:24,color:'#202623'}};
  v.nodes.push({...v.nodes[1],id:'line-two',text:'Second line',bounds:{x:36,y:80,width:90,height:24}});
  await h.figma.ui.onmessage({type:'import',capture:v});
  const lines=h.nodes.filter(n=>n.type==='TEXT');
  for(const line of lines){assert.equal(line.textAutoResize,'WIDTH_AND_HEIGHT');assert.equal(line.resizeCalls.length,0);assert.equal(line.height,24);assert.equal(line.x,16);}
  assert.ok(lines[0].width>v.nodes[1].bounds.width);assert.equal(lines[0].y,16);assert.equal(lines[1].y,40);
  assert.match(h.messages.at(-1).warnings.join(' '),/줄 너비/);
});
test('manual multiline, input fields, and explicit multiline DOM text keep captured boxes',async()=>{
  const h=harness(),v=scene(),template=v.nodes[1];
  v.nodes=[v.nodes[0],...['manual','dom-input','dom-text'].map((source,index)=>({...template,id:'text-'+index,source,text:source==='dom-input'?'Input text':'First line\nSecond line'}))];
  await h.figma.ui.onmessage({type:'import',capture:v});
  for(const node of h.nodes.filter(n=>n.type==='TEXT')){assert.equal(node.textAutoResize,'NONE');assert.equal(node.width,240);assert.equal(node.height,30);assert.equal(node.resizeCalls.length,1);}
});
test('new captures sit to the right of tagged or legacy captures without moving other layers',async()=>{
  const h=harness(),legacy=h.figma.createFrame(),unrelated=h.figma.createFrame();
  legacy.name='Layer Bridge / old capture';legacy.setPluginData('source','{}');legacy.x=100;legacy.y=80;legacy.resize(390,844);
  unrelated.name='Layer Bridge / user frame';unrelated.x=10000;unrelated.y=200;unrelated.resize(500,400);
  await h.figma.ui.onmessage({type:'import',capture:scene()});
  const first=h.page.children.at(-1);assert.equal(first.x,610);assert.equal(first.y,80);assert.equal(first.getPluginData('layerBridgeCapture'),'1');
  first.name='Renamed captured frame';
  await h.figma.ui.onmessage({type:'import',capture:scene()});
  const second=h.page.children.at(-1);assert.equal(second.x,first.x+first.width+120);assert.equal(second.y,80);
  assert.equal(legacy.x,100);assert.equal(legacy.y,80);assert.equal(unrelated.x,10000);assert.equal(unrelated.y,200);
});
const command=async(h,id,operation,payload={})=>{await h.figma.ui.onmessage({type:'bridge-command',id,operation,payload});return h.messages.at(-1);};
test('import summary reports actual native types and bounded editable text IDs',async()=>{
  const h=harness(),v=scene();
  for(let i=0;i<6;i++)v.nodes.push({...v.nodes[1],id:'extra-'+i,text:'x'.repeat(130+i)});
  const reply=await command(h,'summary','import_capture',{capture:v});
  assert.equal(reply.ok,true);
  assert.equal(reply.result.nativeSummary.types.TEXT,7);
  assert.equal(reply.result.nativeSummary.types.FRAME,1);
  assert.equal(reply.result.nativeSummary.textSamples.length,4);
  for(const sample of reply.result.nativeSummary.textSamples){
    const actual=h.nodes.find(n=>n.id===sample.id);
    assert.equal(actual.type,'TEXT');assert.equal(sample.text,actual.characters.slice(0,120));
  }
});
test('bridge import returns native IDs and duplicate job never creates twice',async()=>{const h=harness();const first=await command(h,'job-1','import_capture',{capture:scene(),expectedPageId:h.page.id});assert.equal(first.ok,true);assert.ok(first.result.nodeId);await command(h,'job-1','import_capture',{capture:scene()});assert.equal(h.page.children.length,1);assert.equal(h.messages.at(-1).result.nodeId,first.result.nodeId);});
test('changed page and cross-page edits are rejected before mutation',async()=>{const h=harness();const result=await command(h,'bad-page','import_capture',{capture:scene(),expectedPageId:'other'});assert.equal(result.ok,false);assert.equal(h.page.children.length,0);await command(h,'import','import_capture',{capture:scene()});const text=h.nodes.find(n=>n.type==='TEXT');h.figma.currentPage={id:'other',type:'PAGE'};const edit=await command(h,'edit','update_node',{nodeId:text.id,changes:{text:'wrong page'}});assert.equal(edit.ok,false);assert.equal(text.characters,'편집 가능한 제목');});
test('inspection, validated text edit and PNG export round trip',async()=>{const h=harness();await command(h,'import','import_capture',{capture:scene()});const text=h.nodes.find(n=>n.type==='TEXT');const invalid=await command(h,'invalid','update_node',{nodeId:text.id,changes:{text:'must not change',width:-1}});assert.equal(invalid.ok,false);assert.equal(text.characters,'편집 가능한 제목');const update=await command(h,'update','update_node',{nodeId:text.id,changes:{text:'수정된 제목',fill:'#ff0000'},expectedPageId:h.page.id});assert.equal(update.ok,true);assert.equal(text.characters,'수정된 제목');const inspected=await command(h,'inspect','inspect_node',{nodeId:text.id,depth:0});assert.equal(inspected.result.node.text,'수정된 제목');const png=await command(h,'png','export_png',{nodeId:text.id,scale:1});assert.equal(png.result.mimeType,'image/png');assert.equal(png.result.base64,'iVBORw==');});

test('semantic controls become native components with editable text properties',async()=>{
  const h=harness(),v=scene();
  v.nodes[0].semantic={kind:'button',label:'Save',component:true};
  const reply=await command(h,'component','import_capture',{capture:v});
  assert.equal(reply.ok,true);
  const component=h.nodes.find(n=>n.type==='COMPONENT'),text=h.nodes.find(n=>n.type==='TEXT');
  assert.equal(component.name,'Button / Save');
  const key=text.componentPropertyReferences.characters;
  assert.equal(component.componentPropertyDefinitions[key].type,'TEXT');
  assert.equal(component.componentPropertyDefinitions[key].defaultValue,text.characters);
  assert.equal(reply.result.nativeSummary.componentCount,1);
  const inspected=await command(h,'inspect-component','inspect_node',{nodeId:component.id,depth:1});
  assert.ok(inspected.result.node.componentPropertyDefinitions[key]);
  const edit=await command(h,'edit-label','update_node',{nodeId:text.id,changes:{text:'Save changes'}});
  assert.equal(edit.ok,true);assert.equal(text.characters,'Save changes');
});
test('measured flex row becomes editable Auto Layout and absolute overlays stay in place',async()=>{
  const h=harness();
  const v={format:'layer-bridge',version:1,viewport:{width:400,height:200},nodes:[
    {id:'row',type:'frame',name:'Actions',bounds:{x:10,y:10,width:200,height:60},layout:{mode:'HORIZONTAL',gap:20,padding:[10,10,10,10],justify:'start',align:'center'}},
    ...[0,1].map(i=>({id:'button-'+i,parentId:'row',type:'frame',name:'Button',semantic:{kind:'button',label:'Action '+i,component:true},bounds:{x:20+i*100,y:20,width:80,height:40}})),
    {id:'overlay',parentId:'row',type:'frame',name:'Badge',bounds:{x:195,y:5,width:10,height:10},flow:{position:'absolute',grow:0,align:'auto',margin:[0,0,0,0]}}
  ]};
  const reply=await command(h,'row','import_capture',{capture:v});assert.equal(reply.ok,true);
  const row=h.nodes.find(n=>n.name==='Actions'),badge=h.nodes.find(n=>n.name==='Badge');
  assert.equal(row.layoutMode,'HORIZONTAL');assert.equal(row.itemSpacing,20);assert.equal(row.paddingLeft,10);
  assert.equal(row.counterAxisAlignItems,'CENTER');assert.equal(badge.layoutPositioning,'ABSOLUTE');assert.equal(badge.x,185);assert.equal(badge.y,-5);
  assert.equal(reply.result.nativeSummary.autoLayoutCount,1);assert.equal(reply.result.nativeSummary.componentCount,2);
});
test('wrapping, margins and mismatched measurements retain editable absolute layout',async()=>{
  for(const change of [{mode:'PRESERVE'},{gap:80}]){
    const h=harness(),v=scene();v.nodes[0].layout={mode:'HORIZONTAL',gap:0,padding:[16,16,16,16],justify:'center',align:'center',...change};
    const reply=await command(h,'fallback','import_capture',{capture:v});
    assert.equal(reply.ok,true);assert.equal(reply.result.nativeSummary.autoLayoutCount,0);assert.equal(reply.result.nativeSummary.preservedLayoutCount,1);
    const text=h.nodes.find(n=>n.type==='TEXT');assert.equal(text.x,16);assert.equal(text.y,16);
  }
});
test('nested controls stay reusable while enclosing cards remain editable frames',async()=>{
  const h=harness(),v=scene();v.nodes[0].semantic={kind:'card',label:'Profile',component:true};
  v.nodes.push({id:'button',parentId:'card',type:'frame',name:'Button',semantic:{kind:'button',label:'Follow',component:true},bounds:{x:36,y:100,width:100,height:40}},
    {...v.nodes[1],id:'button-text',parentId:'button',text:'Follow',bounds:{x:46,y:110,width:60,height:20}});
  const reply=await command(h,'nested','import_capture',{capture:v});assert.equal(reply.ok,true);
  for(const component of h.nodes.filter(n=>n.type==='COMPONENT'))assert.equal(Object.keys(component.componentPropertyDefinitions).length,1);
  assert.equal(reply.result.nativeSummary.componentCount,1);
  assert.equal(h.nodes.find(n=>n.name==='Card / Profile').type,'FRAME');
});

test('collection frames use a four-column grid and repeated screen IDs reuse native results',async()=>{
  const h=harness();let first;
  for(let index=0;index<5;index++){
    const v=scene();v.source={collection:{id:'site-test',index},screenId:'screen-'+index};
    const r=await command(h,'collection-'+index,'import_capture',{capture:v});assert.equal(r.ok,true);
    if(index===0)first=h.nodes.find(n=>n.id===r.result.nodeId);
    if(index===4){const last=h.nodes.find(n=>n.id===r.result.nodeId);assert.equal(last.x,first.x);assert.equal(last.y,first.y+844+160);}
  }
  const before=h.page.children.length,v=scene();v.source={collection:{id:'site-test',index:0},screenId:'screen-0'};
  const again=await command(h,'repeated-screen','import_capture',{capture:v});assert.equal(again.result.reused,true);assert.equal(again.result.nodeId,first.id);assert.equal(h.page.children.length,before);
});

test('compact collection nests existing states without cloning or deleting editable layers',async()=>{
 const h=harness(),v=scene();let stage;
 for(let index=0;index<2;index++){v.source={collection:{id:'site-compact',index},screenId:'screen-'+index};const r=await command(h,'original-'+index,'import_capture',{capture:structuredClone(v)});if(index===1)stage=h.nodes.find(n=>n.id===r.result.nodeId);}
 const text=h.nodes.find(n=>n.type==='TEXT'),textId=text.id,originalX=stage.children[0].x;
 const plans=[0,1].map(i=>({screenId:'screen-'+i,url:'https://example.com/en',pageLabel:'/en',label:i?'Menu open':'Default',family:i?'Menus':'Default',crop:{x:i?20:0,y:i?40:0,width:i?200:390,height:i?100:844}}));
 const r=await command(h,'organize','import_capture',{capture:v,options:{organizeCollection:{id:'site-compact',plans}}});
 assert.equal(r.ok,true);assert.equal(r.result.pageFrames.length,1);assert.equal(h.page.children.length,1);assert.equal(stage.width,200);assert.equal(stage.children[0].x,originalX-20);assert.equal(text.id,textId);assert.ok(!text.removed);
 const count=h.nodes.length;await command(h,'organize-again','import_capture',{capture:v,options:{organizeCollection:{id:'site-compact',plans}}});assert.equal(h.nodes.length,count);assert.equal(stage.children[0].x,originalX-20);
 const again=await command(h,'repeat-import','import_capture',{capture:v});assert.equal(again.result.reused,true);
});
test('reorganizing a pre-cropped new import does not crop it twice',async()=>{
 const h=harness(),v=scene(),plan={screenId:'screen-new',url:'https://example.com/en',pageLabel:'/en',family:'Menu',label:'Popup',crop:{x:20,y:40,width:200,height:100}};
 v.source={collection:{id:'site-new',index:0},screenId:'screen-new',presentation:plan};v.viewport={width:200,height:100};
 const r=await command(h,'new-crop','import_capture',{capture:v});assert.equal(r.ok,true);
 const stage=h.nodes.find(n=>n.id===r.result.nodeId),root=stage.children[0];assert.equal(root.x,0);
 await command(h,'reorganize','import_capture',{capture:v,options:{organizeCollection:{id:'site-new',plans:[plan]}}});
 assert.equal(root.x,0);assert.equal(root.y,0);assert.equal(stage.width,200);
});
