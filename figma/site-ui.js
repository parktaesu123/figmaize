// Shared authenticated API; no MCP client is required for this interface.
let activeCollection=null,siteWatching=false,siteWatchAgain=false;
const siteStatus=text=>{$('#site-status').textContent=text;};
async function refreshCollections(){
 if(!sessionId)return;const {collections}=await api('/v1/sites');const select=$('#collections');select.replaceChildren();
 for(const item of collections){const option=document.createElement('option');option.value=item.manifestPath;option.textContent=`${item.url} · ${item.imported}/${(item.screens.captured||0)+(item.screens.imported||0)}`;select.append(option);}
 if(activeCollection)select.value=activeCollection;else if(collections.length){activeCollection=collections.at(-1).manifestPath;select.value=activeCollection;}
}
function siteInput(){return {url:$('#site-url').value.trim(),mode:$('#scope').value,width:Number($('#site-width').value),height:Number($('#site-height').value),maxPages:Number($('#page-limit').value),maxScreens:Number($('#screen-limit').value),scroll:$('#site-scroll').checked,interactions:$('#site-actions').checked,selectedUrls:[...document.querySelectorAll('#page-list input:checked')].map(el=>el.value)};}
async function watchCollection(){
 if(siteWatching){siteWatchAgain=true;return;}siteWatching=true;siteWatchAgain=false;
 try{while(sessionId&&activeCollection){
  const item=activeCollection;let status;
  try{status=await api('/v1/sites/status?manifestPath='+encodeURIComponent(item));}catch(error){siteStatus(error.message);break;}
  if(item!==activeCollection)continue;
  siteStatus(`수집 ${status.pages}페이지 · ${status.screens.captured||0}화면 / 피그마 완료 ${status.imported}\n${status.cancelRequested&&(status.capturing||status.importing)?'현재 작업 후 중단합니다.':status.capturing?'수집 중':status.importing?'피그마에 만드는 중':status.captureStatus+' · '+status.importStatus}${status.error?'\n'+status.error:''}${status.limitReached?'\n선택한 수집 한도에 도달했습니다.':''}`);
  $('#site-import').disabled=status.capturing||status.importing||!status.screens.captured;
  $('#site-cancel').disabled=!status.capturing&&!status.importing;
  $('#site-resume').disabled=status.capturing||status.importing;
  if(!status.capturing&&!status.importing){await refreshCollections();break;}
  await pause(1500);
 }}finally{siteWatching=false;if(siteWatchAgain)void watchCollection();}
}
async function siteAction(fn){try{if(!sessionId)throw Error('먼저 로컬 수집기에 연결하세요.');await fn();}catch(error){siteStatus(error.message);}}
$('#site-discover').onclick=()=>siteAction(async()=>{
 siteStatus('시작 페이지의 링크를 찾고 있습니다…');const result=await api('/v1/sites/discover','POST',{url:$('#site-url').value.trim()});$('#page-list').replaceChildren();
 for(const page of result.pages){const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.value=page.url;checkbox.checked=true;text.textContent=page.label+' — '+page.url;label.append(checkbox,text);$('#page-list').append(label);}
 $('#scope').value='selected';siteStatus(`${result.pages.length}개 링크를 찾았습니다. 가져올 페이지를 선택하세요.`);
});
$('#site-start').onclick=()=>siteAction(async()=>{
 $('#site-start').disabled=true;try{const result=await api('/v1/sites/start','POST',siteInput());activeCollection=result.manifestPath;await refreshCollections();void watchCollection();}finally{$('#site-start').disabled=false;}
});
$('#site-import').onclick=()=>siteAction(async()=>{
 if(!activeCollection)throw Error('수집 결과를 선택하세요.');
 await api('/v1/sites/import','POST',{manifestPath:activeCollection,sessionId,options:{newPage:$('#new-page').checked,reuseComponents:$('#reuse-components').checked,variants:$('#make-variants').checked,prototype:$('#make-prototype').checked}});void watchCollection();
});
$('#site-cancel').onclick=()=>siteAction(async()=>{await api('/v1/sites/cancel','POST',{manifestPath:activeCollection});siteStatus('중단 요청을 저장했습니다. 실행 중인 피그마 작업의 결과를 기다립니다.');});
$('#site-resume').onclick=()=>siteAction(async()=>{await api('/v1/sites/resume','POST',{manifestPath:activeCollection,maxPages:Number($('#page-limit').value),maxScreens:Number($('#screen-limit').value)});void watchCollection();});
$('#site-refresh').onclick=()=>siteAction(async()=>{await refreshCollections();void watchCollection();});
$('#collections').onchange=()=>{activeCollection=$('#collections').value;void watchCollection();};
