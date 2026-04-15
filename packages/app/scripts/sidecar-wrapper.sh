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

# 번들 JRE/jar 탐색 (Tauri resources 경로 우선) — 배포 빌드에서 사용
#
# JRE는 tar.gz로 번들되어 있어 첫 실행 시 앱 데이터 디렉토리에 추출한다.
# (Tauri resource walker가 jlink 결과의 legal/* 심볼릭링크를 처리하지 못해
# 디렉토리째 번들하지 못하기 때문)
BUNDLED_JRE_ARCHIVE="$RESOURCES_DIR/jre.tar.gz"
BUNDLED_JAR="$RESOURCES_DIR/hwp-to-hwpx.jar"

if [ -f "$BUNDLED_JRE_ARCHIVE" ]; then
  APP_DATA_DIR="$HOME/Library/Application Support/com.paper-md-studio.app"
  EXTRACTED_JRE="$APP_DATA_DIR/jre"
  STAMP_FILE="$APP_DATA_DIR/jre.stamp"
  # 아카이브 크기를 sentinel로 사용해 업그레이드 시 재추출 감지
  ARCHIVE_SIZE=$(stat -f%z "$BUNDLED_JRE_ARCHIVE" 2>/dev/null || echo "0")
  STORED_SIZE=""
  if [ -f "$STAMP_FILE" ]; then
    STORED_SIZE=$(cat "$STAMP_FILE" 2>/dev/null)
  fi
  if [ ! -x "$EXTRACTED_JRE/bin/java" ] || [ "$ARCHIVE_SIZE" != "$STORED_SIZE" ]; then
    echo "번들 JRE 추출 중... ($APP_DATA_DIR)" >&2
    mkdir -p "$APP_DATA_DIR"
    rm -rf "$EXTRACTED_JRE"
    tar -xzf "$BUNDLED_JRE_ARCHIVE" -C "$APP_DATA_DIR" || {
      echo "JRE 추출 실패" >&2
      exit 1
    }
    echo "$ARCHIVE_SIZE" > "$STAMP_FILE"
  fi
  if [ -x "$EXTRACTED_JRE/bin/java" ]; then
    export JAVA_HOME="$EXTRACTED_JRE"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
fi
if [ -f "$BUNDLED_JAR" ] && [ -z "$PAPER_MD_STUDIO_HWP_JAR" ]; then
  export PAPER_MD_STUDIO_HWP_JAR="$BUNDLED_JAR"
fi

# === 배포 모드: 번들된 node + CLI로 바로 실행 ===
BUNDLED_NODE="$RESOURCES_DIR/node/bin/node"
BUNDLED_CLI="$RESOURCES_DIR/cli/index.js"
if [ -x "$BUNDLED_NODE" ] && [ -f "$BUNDLED_CLI" ]; then
  exec "$BUNDLED_NODE" "$BUNDLED_CLI" "$@"
fi

# === 개발 모드: 시스템 node + 모노레포 CLI 사용 ===
# Tauri GUI에서 실행 시 PATH에 node/java가 없을 수 있으므로 보강
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/default/bin:$PATH"

# nvm 환경 로드 (있는 경우)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

# sdkman 환경 로드 (.hwp 변환에 필요한 Java 런타임용)
if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
  . "$HOME/.sdkman/bin/sdkman-init.sh"
fi

# JAVA_HOME이 설정되지 않았다면 일반적인 후보 경로를 탐색
if [ -z "$JAVA_HOME" ]; then
  for candidate in \
    "$HOME/.sdkman/candidates/java/current" \
    "/Library/Java/JavaVirtualMachines/Contents/Home" \
    "$(/usr/libexec/java_home 2>/dev/null)"; do
    if [ -n "$candidate" ] && [ -x "$candidate/bin/java" ]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi

# git 루트를 기준으로 CLI 경로를 결정 (상대경로 문제 회피)
MONO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$MONO_ROOT" ]; then
  echo "모노레포 루트를 찾을 수 없습니다 (개발 모드에서만 동작)." >&2
  exit 1
fi

CLI_PATH="$MONO_ROOT/packages/cli/dist/index.js"

exec node "$CLI_PATH" "$@"
