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

# 번들 JRE/jar 탐색 (Tauri resources 경로 우선) — 배포 빌드에서 사용
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLED_JRE="$SCRIPT_DIR/../resources/jre"
BUNDLED_JAR="$SCRIPT_DIR/../resources/hwp-to-hwpx.jar"
if [ -x "$BUNDLED_JRE/bin/java" ]; then
  export JAVA_HOME="$BUNDLED_JRE"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if [ -f "$BUNDLED_JAR" ] && [ -z "$PAPER_MD_STUDIO_HWP_JAR" ]; then
  export PAPER_MD_STUDIO_HWP_JAR="$BUNDLED_JAR"
fi

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
  echo "모노레포 루트를 찾을 수 없습니다." >&2
  exit 1
fi

CLI_PATH="$MONO_ROOT/packages/cli/dist/index.js"

exec node "$CLI_PATH" "$@"
