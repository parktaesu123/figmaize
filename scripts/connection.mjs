import { getToken, URL_BASE } from '../server/config.mjs';
import { ensureBridge, requestBridge } from '../server/client.mjs';
await ensureBridge();
const token=await getToken();
if(process.argv.includes('--write-note')){
  const {writeFile}=await import('node:fs/promises');
  const {DATA_DIR}=await import('../server/config.mjs');
  const path=await import('node:path');
  await writeFile(path.join(DATA_DIR,'connection.txt'),`figmaize 연결\n\n주소: ${URL_BASE}\n연결 코드: ${token}\n\nFigma → figmaize 플러그인 → 연결 코드 붙여넣기 → 연결\n이 코드는 이 기기의 로컬 브리지 접근용입니다.\n`,{mode:0o600});
  console.log('Connection note written to .layer-bridge/connection.txt');
}else{
  console.log(`\nfigmaize · Figma 연결\n주소: ${URL_BASE}\n연결 코드: ${token}\n\nFigma의 figmaize 플러그인에서 이 코드를 입력하세요.\n`);
  const {sessions}=await requestBridge('/v1/sessions');console.log(`연결된 피그마: ${sessions.length}개`);
}
