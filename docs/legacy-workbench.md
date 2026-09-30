# figmaize

실제 웹 화면을 수집하고, 로컬 작업실에서 수정한 뒤 피그마의 **텍스트·프레임·이미지·벡터 레이어**로 가져오는 첫 버전입니다.

## 바로 실행

Mac에서는 `start.command`를 더블 클릭하세요. 로컬 작업실이 `http://127.0.0.1:4317`에서 실행됩니다. 터미널 창을 닫으면 서버가 종료됩니다.

Node.js 18 이상이 PATH에 있거나 Codex의 번들 Node 런타임이 설치되어 있으면 실행할 수 있습니다. 일반 개발 환경에서는:

```sh
npm run build
npm start
```

런타임 외 외부 패키지는 필요하지 않습니다. 샘플 화면과 빌드된 플러그인도 저장소에 포함했습니다.

## 1. Chrome 확장 설치 및 수집

1. Chrome 주소창에 `chrome://extensions` 입력.
2. 개발자 모드 활성화 → **압축해제된 확장 프로그램을 로드합니다**.
3. 이 프로젝트의 `extension` 폴더 선택.
4. 수집하려는 서비스의 화면을 열고 원하는 모달·탭·메뉴 상태로 준비.
5. figmaize 확장을 열어 화면 이름 입력 → **현재 화면 수집하기**.
6. 완료 후 **.layerbridge.json 저장** 클릭.

현재 보이는 화면만 수집합니다. 수집 중 팝업을 닫거나 탭을 바꾸지 마세요. 로컬 HTML 파일은 확장 세부 설정의 ‘파일 URL에 대한 액세스 허용’이 필요합니다. Chrome 내부 페이지·웹스토어 등 보호된 페이지에서는 사용할 수 없습니다.

`http://127.0.0.1:4317/examples/demo.html`에서 목록 화면과 모달 수집을 연습할 수 있습니다. 실제 사이트 데이터가 아닌 자체 제작 샘플입니다.

## 2. 작업실에서 확인·편집

- JSON 파일 불러오기, 레이어 목록 검색, 캔버스에서 요소 선택.
- 이름, 텍스트, 좌표, 크기, 글자 크기·굵기, 색상, 모서리 수정.
- 부모 프레임을 이동하면 자식 레이어도 같은 거리만큼 이동.
- 원본 스크린샷을 반투명하게 겹쳐 비교.
- 텍스트·도형 도구로 영역을 드래그하여 레이어 추가.
- 이미지 분리 도구로 스크린샷의 일부를 잘라 이미지 레이어로 추가.
- 수정 후 **피그마용 파일 저장**. 작업은 메모리에 있으므로 새로고침·닫기 전에 저장하세요.

**앱 스크린샷:** PNG/JPG/WebP를 올리면 원본 비교 이미지로 열립니다. 텍스트·도형을 직접 추가하고 사진·아이콘 영역을 잘라냅니다. 자동 OCR이나 앱 전체 디자인 자동 복원은 구현하지 않았습니다. 스크린샷 해상도 기준 좌표를 사용하므로 3배 해상도 캡처는 3배 크기로 열립니다.

## 3. 피그마에 실제 레이어 생성

1. Figma **데스크톱**에서 편집 가능한 디자인 파일을 엽니다.
2. **Plugins → Development → Import plugin from manifest…** 선택.
3. 이 프로젝트의 `figma/manifest.json` 선택.
4. **Plugins → Development → figmaize** 실행.
5. 저장한 JSON 선택 → **피그마 레이어 만들기**.

처음에는 `examples/demo.layerbridge.json`으로 시험할 수 있습니다. 결과는 현재 페이지의 새로운 상위 프레임으로 추가됩니다.

```text
figmaize / 화면 이름
├── 00 · 원본 화면 (잠금)
└── 01 · 편집 가능한 재현
    ├── 프레임
    ├── 편집 가능한 텍스트
    ├── 이미지 채우기를 가진 프레임
    └── SVG 벡터
```

기존 화면을 덮어쓰지 않습니다. 가져오는 도중 실패하면 해당 실행에서 만든 노드를 제거합니다. 원본 폰트가 없으면 Inter 등 사용 가능한 폰트로 대체하고 결과에 표시합니다. 경고와 출처는 생성 프레임의 플러그인 데이터에도 기록합니다.

`layer-bridge-local`은 로컬 개발용 식별자입니다. Community에 게시하려면 Figma에서 발급받은 플러그인 ID로 바꿔야 합니다. 사용 환경에서 ID 등록을 요구하면 Figma의 **Create new plugin**으로 발급받은 `id`를 manifest에 넣고 다시 가져오세요.

## 지원 범위와 한계

| 항목 | 현재 동작 |
| --- | --- |
| 웹 텍스트 | 실제 문자열·좌표·글꼴 정보 수집, 줄별 텍스트 레이어 |
| DOM 구조 | 부모·자식 관계를 중첩 프레임으로 유지 |
| 스타일 | 기본 배경색·모서리·단일 테두리·단순 그림자·불투명도 |
| 이미지 | 읽을 수 있으면 PNG로 포함, 그 외 화면에 완전히 보이는 영역은 캡처에서 추출 |
| 인라인 SVG | 자체 완결적인 SVG를 벡터로 생성; 외부 참조는 이미지로 대체 |
| iframe·canvas·video | 내부 구조 대신 현재 보이는 영역을 이미지로 유지 |
| 네이티브 앱 | 스크린샷 기반 수동 텍스트·도형·이미지 분리 |
| 오토 레이아웃·컴포넌트·디자인 변수 | 자동 생성하지 않음. 피그마에서 별도 정리 |
| 화면 전체 스크롤 수집 | 미지원. 각 화면 상태를 별도로 수집 |

CSS 그라디언트·배경 이미지·가상 요소·복잡한 transform·필터·clip-path·혼합 모드·복잡한 stacking context는 정확하게 복원하지 못합니다. 비대칭 테두리는 위쪽 기준으로 근사합니다. 폰트 렌더링 차이로 글자 폭·기준선이 달라질 수 있습니다. 원본과 비교해 보정하세요.

원본 이미지를 캡처에서 잘라내는 대체 방식에는 겹쳐진 콘텐츠가 포함될 수 있습니다. 화면 밖까지 걸친 읽기 불가능한 이미지는 누락을 표시합니다. 원본 소스에 대한 접근 권한을 우회하거나 숨겨진 화면을 수집하지 않습니다.

## 데이터 처리

- 확장 권한은 `activeTab`, `scripting`만 사용합니다. 사용자가 실행한 탭의 현재 화면을 읽습니다.
- 자체 서버·분석 서비스·AI API로 수집 데이터를 보내지 않습니다.
- JSON에 화면 텍스트, 이미지, 스크린샷, URL의 origin/path가 포함됩니다. URL query/hash는 저장하지 않습니다.
- 피그마 플러그인의 네트워크 접근은 차단되어 있습니다. **피그마 캔버스에 생성한 콘텐츠는 피그마 파일의 저장·동기화 정책을 따릅니다.**
- 로컬 서버는 `127.0.0.1`에만 바인딩하고 작업실·공통 코드·샘플 경로만 제공합니다.
- 자동 수집 2,500개 레이어, 가져오기 5,000개 레이어, 파일 50MB 한도를 둡니다.

## 프로젝트 구조

```text
extension/            Chrome Manifest V3 확장 / DOM 수집기
shared/schema.js      공통 데이터 검증 / 색상 변환
workbench/            로컬 레이어 편집·원본 비교 작업실
figma/importer.js     피그마 노드 생성 원본
figma/ui.template.html 플러그인 UI 원본
figma/code.js          빌드된 플러그인 런타임
figma/ui.html          빌드된 플러그인 UI
examples/             자체 제작 데모 / 샘플 수집 데이터
scripts/              빌드 / 로컬 서버 / 브라우저 테스트
tests/                데이터 검증 / 피그마 API 모형 테스트
```

플러그인 원본 수정 후 `npm run build`를 실행하세요. 브라우저 확장은 Chrome 확장 목록에서 새로고침해야 수정이 적용됩니다.

## 검증

```sh
npm test
# 서버를 켜둔 뒤, Playwright와 Chromium이 있는 환경에서:
node scripts/browser-smoke.mjs
```

브라우저 테스트는 로컬 `playwright`, 또는 Codex 번들 런타임의 Playwright를 사용합니다. 다른 설치 경로는 `LB_NODE_MODULES`, 브라우저 경로는 `CHROME_PATH`로 지정할 수 있습니다. 브라우저 테스트는 샘플 JSON을 재생성하며 `artifacts/workbench.png`를 저장합니다.

검증 범위: 스키마 오류·SVG 검사, 상대 좌표·편집 가능한 텍스트 생성·폰트 대체·실패 시 정리의 API 모형 테스트, 실제 Chromium에서 DOM 수집·작업실 수정·내보내기·스크린샷 영역 분리·좁은 화면 레이아웃.

**Figma 앱에서의 실제 실행과 사용자 Chrome 프로필에 확장 설치는 아직 검증되지 않았습니다.** 개발 환경의 컴퓨터 제어 권한이 없어 자동 설치·실행 단계까지 진행하지 못했습니다.

## 구현 참고

- [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Figma Plugin manifest](https://developers.figma.com/docs/plugins/manifest/)
- [Figma text nodes](https://developers.figma.com/docs/plugins/api/properties/figma-createtext/)
- [Figma font loading](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/)
