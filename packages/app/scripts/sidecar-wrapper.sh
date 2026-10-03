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

# === 0.6.x 이하가 앱 데이터에 풀어 둔 JRE 정리 — 0.8.0 이후 제거 ===
# 0.6.x 까지 이 래퍼는 번들 jre.tar.gz 를 아래 폴더의 jre/ 에 풀고 jre.stamp 를
# 남겼다. 0.7.0 에서 Java 경로가 사라져 아무도 읽지 않지만, 업데이터는 .app 만
# 바꾸므로 약 45MB 가 그대로 남는다. 같은 폴더에 다른 앱 데이터가 있어 jre/ 와
# jre.stamp 두 항목만, 그것도 실제 디렉토리·파일일 때만 지운다 (심볼릭 링크는
# 0.6.x 가 만든 것이 아니다). 변환을 막지 않게 백그라운드로 돌리되 출력을
# 끊어 Tauri 가 sidecar 출력이 닫히기를 기다리지 않게 하고, 실패는 무시한다 —
# 지우다 만 것은 다음 실행에서 이어서 지운다. Windows 는 shim 의 legacy_jre.rs.
cleanup_legacy_jre() {
  # HOME 이 비었거나 상대경로면 엉뚱한 곳을 가리킬 수 있으므로 건너뛴다
  case "$HOME" in
    /*) ;;
    *) return 0 ;;
  esac
  LEGACY_DATA_DIR="$HOME/Library/Application Support/com.paper-md-studio.app"
  if [ -d "$LEGACY_DATA_DIR/jre" ] && [ ! -L "$LEGACY_DATA_DIR/jre" ]; then
    rm -rf "$LEGACY_DATA_DIR/jre" >/dev/null 2>&1 &
  fi
  if [ -f "$LEGACY_DATA_DIR/jre.stamp" ] && [ ! -L "$LEGACY_DATA_DIR/jre.stamp" ]; then
    rm -f "$LEGACY_DATA_DIR/jre.stamp" >/dev/null 2>&1 &
  fi
}

# === 배포 모드: 번들된 node + CLI로 바로 실행 ===
BUNDLED_NODE="$RESOURCES_DIR/node/bin/node"
BUNDLED_CLI="$RESOURCES_DIR/cli/index.js"
if [ -x "$BUNDLED_NODE" ] && [ -f "$BUNDLED_CLI" ]; then
  # 설치본에서만 돈다 — 개발 실행이 같은 PC 의 설치 데이터를 건드리지 않게
  cleanup_legacy_jre
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
