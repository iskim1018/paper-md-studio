# 개발 가이드

Paper MD Studio 개발 환경 설정 및 빌드 안내.

## 필수 요구사항

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | 22.13+ | 변환 엔진 및 프론트엔드 빌드 (`engines` 바닥 — pdfjs-dist 6 요구) |
| pnpm | 10+ | 패키지 매니저 |
| Rust | stable | Tauri 백엔드, Windows 사이드카 셰임 |

`.hwp` 변환은 core 에 들어 있는 rhwp(`@rhwp/core`, Rust→WASM)가 맡으므로 JDK·Maven 은
더 이상 필요 없습니다 (2026-10-03 Java 경로 제거).

macOS: Xcode Command Line Tools 필요 (`xcode-select --install`)

## 시작하기

```bash
# 저장소 클론
git clone <repository-url>
cd paper-md-studio

# 의존성 설치
pnpm install

# core/cli/app 빌드
pnpm build
```

## 개발 모드 실행

### CLI

```bash
# CLI 직접 실행
node packages/cli/dist/index.js document.hwpx

# 또는 pnpm으로
pnpm --filter @paper-md-studio/cli dev
```

### GUI (Tauri 앱)

```bash
# sidecar 래퍼 설치 (최초 1회)
pnpm --filter @paper-md-studio/app sidecar:install

# 개발 서버 + Tauri 윈도우 실행
pnpm --filter @paper-md-studio/app tauri dev
```

## 프로젝트 구조

```
packages/
├── core/       변환 엔진 (@paper-md-studio/core)
│   ├── src/parsers/    포맷별 파서
│   │   ├── hwp/            .hwp 판별·사전 검사(암호·DRM·압축 폭탄)·rhwp 로더·오류 분류
│   │   ├── hwpx/           HWPX 파서 본체 (.hwp 도 rhwp 로 HWPX 로 바꾼 뒤 여기로)
│   │   ├── hwp-equation/   한컴 수식 스크립트 → LaTeX
│   │   ├── xlsx/ xls/ spreadsheet/   엑셀 파서 (두 포맷이 같은 렌더 코드)
│   │   └── *-parser.ts     포맷별 진입점 (hwp, hwpx, docx, doc, pdf, html, xlsx, xls)
│   └── tests/
├── cli/        CLI 인터페이스 (@paper-md-studio/cli)
├── md-utils/   Markdown 후처리 순수 함수 (@paper-md-studio/md-utils)
├── server/     REST API 서버 (@paper-md-studio/server)
├── mcp/        MCP 서버 (@paper-md-studio/mcp)
└── app/        Tauri GUI (@paper-md-studio/app)
    ├── src/            React 프론트엔드
    ├── src-tauri/      Rust 백엔드 + 리소스
    ├── sidecar-shim/   Windows 사이드카 PE 셰임 (Rust)
    ├── scripts/        sidecar 래퍼, 설치·서명 스크립트
    └── tests/e2e/      Playwright E2E 테스트

scripts/
├── bundle-node.mjs             Node 런타임 다운로드 (버전 고정 + SHA-256 검증)
├── bundle-runtime-deps.mjs     CLI 번들 옆 미니 node_modules (rhwp WASM, pdf-inspector)
├── prepare-app-resources.mjs   배포 리소스 최종 조립
└── smoke-cli-bundle.mjs        배포 리소스의 CLI 번들을 번들 Node 로 실제 실행해 보는 스모크 검사
```

## 명령어 참조

```bash
# 빌드
pnpm build                    # core/cli/app TypeScript 빌드
pnpm build:node               # Node 런타임 다운로드(SHA-256 검증) 및 정리
pnpm build:cli-bundle         # CLI를 tsup으로 단일 ESM 파일 번들
pnpm build:app-resources      # 배포 리소스 최종 배치
pnpm build:dist               # 위 모든 단계를 순서대로 실행
pnpm smoke:cli-bundle         # 배포 리소스의 CLI 번들 스모크 검사 (build:dist 이후)

# 테스트
pnpm test                     # Vitest 전체 실행
pnpm test:watch               # Vitest 워치 모드

# E2E
pnpm --filter @paper-md-studio/app test:e2e     # Playwright
pnpm --filter @paper-md-studio/app test:e2e:ui  # Playwright UI 모드

# 코드 품질
pnpm lint                     # Biome 검사
pnpm lint:fix                 # Biome 자동 수정
pnpm format                   # Biome 포맷
pnpm typecheck                # TypeScript 타입 검사
pnpm security                 # npm 보안 감사
```

## 배포 빌드 파이프라인

배포용 Tauri 앱을 빌드하려면 모든 리소스가 준비되어야 합니다:

```bash
# 1. 기본 빌드
pnpm build

# 2. Node 런타임 다운로드 (현재 OS용, SHA-256 검증)
pnpm build:node

# 3. CLI 단일 파일 번들 (+ rhwp WASM·pdf-inspector 미니 node_modules)
pnpm build:cli-bundle

# 4. 리소스 최종 배치
pnpm build:app-resources

# 5. 번들 CLI 스모크 검사 — 번들 Node 로 .hwp·.xls·.pdf(기본·대체 엔진)를 실제 변환
pnpm smoke:cli-bundle

# 6. Tauri 앱 빌드
pnpm --filter @paper-md-studio/app tauri build
```

또는 한 번에: `pnpm build:dist && pnpm smoke:cli-bundle && pnpm --filter @paper-md-studio/app tauri build`

스모크 검사는 `resources/cli` 를 저장소 **바깥** 임시 폴더로 복사해 실행합니다 —
저장소 안에서는 상위 `node_modules` 가 번들에서 빠진 파일을 가려 주기 때문입니다.
릴리스 워크플로도 macOS·Windows 에서 같은 검사를 tauri-action 앞에서 돌립니다
(`docs/RELEASE.md`).

번들 Node 버전을 올릴 때는 `scripts/bundle-node.mjs` 의 `NODE_VERSION` 과
`ARCHIVE_SHA256`(nodejs.org `SHASUMS256.txt`)을 함께 바꿉니다.

## Sidecar 아키텍처

Tauri 앱은 문서 변환을 sidecar 프로세스로 위임합니다:

```
Tauri 앱  →  sidecar (macOS: sh 래퍼 / Windows: Rust PE 셰임)  →  bundled Node  →  CLI index.js
                                                                                  └ node_modules/@rhwp/core (WASM)
                                                                                  └ node_modules/@firecrawl/pdf-inspector (NAPI)
```

- **개발 모드**: sidecar 가 시스템 node 와 모노레포 CLI 를 사용
- **배포 모드**: 번들된 Node 런타임(v22.23.3)과 CLI 번들을 사용

0.6.x 이하에서 업그레이드한 사용자 PC 에는 예전 사이드카가 첫 실행 때 풀어 둔 JRE 가
앱 데이터 폴더에 남습니다 (macOS `~/Library/Application Support/com.paper-md-studio.app/jre`
와 `jre.stamp`, Windows `%LOCALAPPDATA%\com.paper-md-studio.app\jre` 와 `jre.stamp`).
지금의 사이드카(macOS 래퍼·Windows 셰임)는 배포 모드로 실행될 때 이 폴더를
백그라운드에서 한 번 지웁니다(실패해도 변환을 막지 않음). 0.8.0 이후 이 정리 코드는
걷어내도 됩니다.

## 새 문서 포맷 추가하기

1. `packages/core/src/parsers/` 에 `{format}-parser.ts` 생성
2. `ConvertResult` 반환하는 `parse()` 함수 구현
3. `packages/core/src/pipeline.ts`의 FORMAT_MAP에 확장자 등록
4. `packages/core/tests/`에 테스트 추가
5. `packages/app/`의 뷰어 컴포넌트에 포맷별 렌더러 추가 (선택)
