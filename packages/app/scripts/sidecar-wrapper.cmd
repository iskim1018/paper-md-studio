@echo off
REM Tauri sidecar wrapper (Windows): Node.js CLI를 실행합니다.
REM
REM 이 파일은 packages/app/src-tauri/binaries/paper-md-studio-cli-<target>.exe
REM 자리에 복사되어 Tauri의 externalBin으로 사용됩니다. binaries/ 디렉토리는
REM gitignore 대상이므로 이 파일이 캐노니컬 소스입니다.
REM
REM 복사 방법:
REM   pnpm --filter @paper-md-studio/app sidecar:install
REM
REM 개발 모드 (번들 JRE 없음):
REM   시스템 PATH의 node, java를 사용한다. JAVA_HOME 또는
REM   번들 설치 경로(resources\jre)를 PAPER_MD_STUDIO_HWP_JAR
REM   + java.exe로 명시 override 가능.

setlocal

REM 번들 JRE/jar 탐색 (Tauri resources 경로 우선)
if exist "%~dp0..\resources\jre\bin\java.exe" (
  set "JAVA_HOME=%~dp0..\resources\jre"
  set "PATH=%~dp0..\resources\jre\bin;%PATH%"
)
if exist "%~dp0..\resources\hwp-to-hwpx.jar" (
  if "%PAPER_MD_STUDIO_HWP_JAR%"=="" (
    set "PAPER_MD_STUDIO_HWP_JAR=%~dp0..\resources\hwp-to-hwpx.jar"
  )
)

REM 개발 모드: 저장소 루트를 찾아 CLI 진입점 실행
REM 배포 모드: git 없으므로 sidecar 옆의 node_cli 디렉토리 탐색 (Phase 7-E에서 결정)
for /f "delims=" %%i in ('git -C "%~dp0" rev-parse --show-toplevel 2^>nul') do set "MONO_ROOT=%%i"

if "%MONO_ROOT%"=="" (
  echo 모노레포 루트를 찾을 수 없습니다. 배포 빌드에는 별도 번들링이 필요합니다. 1>&2
  exit /b 1
)

set "CLI_PATH=%MONO_ROOT%\packages\cli\dist\index.js"

node "%CLI_PATH%" %*
endlocal
