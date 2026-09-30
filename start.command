#!/bin/zsh
set -e
cd "${0:A:h}"
runtime_node="$(command -v node || true)"
if [[ -z "$runtime_node" ]]; then
  runtime_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$runtime_node" ]]; then
  echo "Node.js 18 이상을 설치한 뒤 다시 실행해 주세요."
  read -r
  exit 1
fi
"$runtime_node" scripts/build.mjs
"$runtime_node" scripts/connection.mjs
echo "로컬 브리지가 백그라운드에서 실행 중입니다. 피그마 플러그인을 연결하세요."
read -r "?종료하려면 Enter를 누르세요. (브리지는 계속 실행됩니다)"
