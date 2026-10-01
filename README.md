# figmaize

Turn a website into editable Figma layers, components, and nested interaction states. **Figma plugin + local collector + optional MCP.** No AI subscription is required for capture or import.

웹사이트 URL을 Figma 플러그인에 입력하면 텍스트·버튼·레이아웃을 직접 편집할 수 있는 형태로 가져옵니다. 사이트별 컬렉션에서 페이지와 메뉴·팝업 상태를 관리합니다.

**0.3.0-alpha.1** · MIT · [GitHub](https://github.com/parktaesu123/figmaize). 현재 소스 설치와 개발용 Figma 플러그인을 지원합니다. npm registry와 Figma Community에는 아직 게시하지 않았습니다.

## Install / 설치

Node.js **22 이상**과 Figma Desktop이 필요합니다. 로컬 수집기는 macOS/Windows/Linux에서 실행할 수 있으며 Figma 개발 플러그인은 Figma Desktop에서 등록합니다.

```sh
git clone https://github.com/parktaesu123/figmaize.git
cd figmaize
npm ci
npm run build
node bin/figmaize.mjs setup --install-browser
```

`setup`은 Chromium을 명시적으로 설치하고 로컬 서버를 시작합니다. 출력된 **Figma development manifest** 경로를 Figma → Plugins → Development → Import plugin from manifest에서 선택합니다. 플러그인을 실행하고 출력된 **Local connection code**를 입력해 연결하세요. 코드와 사용자 데이터 경로는 공개하지 마세요.

Figma가 등록된 plugin ID를 요구하면 Development → New plugin에서 발급한 숫자 ID로 `node bin/figmaize.mjs setup --figma-id ID`를 실행합니다. 이 명령은 Community에 게시하지 않습니다.

```sh
node bin/figmaize.mjs doctor       # Node / Chromium / 서버 / 연결 진단
node bin/figmaize.mjs start        # 컴퓨터 재시작 후 로컬 서버 실행
```

[GitHub Releases](https://github.com/parktaesu123/figmaize/releases)에 첨부된 `.tgz` 파일이 있다면 `npm install -g ./figmaize-0.3.0-alpha.1.tgz` 후 `figmaize setup --install-browser`로 설치할 수도 있습니다. registry의 동명 패키지 설치를 뜻하지 않습니다.

## Use / 사용

1. Figma 플러그인에서 URL을 입력합니다.
2. 현재 페이지 / 선택한 페이지 / 사이트 범위를 정합니다. **페이지 찾기**는 시작 페이지에서 발견한 링크를 보여줍니다.
3. 화면 크기, 스크롤·메뉴·팝업 포함 여부, 페이지·화면 한도를 정하고 수집합니다.
4. 컬렉션을 선택하고 **피그마로 가져오기**를 누릅니다. 기본은 사이트별 새 Figma 페이지입니다. 파일의 페이지 한도가 있으면 새 페이지 옵션을 끄고 현재 페이지를 사용하세요.
5. Figma에서 텍스트, 버튼의 Label/Value 속성, Auto Layout 간격 등을 편집합니다.

수집은 기본 5페이지·40화면 한도로 제한합니다. 현재 페이지 모드는 1페이지입니다. 한도에 도달하면 한도를 늘리고 **수집 이어받기**를 누릅니다. 가져오기가 취소된 경우 **피그마로 가져오기**로 이어받습니다. 플러그인 창은 가져오기가 끝날 때까지 열어 두세요.

```text
Site / example.com                 Figma 페이지
  Page / products                  원본 페이지별 부모 프레임
    Default                        대표 화면
    Menus                          공통 메뉴 상태
    Details                        변경 영역별 중첩 상태
  Page / pricing
  Components / example.com         선택적 Variant 라이브러리
```

전체 화면을 버튼 상태마다 나열하지 않고 기능별 변경 영역을 중첩합니다. 기존 결과 재정리는 레이어 ID와 편집 내용을 유지하며 최상위 프레임 수를 줄입니다. 내부 레이어까지 모두 삭제하는 방식은 아닙니다.

선택 기능:

- **공유 컴포넌트**: 같은 컬렉션에서 구조·문구·스타일·크기가 일치하는 반복 요소를 Instance로 재사용합니다.
- **Variant**: 동일 URL·DOM 선택자로 대응되는 요소의 다른 상태를 ComponentSet으로 구성합니다. 페이지 전체를 Variant로 변환하지 않습니다.
- **프로토타입**: 기준 화면의 요소를 하나로 식별할 수 있는 클릭·호버 상태만 연결합니다. 기존 반응은 덮어쓰지 않습니다.

이 기능들은 보수적으로 적용됩니다. 독립 컴포넌트가 기본이며, 확실하지 않은 대응은 그대로 둡니다. 변경한 main component의 편집 내용은 재수집으로 덮어쓰지 않습니다.

## MCP (optional)

`setup`이 출력한 `mcp-config.json`의 설정을 사용하는 클라이언트에 복사합니다. 설치 위치와 Node 실행 경로가 포함되어 있습니다. MCP 서버는 `node bin/figmaize.mjs mcp`로 실행하며 stdout에는 JSON-RPC만 출력합니다.

| 목적 | 도구 |
| --- | --- |
| 연결과 문서 확인 | `bridge_status`, `figma_get_document`, `figma_get_selection` |
| 사이트 찾기·수집·관리 | `site_discover`, `site_capture_start`, `site_collections`, `site_capture_status`, `site_cancel`, `site_resume` |
| 편집 가능한 캔버스 생성 | `figma_capture_url`, `figma_import_capture`, `figma_import_site`, `figma_compact_site` |
| 검증과 편집 | `figma_inspect_node`, `figma_update_node`, `figma_export_png`, `figma_get_job` |

플러그인 UI와 MCP는 같은 수집·가져오기 서비스를 사용합니다. 결과가 `unknown`이면 캔버스를 확인하세요. 불명확한 변형 명령을 자동 재전송하지 않습니다.

CLI로도 수집할 수 있습니다. 같은 출력 폴더와 수집 옵션으로 다시 실행하면 완료된 캡처를 재사용합니다.

```sh
node bin/figmaize.mjs capture https://example.com --out ./my-capture --mode page --max-screens 20
node bin/figmaize.mjs import ./my-capture/manifest.json SESSION_ID
```

## Browser extension

로그인된 현재 화면을 사용자가 직접 가져올 때는 `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `extension/`을 선택합니다. 확장에서 로컬 연결 코드를 입력하고 목적지 문서를 선택합니다. URL 수집기는 사용자 브라우저의 프로필·쿠키를 읽지 않는 격리된 Chromium을 사용합니다.

## What stays editable / 지원 범위

텍스트·프레임·SVG·버튼·링크·입력창을 네이티브 레이어로 만듭니다. 측정된 배치와 일치하는 flex는 Auto Layout으로 만들고, 복잡한 배치는 좌표를 유지합니다. 중첩된 외곽 카드는 Frame으로 남겨 내부 Component가 정상적으로 편집되게 합니다.

이미지·영상·iframe 등은 필요한 영역을 이미지로 보존합니다. 영상은 정지 프레임이며 영상 위의 문구는 별도 텍스트입니다. 폰트가 없으면 대체 경고를 표시합니다. 웹 텍스트는 보이는 줄별로 생성될 수 있습니다.

모든 CSS, 동적 앱의 모든 상태, 모든 사이트의 1:1 복원을 보장하지 않습니다. 복잡한 transform·필터·배경 이미지·가상 요소·stacking context에는 차이가 생길 수 있습니다. 전체 앱 로직, 로그인 자동화, 폼 제출, 스크린샷 OCR, 디자인 변수 추론은 지원하지 않습니다. 사이트가 수집을 차단하거나 일부 상태가 실패하면 manifest와 `coverage.md`에 남습니다.

## Data and safety

서버는 loopback에서 연결 코드로 인증하고 외부 웹사이트 Origin을 거부합니다. 사용자 데이터는 기본적으로 macOS `~/Library/Application Support/figmaize`, Windows `%LOCALAPPDATA%/figmaize`, Linux `$XDG_DATA_HOME/figmaize` 또는 `~/.local/share/figmaize`에 저장합니다. `FIGMAIZE_DATA_DIR`로 변경할 수 있습니다. 기존 `.layer-bridge/`가 있는 체크아웃은 그 폴더를 유지합니다.

캡처·manifest·가져오기 journal은 디스크에 남고, 서버 세션·작업 큐는 재시작 시 사라집니다. 취소는 체크포인트에서 멈춥니다. 이미 Figma에 제출한 작업은 결과를 확인한 후 멈추므로 즉시 중단되지 않을 수 있습니다. 결과가 불확실하면 재전송을 차단합니다. 웹사이트의 클릭은 새 브라우저에서 수행하며 폼 제출과 상호작용 중 변경 HTTP 요청을 차단하지만 임의 웹사이트의 모든 동작을 판별할 수는 없습니다.

## Development and release

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run release:plugin
npm pack
```

`figma/code.js`와 `figma/ui.html`은 생성물입니다. `figma/importer.js`, `components.js`, `bridge-ui.js`, `site-ui.js`, `ui.template.html`을 수정하고 다시 빌드하세요. [기여 안내](CONTRIBUTING.md), [구현·배포 상태](docs/open-source-plan.md), [변경 이력](CHANGELOG.md)을 참고하세요.

코드는 [MIT](LICENSE)입니다. 수집한 웹사이트의 콘텐츠·이미지 라이선스는 포함하지 않습니다. 토스 사례는 [별도 예제](examples/toss/README.md)로 분리했으며 실제 수집물과 개인 Figma 링크는 배포에 포함하지 않습니다. 기존 `layer-bridge` 형식과 `LAYER_BRIDGE_*` 설정은 호환성을 위해 유지합니다.
