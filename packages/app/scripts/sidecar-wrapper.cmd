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

set "RESOURCES_DIR=%~dp0..\resources"

REM 번들 JRE/jar 탐색 (Tauri resources 경로 우선)
REM JRE는 tar.gz로 번들되어 첫 실행 시 %LOCALAPPDATA%로 추출한다.
REM (Windows 10 1803+ 기본 tar.exe = bsdtar 사용)
set "BUNDLED_JRE_ARCHIVE=%RESOURCES_DIR%\jre.tar.gz"
if exist "%BUNDLED_JRE_ARCHIVE%" (
  set "APP_DATA_DIR=%LOCALAPPDATA%\com.paper-md-studio.app"
  set "EXTRACTED_JRE=%LOCALAPPDATA%\com.paper-md-studio.app\jre"
  set "STAMP_FILE=%LOCALAPPDATA%\com.paper-md-studio.app\jre.stamp"
  for %%A in ("%BUNDLED_JRE_ARCHIVE%") do set "ARCHIVE_SIZE=%%~zA"
  set "STORED_SIZE="
  if exist "%STAMP_FILE%" set /p STORED_SIZE=<"%STAMP_FILE%"
  if not exist "%EXTRACTED_JRE%\bin\java.exe" goto :extract_jre
  if not "%ARCHIVE_SIZE%"=="%STORED_SIZE%" goto :extract_jre
  goto :jre_ready
:extract_jre
  echo 번들 JRE 추출 중... 1>&2
  if not exist "%APP_DATA_DIR%" mkdir "%APP_DATA_DIR%"
  if exist "%EXTRACTED_JRE%" rmdir /s /q "%EXTRACTED_JRE%"
  tar -xzf "%BUNDLED_JRE_ARCHIVE%" -C "%APP_DATA_DIR%"
  if errorlevel 1 (
    echo JRE 추출 실패 1>&2
    exit /b 1
  )
  >"%STAMP_FILE%" echo %ARCHIVE_SIZE%
:jre_ready
  if exist "%EXTRACTED_JRE%\bin\java.exe" (
    set "JAVA_HOME=%EXTRACTED_JRE%"
    set "PATH=%EXTRACTED_JRE%\bin;%PATH%"
  )
)
if exist "%RESOURCES_DIR%\hwp-to-hwpx.jar" (
  if "%PAPER_MD_STUDIO_HWP_JAR%"=="" (
    set "PAPER_MD_STUDIO_HWP_JAR=%RESOURCES_DIR%\hwp-to-hwpx.jar"
  )
)

REM === 배포 모드: 번들된 node + CLI로 바로 실행 ===
if exist "%RESOURCES_DIR%\node\node.exe" (
  if exist "%RESOURCES_DIR%\cli\index.js" (
    "%RESOURCES_DIR%\node\node.exe" "%RESOURCES_DIR%\cli\index.js" %*
    exit /b %ERRORLEVEL%
  )
)

REM === 개발 모드: 시스템 node + 모노레포 CLI 사용 ===
for /f "delims=" %%i in ('git -C "%~dp0" rev-parse --show-toplevel 2^>nul') do set "MONO_ROOT=%%i"

if "%MONO_ROOT%"=="" (
  echo 모노레포 루트를 찾을 수 없습니다 ^(개발 모드에서만 동작^). 1>&2
  exit /b 1
)

set "CLI_PATH=%MONO_ROOT%\packages\cli\dist\index.js"

node "%CLI_PATH%" %*
endlocal
