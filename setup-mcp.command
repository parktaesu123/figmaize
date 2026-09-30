#!/bin/zsh
set -e
cd "${0:A:h}"
runtime_node="$(command -v node || true)"
if [[ -z "$runtime_node" ]]; then
  runtime_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
codex_cli="$(command -v codex || true)"
if [[ -z "$codex_cli" ]]; then
  codex_cli="/Applications/ChatGPT.app/Contents/Resources/codex"
fi
if [[ ! -x "$runtime_node" || ! -x "$codex_cli" ]]; then
  echo "Node.js와 Codex CLI 설치를 확인해 주세요. README의 수동 MCP 등록 방법을 사용할 수 있습니다."
  read -r
  exit 1
fi
"$runtime_node" scripts/build.mjs
if "$codex_cli" mcp get figmaize >/dev/null 2>&1; then
  echo "figmaize가 이미 등록되어 있습니다. 기존 설정을 유지합니다."
elif "$codex_cli" mcp get layer-bridge >/dev/null 2>&1; then
  echo "layer-bridge가 이미 등록되어 있습니다. 기존 설정을 유지합니다."
else
  "$codex_cli" mcp add figmaize -- "$runtime_node" "$PWD/server/mcp.mjs"
fi
"$runtime_node" scripts/connection.mjs
echo "피그마에서 figma/manifest.json을 개발 플러그인으로 등록하고 연결 코드를 입력하세요."
echo "MCP 도구가 현재 대화에 보이지 않으면 Codex를 다시 시작하세요."
read -r "?종료하려면 Enter를 누르세요."
