# 개발 가이드

Paper MD Studio 개발 환경 설정 및 빌드 안내.

## 필수 요구사항

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | 20+ | 변환 엔진 및 프론트엔드 빌드 |
| pnpm | 10+ | 패키지 매니저 |
| Rust | stable | Tauri 백엔드 |
| JDK | 17+ | HWP 변환 도구 빌드 (jlink 포함) |
| Maven | 3.9+ | HWP 변환 Java 프로젝트 빌드 |

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

# HWP 변환 도구 빌드 (선택, HWP 지원 시 필요)
pnpm build:hwp-tool
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
│   ├── src/parsers/    포맷별 파서 (hwpx, docx, pdf, hwp)
│   ├── resources/      hwp-to-hwpx.jar (번들)
│   └── tests/
├── cli/        CLI 인터페이스 (@paper-md-studio/cli)
└── app/        Tauri GUI (@paper-md-studio/app)
    ├── src/            React 프론트엔드
    ├── src-tauri/      Rust 백엔드 + 리소스
    ├── scripts/        sidecar 래퍼, 설치 스크립트
    └── tests/e2e/      Playwright E2E 테스트

tools/
└── hwp-to-hwpx/    Maven 프로젝트 (HWP→HWPX Java 래퍼)

scripts/
├── build-jre.mjs           jlink로 최소 JRE 생성
├── bundle-node.mjs         Node 런타임 다운로드
└── prepare-app-resources.mjs   배포 리소스 최종 조립
```

## 명령어 참조

```bash
# 빌드
pnpm build                    # core/cli/app TypeScript 빌드
pnpm build:hwp-tool           # Maven으로 hwp-to-hwpx.jar 생성
pnpm build:jre                # jlink로 최소 JRE 번들 생성
pnpm build:node               # Node 런타임 다운로드 및 정리
pnpm build:cli-bundle         # CLI를 tsup으로 단일 ESM 파일 번들
pnpm build:app-resources      # 배포 리소스 최종 배치
pnpm build:dist               # 위 모든 단계를 순서대로 실행

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

# 2. HWP 변환 도구 (JDK 17+ 필요)
pnpm build:hwp-tool

# 3. 최소 JRE 생성 (jlink, 현재 OS용)
pnpm build:jre

# 4. Node 런타임 다운로드 (현재 OS용)
pnpm build:node

# 5. CLI 단일 파일 번들
pnpm build:cli-bundle

# 6. 리소스 최종 배치
pnpm build:app-resources

# 7. Tauri 앱 빌드
pnpm --filter @paper-md-studio/app tauri build
```

또는 한 번에: `pnpm build:dist && pnpm --filter @paper-md-studio/app tauri build`

## Sidecar 아키텍처

Tauri 앱은 문서 변환을 sidecar 프로세스로 위임합니다:

```
Tauri 앱  →  sidecar wrapper (sh/cmd)  →  bundled Node  →  CLI index.js
                                        →  bundled JRE   →  hwp-to-hwpx.jar
```

- **개발 모드**: sidecar wrapper가 시스템 node/java를 사용
- **배포 모드**: 번들된 Node 런타임과 JRE를 사용

## 새 문서 포맷 추가하기

1. `packages/core/src/parsers/` 에 `{format}-parser.ts` 생성
2. `ConvertResult` 반환하는 `parse()` 함수 구현
3. `packages/core/src/pipeline.ts`의 FORMAT_MAP에 확장자 등록
4. `packages/core/tests/`에 테스트 추가
5. `packages/app/`의 뷰어 컴포넌트에 포맷별 렌더러 추가 (선택)
