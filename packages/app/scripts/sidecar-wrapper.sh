#!/bin/sh
# Tauri sidecar wrapper: Node.js CLI를 실행합니다.
#
# 이 파일은 packages/app/src-tauri/binaries/paper-md-studio-cli-<target>로
# 복사되어 Tauri의 externalBin으로 사용됩니다. binaries/ 디렉토리는
# gitignore 대상이므로 이 파일이 캐노니컬 소스입니다.
#
# 복사 방법:
#   pnpm --filter @paper-md-studio/app sidecar:install
# 또는 직접:
#   cp packages/app/scripts/sidecar-wrapper.sh \
#     packages/app/src-tauri/binaries/paper-md-studio-cli-aarch64-apple-darwin
#   chmod +x packages/app/src-tauri/binaries/paper-md-studio-cli-*

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Tauri .app 번들: Contents/MacOS/<sidecar>, 리소스는 Contents/Resources/resources/
# 개발 모드 dev sidecar 설치 경로: packages/app/src-tauri/binaries/ 기준은 ../resources
if [ -d "$SCRIPT_DIR/../Resources/resources" ]; then
  RESOURCES_DIR="$SCRIPT_DIR/../Resources/resources"
else
  RESOURCES_DIR="$SCRIPT_DIR/../resources"
fi

# === 배포 모드: 번들된 node + CLI로 바로 실행 ===
BUNDLED_NODE="$RESOURCES_DIR/node/bin/node"
BUNDLED_CLI="$RESOURCES_DIR/cli/index.js"
if [ -x "$BUNDLED_NODE" ] && [ -f "$BUNDLED_CLI" ]; then
  exec "$BUNDLED_NODE" "$BUNDLED_CLI" "$@"
fi

# === 개발 모드: 시스템 node + 모노레포 CLI 사용 ===
# Tauri GUI에서 실행 시 PATH에 node가 없을 수 있으므로 보강
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/default/bin:$PATH"

# nvm 환경 로드 (있는 경우)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

# git 루트를 기준으로 CLI 경로를 결정 (상대경로 문제 회피)
MONO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$MONO_ROOT" ]; then
  echo "모노레포 루트를 찾을 수 없습니다 (개발 모드에서만 동작)." >&2
  exit 1
fi

CLI_PATH="$MONO_ROOT/packages/cli/dist/index.js"

exec node "$CLI_PATH" "$@"
