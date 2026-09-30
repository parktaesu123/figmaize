# Toss — 수집 사례

Toss는 공통 엔진을 검증한 사례이며 제품의 필수 의존성이나 전용 모드가 아닙니다. 사이트를 바꾸려면 URL과 출력 폴더만 바꿉니다.

```sh
node scripts/capture-site.mjs https://toss.im/en-us --out .layer-bridge/sites/toss-en-us --max-pages 10 --max-screens 50
node scripts/import-site.mjs .layer-bridge/sites/toss-en-us/manifest.json SESSION_ID
```

위 한도는 작은 재현용 범위이며 전체 사이트 수집을 의미하지 않습니다. Figma에 figmaize 플러그인을 연결한 후 bridge_status에서 현재 sessionId를 얻습니다. 페이지 프레임 안에 대표 화면·메뉴·기능별 상태가 중첩됩니다.

수집 JSON, 이미지, 개인 Figma 파일 링크, 연결 코드, 실행 journal은 저장소와 배포 패키지에 포함하지 않습니다. 로컬 사례 기록은 `.layer-bridge/cases/toss/`에 보관합니다. 자동 테스트에는 이 외부 사이트 대신 자체 제작한 HTML fixture를 사용합니다.
