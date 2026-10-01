/* Native reuse is opt-in; unchanged user masters are never overwritten. */
function reusableSignature(source, capture) {
  const items=[],byParent=new Map();for(const n of capture.nodes){const list=byParent.get(n.parentId)||[];list.push(n);byParent.set(n.parentId,list);}
  function visit(n){if(items.length>50)return;items.push([n.type,n.text,n.svg,n.image,n.style,n.layout,n.bounds.width,n.bounds.height,n.bounds.x-source.bounds.x,n.bounds.y-source.bounds.y]);for(const child of byParent.get(n.id)||[])visit(child);}
  visit(source);if(items.length>50)return null;const value=JSON.stringify([source.semantic?.kind,items]);return value.length<60000?value:null;
}
async function shareComponents(byId,capture,stage,options,warnings){
  if(!options.reuseComponents&&!options.variants)return {instanceCount:0,variantSets:0};
  const scope=capture.source?.collection?.id||stage.id,page=figma.currentPage;
  const masters=page.findAll(n=>n.type==='COMPONENT'&&n.getPluginData('figmaizeComponentScope')===scope);
  let instanceCount=0,variantSets=0,library;
  function libraryFrame(){if(library)return library;library=page.children.find(n=>n.getPluginData('figmaizeLibrary')===scope);if(!library){library=figma.createFrame();page.appendChild(library);library.name='Components / '+(capture.source?.url||'Capture');library.setPluginData('figmaizeLibrary',scope);library.fills=[];library.clipsContent=false;library.x=Math.max(stage.x+stage.width+200,...page.children.filter(n=>n!==library).map(n=>n.x+n.width+200));library.y=stage.y;library.resize(1000,1000);}return library;}
  function replace(component,master){const parent=component.parent,index=parent.children.indexOf(component),x=component.x,y=component.y;const instance=master.createInstance();parent.insertChild(index,instance);instance.name=component.name;instance.resize(component.width,component.height);instance.x=x;instance.y=y;for(const k of ['layerBridgeSelector','layerBridgeSemantic'])instance.setPluginData(k,component.getPluginData(k));if(parent.layoutMode&&parent.layoutMode!=='NONE'){instance.layoutPositioning=component.layoutPositioning;instance.layoutGrow=component.layoutGrow;instance.layoutAlign=component.layoutAlign;}return instance;}
  for(const entry of byId.values()){
    const component=entry.target,source=entry.source;if(component.type!=='COMPONENT'||component.removed)continue;
    const sig=reusableSignature(source,capture);if(!sig)continue;
    const family=source.selector?JSON.stringify([capture.source?.url,source.selector,source.semantic?.kind]):'';
    const same=masters.find(n=>!n.removed&&n.getPluginData('figmaizeSignature')===sig);
    if(same&&options.reuseComponents){entry.target=replace(component,same);component.remove();instanceCount++;continue;}
    component.setPluginData('figmaizeComponentScope',scope);component.setPluginData('figmaizeSignature',sig);component.setPluginData('figmaizeFamily',family);
    const related=options.variants&&family?masters.find(n=>!n.removed&&n.getPluginData('figmaizeFamily')===family&&n.getPluginData('figmaizeSignature')!==sig):null;
    if(related){
      const instance=replace(component,component);entry.target=instance;instanceCount++;
      let set=related.parent?.type==='COMPONENT_SET'?related.parent:null;
      if(!set){const oldInstance=replace(related,related);instanceCount++;for(const value of byId.values())if(value.target===related)value.target=oldInstance;
        const lib=libraryFrame();component.name='State=2';related.name='State=1';set=figma.combineAsVariants([related,component],lib);set.name=(source.semantic?.kind||'Control')+' / '+source.semantic?.label;set.x=0;set.y=lib.children.filter(n=>n!==set).reduce((h,n)=>Math.max(h,n.y+n.height+60),0);variantSets++;
      }else{component.name='State='+(set.children.length+1);set.appendChild(component);}
      let x=0;for(const variant of set.children){variant.x=x;variant.y=0;x+=variant.width+32;}set.resize(Math.max(1,x),Math.max(...set.children.map(n=>n.height)));const lib=libraryFrame();lib.resize(Math.max(1000,set.width),Math.max(lib.height,set.y+set.height));
    }
    masters.push(component);
  }
  return {instanceCount,variantSets};
}
async function linkCapturedState(stage,capture,options,warnings){
  if(!options.prototype||!capture.source?.presentation?.baseScreenId)return 0;
  const source=capture.source,base=collectionStages(figma.currentPage,source.collection.id).find(n=>n.getPluginData('layerBridgeCaptureKey')===source.collection.id+'/'+source.presentation.baseScreenId);
  const action=source.actions?.at(-1);if(!base||!['click','hover'].includes(action?.type))return 0;
  const controls=base.findAll(n=>n.getPluginData('layerBridgeSelector')===action.selector);
  if(controls.length!==1||typeof controls[0].setReactionsAsync!=='function')return 0;
  const trigger={type:action.type==='hover'?'ON_HOVER':'ON_CLICK'};
  const reactions=[...(controls[0].reactions||[])];if(reactions.some(r=>r.trigger?.type===trigger.type))return 0;
  await controls[0].setReactionsAsync([...reactions,{trigger,actions:[{type:'NODE',destinationId:stage.id,navigation:'NAVIGATE',transition:null,preserveScrollPosition:false}]}]);return 1;
}
