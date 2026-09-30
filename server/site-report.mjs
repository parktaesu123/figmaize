export function collectionCoverage(manifest,journal={entries:[]}) {
 const captured=manifest.screens.filter(s=>['captured','imported'].includes(s.status));
 const key=(url,a)=>url+'|'+a?.type+'|'+a?.selector+'|'+a?.label;
 const resolved=new Set(manifest.screens.filter(s=>['captured','imported','duplicate'].includes(s.status)).flatMap(s=>(s.actions||[]).map(a=>key(s.url,a))));
 const unresolved=new Map();
 for(const s of manifest.skipped||[]){
  if(s.reason==='Unlabelled, disabled, form, or consequential control'||s.reason==='Navigation outside language scope')continue;
  const action=s.actions?.at(-1)||s,k=key(s.url,action);
  if(!resolved.has(k))unresolved.set(k,{url:s.url,label:(s.actions||[s]).map(a=>a.label).join(' → '),reason:s.reason.split('\n')[0]});
 }
 const entries=journal.entries.filter(e=>e.status==='complete'),imported=new Set(entries.map(e=>e.screenId));
 const failures=manifest.screens.filter(s=>s.status==='failed');
 return {pages:manifest.pages.length,screens:captured.length,duplicates:manifest.screens.filter(s=>s.status==='duplicate').length,
 imported:captured.filter(s=>imported.has(s.id)).length,components:entries.reduce((n,e)=>n+(e.components||0),0),autoLayouts:entries.reduce((n,e)=>n+(e.autoLayout||0),0),
 pendingImports:captured.filter(s=>!imported.has(s.id)).length,pendingUrls:manifest.pendingUrls?.length||0,
 failedPages:manifest.pages.filter(p=>p.status==='failed'),failedScreens:failures,unresolvedControls:[...unresolved.values()],
 excluded:manifest.excluded.length,captureComplete:!!manifest.complete&&!unresolved.size,limitReached:!!manifest.limitReached};
}
export function coverageMarkdown(manifest,journal,fileKey){
 const c=collectionCoverage(manifest,journal),entries=new Map(journal.entries.map(e=>[e.screenId,e]));
 const origin=manifest.config?.url||'사이트',scope=manifest.config?.pathPrefix||'/';
 const lines=['# 사이트 수집 현황 — '+origin.replace(/[\r\n]/g,' '),'',`업데이트: ${new Date().toISOString()}`,'',
 `페이지 ${c.pages}개 · 고유 화면 ${c.screens}개 · 피그마 완료 ${c.imported}개 · 컴포넌트 ${c.components}개 · Auto Layout ${c.autoLayouts}개`,
 '',`수집 완료 판정: ${c.captureComplete?'완료':'미완료'} / 피그마 미반영 ${c.pendingImports}개 / 미해결 조작 ${c.unresolvedControls.length}개`,'',
 `범위는 ${scope} 하위 공개 페이지와 버튼·메뉴·팝업입니다. 범위 밖 링크와 로그인·폼 제출은 제외합니다. 화면은 수집 시점의 편집 가능한 복사본이며, 동영상은 정지 이미지입니다. 페이지 아래 대표 화면과 기능별 상태를 중첩하고 변경 영역을 표시합니다. 중첩 카드는 편집 프레임, 내부 버튼은 컴포넌트입니다. 공유 인스턴스·Variant·프로토타입 전환은 자동 생성하지 않습니다.`,'',
 '## 화면 목록','', '| 페이지 / 상태 | 피그마 | 컴포넌트 | Auto Layout |','| --- | --- | ---: | ---: |'];
 const clean=s=>String(s).replace(/\|/g,' / ').replace(/[\r\n]/g,' ');
 for(const s of manifest.screens.filter(s=>['captured','imported'].includes(s.status))){const e=entries.get(s.id);lines.push(`| ${clean(s.label)} | ${e?.status==='complete'?`[열기](https://www.figma.com/design/${fileKey}?node-id=${e.nodeId.replace(':','-')})`:'대기'} | ${e?.components??'—'} | ${e?.autoLayout??'—'} |`);}
 lines.push('','## 미해결 항목','');
 for(const x of [...c.unresolvedControls,...c.failedPages,...c.failedScreens])lines.push(`- ${clean(x.label||x.url)}: ${clean(x.reason||x.error)}`);
 if(!c.unresolvedControls.length&&!c.failedPages.length&&!c.failedScreens.length)lines.push('기록된 오류 없음. 완료 여부는 위 수집 완료 판정을 확인하세요.');
 lines.push('','## 범위 밖 링크','');for(const x of manifest.excluded)lines.push(`- ${clean(x.label)} — ${x.url}`);
 return lines.join('\n')+'\n';
}
