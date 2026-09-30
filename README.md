# figmaize · Editable Web to Figma

개발 중인 MIT 라이선스 프로젝트입니다. GitHub 소스 버전이며 npm/Figma Community에는 아직 출시하지 않았습니다. [공개 제품 설계](docs/open-source-plan.md) · [개발 참여](CONTRIBUTING.md) · [토스 사례 재현 안내](examples/toss/README.md)

여러 웹사이트를 **사이트 → 페이지 → 대표 화면·메뉴·상태** 구조의 편집 가능한 Figma 레이어로 가져오는 것을 목표로 합니다. 현재 사용 경로는 MCP/CLI와 개발용 Figma 플러그인입니다. 플러그인에서 URL만 입력하는 흐름은 구현 예정입니다.

별도 사이트 없이 **대화 → MCP → 피그마 캔버스**로 연결하는 로컬 도구입니다. 피그마의 실제 프레임·텍스트·이미지·SVG를 만들고, 현재 선택을 읽고, 내용을 수정하고, 피그마에서 렌더한 PNG를 다시 확인합니다.

```text
Codex / MCP 클라이언트 ── stdio ── MCP 서버
                                      │
Chrome 확장 ───────────────────── 로컬 브리지 (127.0.0.1:4318)
                                      │
                              Figma 내부 플러그인
                                      │
                         실제 캔버스 레이어 · 선택 · 렌더
```

MCP 서버와 로컬 브리지는 다른 프로세스입니다. 여러 MCP 클라이언트가 같은 브리지를 공유하며, 연결한 파일·페이지를 `sessionId`로 구분합니다. 플러그인은 피그마 파일에서 실행한 상태로 유지해야 합니다.

## 첫 연결

### 1. 소스 받기와 로컬 연결

```sh
git clone https://github.com/parktaesu123/figmaize.git
cd figmaize
```

URL 수집에는 Playwright와 Chromium도 필요합니다. 소스 체크아웃 환경에서는 다음으로 준비할 수 있습니다.

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

현재 npm 배포 패키지나 독립 설치 CLI는 제공하지 않습니다. 아래 Node 스크립트로 실행합니다.

Mac에서 프로젝트의 `start.command`를 더블 클릭합니다. 브리지가 백그라운드에서 시작되고 로컬 연결 코드가 표시됩니다. 별도 웹페이지는 열리지 않습니다.

```sh
node scripts/build.mjs
node scripts/connection.mjs
```

`start.command`는 PATH의 Node 또는 Codex 번들 Node를 사용합니다. 일반 환경에서는 Node.js 18 이상이 필요합니다. 연결 코드는 `.layer-bridge/pairing-token`에 기기 로컬로 저장하며 Git에서 제외합니다. 코드 확인은 `node scripts/connection.mjs`를 다시 실행하면 됩니다.

### 2. 피그마 플러그인 등록

1. Figma **데스크톱**에서 원하는 디자인 파일·페이지를 엽니다.
2. **Plugins → Development → Import plugin from manifest…**를 선택합니다.
3. 프로젝트의 `figma/manifest.json`을 선택합니다.
4. **Plugins → Development → figmaize**를 실행합니다.
5. 로컬 연결 코드를 붙여 넣고 **MCP 브리지 연결**을 누릅니다.

‘MCP 연결됨’과 현재 파일·페이지 이름이 표시되면 준비 완료입니다. 페이지를 바꾼 뒤에는 연결 해제 후 다시 연결하세요. 이전 페이지를 대상으로 접수한 쓰기 작업은 다른 페이지로 전송하지 않고 거부합니다.

### 3. MCP 클라이언트 등록

Codex에서는 아래 형태로 등록합니다. Node와 프로젝트 경로는 **실제 절대 경로**를 사용합니다.

```sh
codex mcp add figmaize -- /absolute/path/to/node /absolute/path/to/project/server/mcp.mjs
codex mcp get figmaize
```

이 저장소의 `setup-mcp.command`는 현재 경로를 사용해 등록하고 연결 코드를 표시합니다. MCP 도구가 현재 대화에 표시되지 않으면 Codex를 다시 시작하여 설정을 불러오세요. 서버 등록과 피그마 플러그인 연결은 서로 다른 단계입니다.

다른 MCP 클라이언트에는 다음 stdio 설정을 등록할 수 있습니다.

```json
{
  "mcpServers": {
    "figmaize": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/project/server/mcp.mjs"]
    }
  }
}
```

## 실제 사용 흐름

- **공개 웹 화면:** “이 URL을 1440×900으로 캡처해서 연결된 피그마에 넣어줘.” → MCP가 격리된 브라우저로 수집하고 피그마에 생성합니다.
- **로그인된 서비스:** Chrome 확장에서 현재 보이는 화면을 피그마로 바로 보냅니다.
- **수정:** 피그마에서 텍스트를 선택하고 “선택한 문구를 …로 바꿔줘.” → 선택 조회 후 해당 실제 레이어를 수정합니다.
- **검수:** 생성된 프레임을 MCP로 조회하고 `figma_export_png`로 **피그마의 실제 렌더**를 확인합니다.

원본 스크린샷은 잠긴 레이어로, 편집 가능한 재현은 옆 프레임으로 생성합니다. 반복 수집한 화면은 기존 figmaize 캡처 오른쪽에 120px 간격으로 추가됩니다. 웹사이트와 자동 동기화되는 연결이 아니라 **수집 시점의 편집 가능한 복사본**입니다. 원본 사이트가 바뀌면 다시 수집하세요.

## MCP 도구

| 도구 | 동작 |
| --- | --- |
| `bridge_status` | 연결된 피그마 파일·페이지·sessionId 조회 |
| `figma_capture_url` | URL 화면 수집 후 피그마 레이어 생성 |
| `figma_import_capture` | 공통 캡처 데이터 또는 로컬 JSON 파일로 레이어 생성 |
| `figma_get_document` | 현재 파일·페이지·최상위 노드 조회 |
| `figma_get_selection` | 피그마에서 선택한 실제 노드 조회 |
| `figma_inspect_node` | 레이어 트리·좌표·색상·텍스트 조회 |
| `figma_update_node` | 이름·텍스트·위치·크기·글자 크기·채우기 수정 |
| `figma_export_png` | 피그마 렌더를 MCP 이미지로 반환 |
| `figma_get_job` | 접수한 작업의 실제 완료·실패 상태 확인 |

여러 피그마가 연결되면 `sessionId`를 명시해야 합니다. `nodeId`는 피그마 조회/생성 결과에 나온 실제 ID를 사용합니다. 좌표는 부모 프레임 기준입니다.

`queued`와 `running`은 완료가 아닙니다. 15초 안에 응답이 끝나지 않으면 job ID를 반환하므로 `figma_get_job`으로 확인합니다. 실행 중 결과가 끊기면 `unknown`으로 표시하고 변형 명령을 자동으로 반복하지 않습니다. 읽기 도구로 캔버스를 확인한 뒤 플러그인을 재연결하세요.

## Chrome에서 피그마로 바로 보내기

1. `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `extension` 폴더 선택.
2. 피그마 플러그인을 위의 방식으로 연결합니다.
3. 서비스 화면에서 Chrome 확장 실행 → 로컬 연결 코드 입력 → 연결된 피그마 찾기.
4. 생성할 파일·페이지 선택 → **현재 화면을 피그마로 보내기**.

수집 중에는 확장 창과 탭을 유지하세요. 서버 접수 후 팝업을 닫아도 피그마 작업은 유지됩니다. 확장이 실제 피그마의 완료 응답을 받은 경우에만 완료로 표시합니다. JSON 다운로드는 백업용 보조 기능입니다.

## 개발 및 검증

```sh
npm run build
npm test
# Playwright/Chromium이 있는 환경에서 실제 로컬 웹 수집 검증:
LB_TEST_BROWSER=1 node --test tests/capture-url.test.mjs
```

일반 실행은 외부 npm 패키지 없이 Node 내장 모듈로 동작합니다. **URL 수집에만 Playwright/Chromium이 필요**합니다. 로컬 패키지 또는 Codex 번들 런타임을 찾으며, 없으면 설치 방법을 안내합니다. 자동 설치하거나 사용자 브라우저 프로필·쿠키를 읽지 않습니다.

- `server/bridge.mjs`: 인증된 로컬 HTTP 브리지·세션·작업 큐
- `server/mcp.mjs`: 표준 stdio JSON-RPC MCP 도구
- `server/capture-url.mjs`: 격리된 웹 수집
- `figma/importer.js`: Figma Plugin API로 레이어 생성·조회·수정·렌더
- `figma/bridge-ui.js`: 피그마 내부 연결·작업·결과 전달 UI
- `extension/`: 현재 로그인된 브라우저 화면 수집·직접 전송
- `shared/schema.js`: 공통 캡처 검증

피그마 생성 코드와 UI를 수정하면 `npm run build` 후 플러그인을 다시 실행합니다. `figma/code.js`, `figma/ui.html`은 빌드 결과입니다.

실제 Figma 데스크톱에서 개발 플러그인 설치·MCP 연결·URL 수집·레이어 생성·텍스트 수정·PNG 렌더까지 확인했습니다. 공개 `example.com`은 9개, 로컬 MOA 예제 페이지는 90개 레이어로 생성했습니다. 개인 파일 링크와 렌더는 로컬 검증 기록으로 분리했습니다. 공개 재현에는 examples의 자체 제작 데모를 사용합니다.

자동 검증은 기본 suite 58개 통과와 별도 Chromium 수집 테스트 통과를 포함합니다. Chrome 확장의 로그인 화면 전송은 모형 테스트로 검증했으며 실제 로그인 서비스의 확장 UI 실행은 아직 검증하지 않았습니다.

## 범위와 제한

- 단일 URL 도구는 현재 화면을 수집합니다. 사이트 수집 도구는 내부 페이지·메뉴·팝업·스크롤을 탐색하고 실패/제한을 manifest에 기록합니다. 모든 조합의 상태를 보장하지 않습니다.
- 기본 DOM 구조·텍스트·색상·모서리·단순 테두리·그림자·이미지·SVG를 재구성합니다.
- CSS 그라디언트, 배경 이미지, 가상 요소, 복잡한 transform·필터·stacking context는 정확한 재현이 제한됩니다.
- 원본 폰트가 없으면 대체하고 경고를 남깁니다. 측정 좌표와 맞는 flex는 Auto Layout, 버튼·링크는 컴포넌트로 변환합니다. 디자인 변수와 공유 Instance/Variant 추론은 미포함입니다.
- 웹 텍스트는 실제 표시된 줄별로 생성합니다. 피그마의 폰트 치수 차이로 너비가 달라질 수 있으며, 긴 문단을 한 텍스트 박스로 자동 복원하지는 않습니다.
- URL 수집의 영상은 정지 이미지로 유지합니다. 영상 위의 문구는 별도 텍스트로 남기며, 화면 밖으로 확장된 영상도 보이는 영역을 가져옵니다. 피그마 안에서 영상 재생이나 영상 속 피사체의 벡터 편집은 지원하지 않습니다.
- 네이티브 앱 스크린샷 자동 OCR은 미포함입니다. 화면 분석으로 구성한 캡처 데이터를 `figma_import_capture`로 보낼 수 있습니다.
- 기존 웹 작업실은 `workbench/`에 보관했지만 기본 실행/작업 경로에서는 사용하지 않습니다. 이전 설명은 `docs/legacy-workbench.md`에 있습니다.
- `figma/manifest.json`의 `layer-bridge-local`은 개발용 식별자입니다. Figma에서 등록 ID를 요구하면 Create new plugin으로 발급한 ID로 바꾸세요. Community 배포는 별도입니다.

## 연결 및 데이터

브리지는 `127.0.0.1`에만 열립니다. 요청마다 로컬 연결 코드를 확인하며 임의 웹사이트 Origin은 거부합니다. 피그마 플러그인은 개발 모드에서 이 로컬 주소에만 연결합니다. 코드 실행 도구/eval은 제공하지 않고 명시된 작업만 처리합니다.

브리지는 캡처와 결과를 메모리에 보관하며 완료 기록은 약 30분 뒤 정리합니다. 피그마에 생성한 콘텐츠는 해당 피그마 파일의 저장·동기화 정책을 따릅니다. 연결 코드는 브라우저 확장·피그마 UI에서는 메모리에만 유지됩니다. 다른 사람이 코드에 접근하면 로컬 브리지에 접속할 수 있으므로 공유하지 마세요.

서버가 재시작되면 작업·세션은 사라지지만 피그마 레이어는 남습니다. 재연결 전 캔버스에서 기존 작업 결과를 확인하세요.

## 공식 참고

- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Codex MCP 연결](https://developers.openai.com/codex/mcp/)
- [Figma Plugin API](https://developers.figma.com/docs/plugins/)
- [Figma 공식 MCP Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)

공식 Figma MCP에도 캔버스 쓰기 기능이 있습니다. 이 프로젝트는 별도로 개발한 로컬 MCP·플러그인 경로이며, 공식 Figma 커넥터가 설치되었다고 가정하지 않습니다.

## 편집용 컴포넌트와 Auto Layout

새로 수집한 화면에서는 버튼·링크·입력창·카드를 구분해 `Button / …`, `Link / …`, `Input / …`, `Card / …` 이름의 실제 Figma Component로 만듭니다. 카드는 article 태그 또는 card 클래스 단서로 인식하며 모든 임의의 div를 카드라고 추측하지 않습니다. 내부 문구는 Label/Value 등 TEXT 속성에 연결되어 인스턴스로 재사용할 때도 편집할 수 있습니다. 현재는 각 요소가 독립 메인 컴포넌트이며 반복 요소의 공유 인스턴스/Variant를 자동 생성하지는 않습니다.

CSS flex의 가로·세로 방향, 간격, 패딩, 정렬을 Auto Layout으로 변환합니다. 원래 크기를 유지한 FIXED 크기로 시작하므로 오른쪽 Auto Layout 패널에서 간격·패딩·정렬·크기/Hug를 변경하세요. 줄바꿈 flex, grid, 복잡한 margin/겹침 등 측정 좌표와 일치하지 않는 배치는 원래 위치를 유지하고 경고를 반환합니다. 오래된 JSON에는 해당 메타데이터가 없으므로 새로 수집해야 합니다.


구현 참고: [Figma Component Properties](https://developers.figma.com/docs/plugins/working-with-component-properties/), [Figma Auto Layout API](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutmode/).

## 사이트 전체 수집 (개발 기능)

MCP `site_capture_start` → `site_capture_status` → `figma_import_site` 순서로 사용합니다. 새 MCP 도구는 서버를 재시작해야 나타납니다. 현재 연결은 기존 도구를 계속 사용할 수 있습니다.

```sh
node scripts/capture-site.mjs https://example.com --out .layer-bridge/sites/my-site --max-pages 160 --max-screens 1000
node scripts/import-site.mjs .layer-bridge/sites/my-site/manifest.json SESSION_ID
node scripts/site-report.mjs .layer-bridge/sites/my-site/manifest.json FIGMA_FILE_KEY
```

같은 출력 폴더로 재개하면 기존 캡처와 완료된 피그마 화면을 재사용합니다. 피그마 플러그인 창을 열어 두어야 하며, 제출 후 결과가 불명확한 작업은 자동 재전송하지 않습니다. 화면은 페이지별 부모 프레임 아래 대표 화면·공통 메뉴·기능별 상태로 중첩됩니다. 변경 영역은 기준 상태와 비교해 잘라 표시하고 클릭 경로와 스크롤 위치를 이름에 남깁니다. 중첩된 외곽 카드는 편집 가능한 프레임으로, 내부 버튼·링크는 독립 컴포넌트로 구성합니다. 수집 한도·클릭 실패·제외 페이지는 coverage.md에서 확인하세요.

### 기존 화면을 한 페이지 안에 정리

`figma_compact_site` 또는 `node scripts/compact-site.mjs MANIFEST SESSION_ID`로 기존 수집 결과를 묶습니다. 페이지 프레임 → 대표 화면/공통 메뉴/기능별 상태 순서입니다. 기존 레이어 ID와 편집 내용은 유지하며, 전체 화면 바깥 부분은 클리핑합니다. 기존 화면의 내부 레이어를 삭제하지 않으므로 **최상위 프레임 수**가 줄어드는 방식입니다. 새 사이트 가져오기는 변경 영역 밖의 불필요한 레이어를 제외합니다. 문맥이 크게 바뀌어 차이를 좁힐 수 없는 상태는 화면 영역을 유지합니다. 원본 좌표는 layerBridgeBeforeCompact에 보관합니다.

중단되어 완료 여부가 불명확한 프레임은 이동하지 않고 결과의 unresolved로 반환합니다. 이 프레임은 확인 전 다시 가져오지 않습니다.

## License and compatibility

코드는 [MIT License](LICENSE)로 제공합니다. 웹사이트에서 수집한 이미지·콘텐츠의 라이선스는 이 코드 라이선스에 포함되지 않습니다. 이전 결과와 호환되도록 `layer-bridge` 캡처 형식, `.layer-bridge/` 로컬 데이터 폴더, `LAYER_BRIDGE_*` 환경변수와 pluginData 키는 유지합니다. 기존 MCP 등록 이름도 그대로 사용할 수 있으며 새 설치의 권장 이름은 `figmaize`입니다.
