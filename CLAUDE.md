# CLAUDE.md

이 파일은 Claude Code가 이 저장소 작업 시 참고하는 가이드입니다.

## 프로젝트 개요

paper-md-studio — HWP, HWPX, DOCX, PDF를 Markdown으로 변환·편집하는
크로스플랫폼 데스크톱 앱 (macOS Apple Silicon + Windows 11). CLI-first
접근: 변환 엔진(core)을 먼저 구축하고, 이후 Tauri GUI(app)를 씌웁니다.

## 기술 스택

- **런타임**: Node.js 22.13+ (앱은 Node v22.23.3 을 번들 — 버전·SHA-256 고정, Java 불필요)
- **언어**: TypeScript (strict mode)
- **GUI**: Tauri 2.x + React 19 (Phase 3~)
- **에디터**: Milkdown (WYSIWYG) + CodeMirror 6 (소스) — Phase 5~
- **HWP 엔진**: rhwp (`@rhwp/core` 0.8.6 정확 핀, Rust→WASM) — `.hwp`→HWPX 선변환 + 앱 HWP/HWPX 뷰어
- **빌드**: tsup (core/cli), Vite (app), cargo (src-tauri·sidecar-shim)
- **패키지 매니저**: pnpm (모노레포)
- **린트/포맷**: Biome
- **테스트**: Vitest (unit/integration), Playwright (E2E)

## 프로젝트 구조

```
packages/
├── core/    # 변환 엔진 라이브러리 (@paper-md-studio/core)
│   └── src/parsers/
│       ├── hwp/           # .hwp 판별·사전 검사(암호·DRM·압축 폭탄)·rhwp 로더·한국어 오류
│       ├── hwpx/          # HWPX 파서 본체 (.hwp 도 rhwp→HWPX 후 여기로)
│       └── hwp-equation/  # 한컴 수식 스크립트 → LaTeX (kordoc·hml-equation-parser 유래)
├── cli/     # CLI 인터페이스 (@paper-md-studio/cli)
├── md-utils/# Markdown 후처리 순수 함수 (@paper-md-studio/md-utils)
│            # app 과 cli 가 함께 쓴다 — node: API 없음
├── server/  # REST API (@paper-md-studio/server)
├── mcp/     # MCP 서버 (@paper-md-studio/mcp)
└── app/     # Tauri GUI (Phase 3~, @paper-md-studio/app)
```

## 명령어

```bash
pnpm install          # 의존성 설치
pnpm build            # 전체 빌드
pnpm test             # Vitest 테스트
pnpm lint             # Biome 검사
pnpm lint:fix         # Biome 자동 수정
pnpm format           # Biome 포맷
pnpm typecheck        # TypeScript 타입 검사
pnpm security         # npm 보안 감사

pnpm build:node                                  # 번들 Node 다운로드 (버전 고정 + SHA-256 검증)
pnpm build:dist                                  # 배포 리소스 전체 (build → node → cli-bundle → app-resources)
pnpm smoke:cli-bundle                            # 배포 리소스의 CLI 번들을 번들 Node 로 실제 실행 (build:dist 후)
pnpm --filter @paper-md-studio/app sidecar:install    # Tauri sidecar 래퍼 배포
pnpm --filter @paper-md-studio/app tauri dev          # GUI 개발 실행
pnpm --filter @paper-md-studio/app test:e2e           # Playwright E2E
```

## 지원 포맷 (2026-10-03 현재)

- HWPX → Markdown (자체 파서 `parsers/hwpx/` — PUA 정규화·중첩표·grid normalize·글머리표/문단 번호·글상자·각주·캡션·링크, 수식 → LaTeX `$…$`)
- HWP 5.0(배포용 문서 포함)·HWP 3.x·HWPML → Markdown (`.hwp` 매직바이트 자체 판별 → 사전 검사(암호·DRM·압축 폭탄) → rhwp(WASM)로 HWPX 변환 → 위 HWPX 파서. Java·kordoc 불필요)
- DOCX → Markdown (`mammoth` + 자체 GFM 표 직렬화)
- DOC → Markdown (LibreOffice로 DOCX 선변환, macOS textutil 폴백 — 표·이미지 손실 경고)
- PDF → Markdown (기본 `@firecrawl/pdf-inspector`(Rust/NAPI) + `cleanupInspectorMarkdown` 후처리. `PAPER_MD_STUDIO_PDF_ENGINE=legacy` 이거나 inspector 로드 실패 시 `@opendocsg/pdf2md` + 자체 보정 2단)
- HTML → Markdown (`@mozilla/readability` + `linkedom` 본문 추출, 로컬 파일·URL·SPA 렌더링)
- XLSX → Markdown (자체 파서 — 표시형식·병합·숨김·이미지, `parsers/xlsx/`)
- XLS (BIFF8) → Markdown (자체 파서 — OLE2 컨테이너는 `cfb`, `parsers/xls/`. XLSX와 출력 동일 보장: `tests/spreadsheet-parity.test.ts`)

모든 표는 같은 GFM 계약(grid normalize + 병합 화살표 ←/↑ + 1행 1줄)으로 직렬화된다.
CSV는 의도적으로 미지원 — 이미 구분자 있는 플레인 텍스트라 MD 표로 바꾸면 토큰만 늘어난다 (2026-08-16 결정).

## 코딩 규칙

### TypeScript
- `any` 타입 사용 금지 → `unknown` 사용
- `Array<T>` 문법 사용 (`T[]` 금지)
- non-null assertion(`!`) 자제, 타입 가드 또는 early return 사용
- import 정렬은 Biome가 자동 처리
- CLI 패키지 외에는 `console.*` 사용 금지

### 네이밍
- 파일명: kebab-case (`html-to-md.ts`, `hwpx-parser.ts`)
- 타입/인터페이스: PascalCase (`ConvertResult`, `ImageAsset`)
- 함수/변수: camelCase (`detectFormat`, `inputPath`)
- 상수: UPPER_SNAKE_CASE (`FORMAT_MAP`)
- 테스트 파일: `{대상}.test.ts` (`pipeline.test.ts`)

### 파일 구조
- 한 파일에 하나의 주요 책임
- public API는 `index.ts`에서 re-export
- 테스트는 `tests/` 디렉토리에 소스 구조를 미러링

### 한글 파일명 (macOS NFD 대응)
- macOS는 파일명을 NFD로 저장하여 한글이 자모 분리됨
- 모든 파일 경로 진입점에서 `normalizePath()`로 NFC 정규화 필수
- `@paper-md-studio/core`의 `normalizePath`, `normalizeToNFC` 사용

### 기타
- 모든 에러 메시지는 한국어로 작성
- 이미지 저장: `{문서명}_images/` 디렉토리, 상대경로 참조

## 커밋 컨벤션

Conventional Commits 형식:
```
<type>(<scope>): <설명>
```

- type: feat, fix, docs, style, refactor, test, chore, build, ci, perf, revert
- scope: core, cli, app, config 등

### Git Hooks (lefthook)

커밋 시 자동 실행:
- **pre-commit**: Biome lint + TypeScript 타입 검사
- **commit-msg**: Conventional Commits 형식 검증

## 주요 결정 로그

| 날짜 | 결정 | 근거 |
|------|------|------|
| 2026-04-07 | Tauri 2.x 선택 | 번들 크기, 성능, 보안 이점 |
| 2026-04-07 | CLI-first 개발 | 변환 품질 우선 검증 |
| 2026-04-07 | MVP: HWPX+DOCX+PDF | HWP/DOC 라이브러리 미성숙 |
| 2026-04-07 | pnpm 모노레포 | core/cli/app 패키지 분리, 재사용성 |
| 2026-04-07 | Biome 채택 | ESLint+Prettier 대체, 단일 도구 |
| 2026-04-13 | HWP 바이너리 지원을 Phase 4.5로 선행 | 사용자 요구 우선순위 상승 |
| 2026-04-13 | `neolord0/hwp2hwpx` (Java, Apache-2.0) 채택 **(2026-10-03 대체됨 — rhwp, Java 경로 제거)** | `HWPReader → Hwp2Hwpx → HWPXWriter` 단순 API, 활발한 유지보수 |
| 2026-04-13 | JitPack + 커밋 SHA 핀닝 **(2026-10-03 대체됨 — Maven 툴과 함께 제거)** | 배포 태그 부재, 재현성 확보 |
| 2026-04-13 | DOMPurify `ALLOWED_URI_REGEXP` 커스터마이즈 | 뷰어 data/blob URI 이미지가 기본 정책에서 제거되던 이슈 수정 |
| 2026-04-13 | HWPX `parseCellText`에 `ImageCollector` 전달 | 표 셀 내부 이미지 누락 버그 수정 |
| 2026-04-13 | Phase 5 에디터: Milkdown Crepe + CodeMirror 6 | React 19 호환, WYSIWYG/소스 각각 성숙, 독립 히스토리 |
| 2026-04-13 | 4-모드 편집(보기/편집/소스/분할) | 사용자 요구: 편집 + 미리보기 동시 제공 |
| 2026-04-13 | `data-theme` 기반 수동 테마 오버라이드 | `prefers-color-scheme` 위에 사용자 선택 얹기, localStorage 영속화 |
| 2026-04-27 | Node.js 22 LTS 로 통일 (engines + CI + Release) | Node 20 EOL 회피. 번들 사이드카는 Phase 2 에서 별도 검증 후 이동 |
| 2026-04-27 | REST 서버에서 인증·레이트리밋 제거 (GW 위임) | "기능에 집중, 횡단 관심사는 인프라 레이어" 원칙. SSRF·이미지 HMAC·캐시는 도메인 종속이라 앱에 유지 |
| 2026-04-29 | Windows sidecar 를 Rust 셰임 PE 바이너리로 전환 (`packages/app/sidecar-shim/`) | `.cmd` 를 `.exe` 이름으로 복사하던 기존 방식이 `CreateProcessW` PE32+ 헤더 검증에 실패해 "64비트 버전 Windows와 호환되지 않습니다" 오류 발생. macOS `.sh` 래퍼는 그대로 유지 (PE 검증 없음). 호출측(`converter.ts`, `hwpx-viewer.tsx`) 변경 0 |
| 2026-05-13 | HWPX 셀 내부 중첩 표(`<hp:tbl>` in cell)를 `(표 R×C) 행1셀1 \| 행1셀2 / 행2셀1 \| ...` 형식으로 인라인 평탄화 | GFM 표 셀은 블록 요소를 못 담아 부모 표가 깨지고, 그로 인해 한컴 요구사항 정의서 등의 "세부 내용" 셀이 통째로 누락됐음. `[...]`는 turndown이 링크 syntax로 escape하므로 `(...)` 채택. 깊이 제한 5단 |
| 2026-05-13 | HWPX 표 `colSpan`/`rowSpan` 병합 셀을 grid normalize (빈 셀 padding) | GFM 표는 첫 행 separator 기준으로 컬럼 수가 결정되어 후속 행 셀 수가 다르면 잘림. 한컴 양식은 3-컬럼 grid + colSpan=2로 시각 변형하는 패턴이 흔해, 정규화 없이는 마지막 셀(예: APR-001의 "원천 정보시스템 분석")이 누락됨. cellSpan 정보로 rowSpan stack을 유지하며 모든 행을 max(grid) 크기로 빈 셀 padding |
| 2026-07-23 | HWPX PUA 심볼 문자(U+F0xx)를 유니코드로 정규화 (`parsers/pua-symbols.ts`) | 한글이 체크박스 등 기호를 Wingdings 코드+0xF000 PUA로 저장 (F06E=■, F0A8=□, F0FE=☑ 등). 문서에 Wingdings 폰트 참조가 없어 폰트 기반 판별 불가 → 잘 알려진 12개 코드만 보수적 매핑, 미지 코드는 원본 유지. 정부 조사서 양식의 체크 여부가 전부 안 보이던 버그 수정 |
| 2026-07-23 | HTML→MD 본문 추출: `@mozilla/readability` + `linkedom` | 검증된 휴리스틱 + 경량 DOM(스크립트 미실행). 추출 실패 시 body 전체 폴백, `--no-extract`로 비활성 가능 |
| 2026-07-23 | `safeFetch`를 server → core `net/`으로 승격 | HTML URL 변환·이미지 다운로드에서 SSRF 가드 재사용 (DRY). server `fetch/safe-fetch.ts`는 re-export 셰임으로 하위호환 유지 |
| 2026-07-27 | Tauri 자동 업데이터 도입 + Windows `.msi` 배포 중단 (`bundle.targets: ["app","dmg","nsis"]`) | 매 릴리스 수동 재설치가 번거로웠음. NSIS는 관리자 권한 없이 설치되고 업데이터 페이로드로도 쓰여 msi와 중복 → 하나로 정리. macOS `.app.tar.gz`는 중복이 아니라 업데이트 페이로드라 유지. 엔드포인트는 `releases/latest/download/latest.json` (published 릴리스만 조회하므로 draft 해제 필수). 상세는 `docs/RELEASE.md` |
| 2026-07-27 | HWPX 뷰어 페이지 가상화 (보이는 구간 ±2쪽만 렌더, ±6쪽 밖은 SVG 폐기) | 기존 `renderAllPages`가 전 페이지 SVG를 한 번에 생성·주입 → 29쪽 샘플에서도 SVG 4.2MB/요소 1.5만 개. 수백 쪽 문서는 수백 MB·수십만 DOM 노드로 앱은 물론 시스템 전체가 멈췄음. 자리표시자 크기는 `getPageInfo`(실제 SVG와 오차 0.02px)로 잡아 스크롤바·점프 정확도 유지 |
| 2026-07-27 | HWPX 검색 인덱스를 첫 검색어 입력 시점에 프레임 단위(12ms)로 구축 | `buildTextIndex`가 render 단계 `useMemo`에서 문서 전체를 동기 순회 — 검색하지 않는 사용자도 문서를 열 때마다 비용을 지불. 재귀를 명시적 작업 스택으로 바꿔 셀 문단 단위로 중단·재개 가능하게 함 (거대 표 하나가 통째로 블로킹되던 문제도 해소) |
| 2026-07-27 | 로딩 표시를 transform 기반 스피너로 통일 (`ui/spinner.tsx`) | 정적 텍스트는 메인 스레드가 막히면 "작업 중"과 "죽음"이 구분되지 않음. transform 애니메이션은 컴포지터 스레드에서 돌아 동기 작업 중에도 계속 회전 |
| 2026-07-23 | SPA 렌더링: `playwright-core` optionalDependency + 동적 import + 시스템 Chrome 채널 | 브라우저 자동 다운로드·번들 비대화 회피. CLI 번들에서 external 처리, 미설치 시 한국어 안내 에러. 네비게이션·sub-resource 요청 모두 route 인터셉션으로 SSRF 검증(DNS rebinding 한계는 잔존), opt-in(`--render`) 유지 |
| 2026-08-03 | PDF 보정을 pdf2md **앞뒤 두 지점**에 배치 (`pdf-text-runs.ts` / `pdf-postprocess.ts`) | 한글 워드프로세서가 굵은 글씨를 "같은 텍스트 0.1pt 씩 밀어 23번 겹쳐 그리기"로 표현해 `제안요청서`가 23번 반복됐고, pdf2md `LineConverter`가 숫자 경계마다 런을 끊어 공백으로 재결합해 `제21조`→`제 21 조`가 됐음. 둘 다 텍스트 런 단계에서만 고칠 수 있어 `pageParsed` 콜백으로 개입. 목차 오인식·점선 리더는 줄 단위 판단이라 출력 후처리로 분리 |
| 2026-08-03 | 겹침 판정 허용오차에 **절대 하한 2pt** 부여 | 공백 글리프는 `height` 가 0이라 비율(25%)만 쓰면 허용오차가 0이 되어 중복 공백 런이 살아남고, 그게 pdf2md 의 각주 판정(`y > firstY`)에 걸려 `^` 가 새로 생겼음 |
| 2026-08-04 | macOS Developer ID 서명 + 공증 도입 (tauri-action `APPLE_*` 시크릿, 법인 계정 P4S6KATL7C) | Gatekeeper `xattr -cr` 우회 안내 제거. 번들된 Node(OpenJS 서명)·JRE(tar.gz 내부)는 재서명 없이 공증 통과 확인 (2026-08-04 로컬 실측). 시크릿 목록·갱신 절차는 `docs/RELEASE.md` |
| 2026-08-07 | **kordoc 4.7.2 채택** (정확 핀, `^` 금지) — XLSX·XLS·HWP3·HWPML 변환 위임, `.hwp` 매직바이트 3분기(HWP3·HWPML→kordoc, OLE2→기존 Java) **(2026-10-03 대체됨 — kordoc 제거, `.hwp` 는 rhwp)** | 순수 TS·MIT·오프라인 1급 지원(`KORDOC_OFFLINE=1` 기본 강제, fetch 지점 2곳 실측). `parsers/kordoc-adapter.ts` 1곳 격리 + 계약 테스트(`tests/kordoc-adapter.test.ts`). 통합 로드맵·작업지시서는 `docs/kordoc-integration.md` |
| 2026-08-08 | **비공개 문서는 `private/` 안에서만 취급** (폴더 전체 gitignore). 파일 단위 예외(`!sample.pdf` 등) 금지, 문서 제목·본문·발췌를 저장소·커밋 메시지에 남기지 않음 | 종전엔 업무 문서를 추적 디렉토리(`tests/fixtures/`)에 두고 확장자 패턴으로만 걸렀는데, 규칙 변경·`git add -f` 로 뚫리고 실제로 커밋 메시지·문서에 원문 인용이 새어 사후 스크럽이 필요했음. 예외 목록은 언젠가 틀리므로 폴더 격리로 단순화. 배치 원칙은 `packages/core/tests/fixtures/README.md` |
| 2026-08-08 | CI 보안 감사 복구 — `pnpm audit` 20건 → 0건. **① override 값은 `>=` 대신 계열 고정(`^`) + 범위 키는 상·하한 모두 명시 ② pdfjs-dist 5.x→6.x 는 `legacy/build` 로 임포트 ③ `engines.node` ≥22.13.0** | ① `>=` 는 이미 배포된 새 메이저(undici 8.x, nanoid 6.x)를 전이 의존성에 끌어들인다 — 감사만 통과하고 런타임이 깨지는 전형적 경로. 하한 없는 키(`nanoid@<3.3.17`)는 1.x/2.x 선언까지 강제 승격시켜 동일 위험. ② v6 modern 빌드는 `Iterator` 헬퍼(Safari 18.4+)를 폴리필 없이 참조 — `minimumSystemVersion 12.0`(macOS 12 는 Safari 17.6 상한)과 충돌해 뷰어가 로드부터 깨진다. headless chromium 검증으로는 안 잡히는 종류(Chrome 은 122+ 지원). legacy 빌드는 core-js 폴리필 내장. ③ pdfjs 6.x 의 engines 가 실질 바닥을 올림. 상세·검증 기록은 `docs/security-audit-remediation.md` §0 |
| 2026-08-16 | **HWP3·HWPML에도 GFM 표 정규화 적용** (`hwp-parser.ts`의 kordoc 분기에 `normalizeTables: true`) — 전 포맷이 같은 표 계약으로 수렴. **CSV는 의도적 미지원** **(HWP3·HWPML 부분 2026-10-03 대체됨 — rhwp→HWPX 로 HWPX 표 계약을 그대로 탄다. CSV 결정은 유효)** | HWPML 합성 병합 표가 kordoc에서 HTML `<table>`로 나오는 것을 실측 — 이 두 포맷만 예외로 남아 있었다. HWPML은 XML이라 합성 픽스처로 테스트 고정 가능 (`hwp-parser.test.ts`, 셀에 `ColAddr`/`RowAddr` 필수 — 없으면 kordoc이 표를 통째로 버린다). CSV: 이미 구분자 있는 플레인 텍스트라 MD 표로 바꾸면 오히려 토큰이 늘어난다 — 제품 1급 목표(토큰 절감)에 역행 |
| 2026-08-16 | **REST·MCP에 경고 배선 + 숨김 옵션 노출** — ① `warnings`·`hiddenExcluded`를 meta.json에 저장해 캐시 히트에서도 동일 응답 ② REST `?includeHidden=true`, MCP `includeHidden` 인자 ③ **옵션을 캐시 키에 반영** (`conversionCacheId` — 옵션을 해시에 섞어 새 64-hex 생성, ID 형식 검증·shard·서명 URL 무변경) | 검토 결과 `ConvertCache`가 core의 경고를 통째로 버리고 있었다 — 2026-08-08 경고 배선이 CLI·GUI까지만이어서, REST·MCP 소비자(특히 AI)는 숨긴 시트가 조용히 빠진 것을 알 길이 없었다. 옵션을 키에 안 섞으면 "숨김 제외" 캐시가 "숨김 포함" 요청에 그대로 나간다 — 같은 파일·다른 옵션은 다른 변환이다. 경고를 meta에 저장하는 이유: 첫 요청만 경고를 받고 캐시 히트는 못 받으면 소비자마다 다른 그림을 본다. MCP 툴 설명의 지원 포맷도 XLSX/XLS 누락 상태였음(K1 때 서버만 고침) |
| 2026-08-16 | **`.xls`(BIFF8)도 자체 파서로 전환**, kordoc은 엑셀에서 완전히 손을 뗌. 격자 이후 단계를 `parsers/spreadsheet/`(cell-format·visibility·grid·render)로 뽑아 **두 포맷이 문자 그대로 같은 코드로 렌더** | 사용자에게 `.xls`와 `.xlsx`는 "같은 엑셀"이라 확장자만 다른 문서가 날짜는 45000, 서식은 소실, 숨김은 노출로 갈리면 버그로 읽힌다. 컨테이너(OLE2)는 검증된 `cfb`(Apache-2.0, 프로젝트 규칙 "battle-tested 우선")에 맡기고 BIFF 레코드만 직접 읽는다. **합성 픽스처의 함정 회피**: 생성기·파서를 모두 내가 쓰면 "서로만 맞는" 상태를 못 걸러내므로, 생성기가 만든 바이트를 독립 구현(kordoc)이 읽어내는 것으로 진짜 BIFF8임을 검증(2026-08-16). 동일성은 `tests/spreadsheet-parity.test.ts`가 같은 내용의 두 파일을 변환해 markdown·경고·hiddenExcluded를 **문자열 비교**로 고정한다. BIFF5(Excel 5/95)는 레코드 구조가 달라 거부하되 "다시 저장하거나 .xlsx로 변환" 안내를 남긴다 |
| 2026-08-15 | **XLSX 원본 뷰어 추가** (`viewers/xlsx-viewer.tsx`) — 자체 파서의 HTML을 `--html`로 받아 렌더, **숨긴 행·열을 지우지 않고 빗금+흐림으로 표시**, 시트 2개 이상일 때만 이동 탭 | 엑셀은 다른 포맷과 달리 원본 뷰어가 없으면 "무엇이 빠졌는지" 대조할 방법이 아예 없다 — 결과 배너가 숨긴 항목을 알려줘도 원본을 못 보면 포함 여부를 판단할 수 없어 배너가 반쪽이 된다. 그래서 뷰어는 `includeHidden: true`로 불러오되(원본 그대로 보여주는 게 뷰어의 역할) 숨김이던 자리에 `xlsx-hidden-row`/`xlsx-hidden-col` 클래스를 실어 흐리게 그린다. 클래스는 turndown이 버리므로 Markdown 출력에는 영향이 없다. 자체 파서가 이미 HTML을 내기 때문에 새 의존성 없이 붙었다 (docx-preview·pdfjs 같은 별도 렌더러 불필요) |
| 2026-08-15 | **GUI의 숨김 옵션은 사전 설정이 아니라 결과 배너의 인라인 액션** (`ConversionNotice`) + 재변환 중 직전 결과 유지 + `ConvertResult.hiddenExcluded` 구조화 | 무엇이 숨겨져 있는지는 파일을 열기 전엔 알 수 없어, 변환 전 체크박스는 사용자에게 깜깜이 선택을 강요한다. 게다가 대부분의 문서엔 숨긴 항목이 없어 상시 UI는 순수 비용이다. 변환 후에는 무엇이 몇 개 빠졌는지 이미 알고 있으므로, 그 시점의 배너에 버튼을 붙이면 설정을 찾아다닐 필요가 없고 숨긴 게 없는 파일에서는 UI 비용이 0이다. 버튼 노출 조건을 한국어 경고 문구 파싱으로 정하면 문구를 고칠 때마다 UI가 깨지므로 `hiddenExcluded{sheets,rows,cols}`를 별도로 돌려준다. **되돌리는 방법 안내는 진입점 몫** — core 경고에 `--include-hidden`을 넣었더니 GUI 배너에 CLI 플래그가 그대로 새어 나왔다(headless 스크린샷 실측). 재변환 시 `status !== "done"`으로 패널을 비우면 보던 결과가 사라졌다 돌아와 깜빡이므로, 결과가 있으면 유지하고 배너만 바꾼다 |
| 2026-08-15 | **엑셀 숨김 처리를 사용자 선택으로** (`xlsx.includeHidden`, CLI `--include-hidden`, 기본 false) + **숨긴 열(`<cols hidden>`) 파싱 추가** | 숨김의 의도는 대외비 은닉일 수도, "열이 많아 보기 불편해서" 접어둔 것일 수도 있어 문서만 보고 구분할 수 없다 — 우리가 대신 판단하지 않고 사용자가 고르게 한다. 기본은 제외(변환 결과는 공유되는 산출물)이되 경고에 `--include-hidden`을 함께 안내해 되돌릴 방법을 노출한다. 열 숨김은 셀이 아니라 `<cols min max hidden>` 구간에 적혀 있어 별도 파싱이 필요했고, 종전엔 **아예 처리되지 않아 숨긴 열이 그대로 나왔다**. 병합이 숨김과 겹치면 span을 다시 세지 않으면 표의 열 수가 어긋나므로 격자를 통째로 재투영한다(`parsers/xlsx/visibility.ts`) — 병합 시작 셀이 숨겨진 경우엔 내용을 첫 보이는 자리로 옮겨 값 손실을 막는다 |
| 2026-08-15 | **`.xlsx`를 kordoc에서 자체 파서로 전환** (`parsers/xlsx-parser.ts` + `parsers/xlsx/`). `.xls`(바이너리 BIFF)는 kordoc 유지 | kordoc 4.7.2가 xlsx에서 **날짜를 시리얼 숫자 그대로 출력**한다 — 근본 원인은 `@xmldom/xmldom`의 `getAttribute`가 없는 속성에 `null`이 아닌 `""`를 반환해 `type === null` 가드가 죽는 것. 엑셀은 숫자 셀의 `t` 속성을 생략하므로 **실물 엑셀의 날짜는 100% 미변환**(2026-08-15 실측: `t` 생략 시 45000, `t="n"` 명시 시 2023-03-15). 게다가 kordoc xlsx 파서에는 styles(표시형식 일부)·drawings(이미지)·hyperlinks·hidden 처리가 아예 없어, 통화·백분율 서식 소실, 이미지 0개 추출, URL 소실, **숨긴 시트·행 그대로 노출**이 동반된다. 이 정보는 kordoc 출력(markdown)에 이미 없어 사후 보정이 불가능 → 위임 대신 직접 파싱. xlsx는 zip+XML이라 기존 의존성(fflate·fast-xml-parser)으로 충분하고 HWPX 파서와 같은 난이도. 표는 colspan/rowspan HTML로 만든 뒤 `normalizeHtmlTablesToGfm`에 넘겨 DOCX·HWPX와 계약 자동 일치. 숨긴 시트·행은 **기본 제외 + 경고**(변환 결과는 공유되는 산출물), 대형 시트는 5000행×200열 상한 + 경고(조용한 손실 금지) |
| 2026-08-15 | **DOCX 표를 HWPX/kordoc 경로와 같은 GFM 계약으로 통일** — ① 표만 HTML 원형으로 남기는 `htmlToMarkdownKeepingTables` 2-pass 후 `normalizeHtmlTablesToGfm` 재사용 (병합 화살표·grid 정규화 자동 적용) ② 셀 안 블록 요소(`<p>`·목록)를 `<br>`로 평탄화 ③ DOC textutil 폴백에 손실 경고 배선 | turndown-plugin-gfm이 colspan/rowspan을 버리고 mammoth의 셀 내부 `<p>`마다 줄바꿈을 내 병합 표가 통째로 깨졌음 (실물 표본 4개 표 전부 행 단위 조각남, rowspan 17곳 소실). DocxParser는 html(뷰어용 mammoth 원본)과 markdown(GFM)을 함께 반환 — `convert()`는 markdown, `convertToHtml()`은 html을 집는 기존 계약 활용. textutil doc→docx는 표를 w:tbl 0개로 평탄화(2026-08-15 실측)하는데 경고가 없으면 사용자가 원인을 알 수 없음 — 스캔 PDF 경고와 같은 원칙 |
| 2026-08-17 | **리소스 안 네이티브 바이너리를 릴리스 워크플로 전용 스텝에서 Developer ID 로 서명** (`packages/app/scripts/sign-macos-resources.mjs` + 임시 키체인) | v0.6.0 첫 릴리스 시도가 공증에서 거부됐다 — PDF 엔진 교체로 번들에 들어온 `pdf-inspector.darwin-arm64.node` 가 원인. 공증은 아카이브 안의 모든 Mach-O 를 검사하는데 Tauri 는 `.app` 껍데기만 서명한다. **NAPI 바이너리는 ad-hoc(linker-signed) 로 배포되어 `codesign --verify` 를 통과**하므로 서명 여부만 보면 놓친다 — 발급 기관이 Developer ID 인지까지 봐야 한다. 번들 Node 는 이미 OpenJS 의 Developer ID 서명이고 JRE 는 tar.gz 안이라 검사 대상이 아니어서 지금껏 드러나지 않았다. **`beforeBundleCommand` 훅은 안 된다** — 실측 결과 `The specified item could not be found in the keychain`. 인증서를 키체인에 올리는 주체가 tauri-action 이 아니라 Tauri CLI 자신이고 그 시점이 번들링 도중이라, 훅이 도는 때에는 키체인이 비어 있다. 그래서 스텝에서 임시 키체인을 직접 만들고 서명 후 되돌린다. 절차는 자체 서명 인증서로 로컬 시연해 검증했다. 번들 Node 는 `disable-library-validation` 이 있어 우리 Team ID 로 서명한 `.node` 도 정상 로드한다. 파일 단위가 아니라 리소스 전체를 훑으므로 다음에 네이티브 의존성이 들어와도 자동으로 걸린다 |
| 2026-08-17 | **엑셀 격자에서 내용 바깥의 빈 행·열을 잘라낸다** (`spreadsheet/grid.ts`의 `trimEmptyEdges`, 호출은 `render.ts` 1곳이라 .xlsx·.xls 동시 적용). 안쪽(내용 사이) 빈 행은 원본의 구획일 수 있어 남긴다 | "엑셀은 빈 행·열을 아예 쓰지 않는다"는 파서의 전제가 실물에서 깨진다 — 행 높이·테두리만 지정해도 `<row>`가 생기고, LibreOffice 저장본은 내용과 무관하게 1000행을 통째로 적는다. 실물 WBS 실측: 표지 시트 실제 내용 26행 / 기록된 행 1000행(775행은 셀조차 없음), 통합 문서 전체로는 표 6,164행 중 4,830행이 꼬리 빈 행. 결과물이 666KB→285KB, 변환 1,485ms→554ms로 줄었고 비어 있지 않은 셀 18,320개는 순서까지 그대로다. **잘라낸 자리까지 뻗던 병합은 남은 크기로 다시 세야 한다** — rowSpan을 그대로 두면 grid 정규화가 빈 행을 되살린다. 숨김 집계도 잘라낸 뒤 기준이어야 내용 없는 자리의 숨김을 "제외했다"고 알리지 않는다 |
| 2026-08-17 | **`micromark-extension-gfm-table` 2.1.1에 위치 색인 패치** (`patches/`, pnpm `patchedDependencies`). `EditMap.add`의 선형 탐색을 `Map<at, Change>` 조회로 교체 | 큰 표에서 미리보기가 멈추는 진짜 원인이었다. 편집은 표의 셀 수만큼 생기는데 `addImplementation`이 매번 편집 목록 전체를 훑어 O(n²) — 순수 remark는 1,600행에 23ms, gfm을 켜면 20,990ms. CPU 프로파일에서 `flushCell`·`EditMap.add`가 자체 시간 대부분을 차지했다. 패치 후 1,600행 9,560ms→212ms(45배), 3,200행 43,178ms→448ms(96배)이고 **선형**이 된다. mdast 완전 일치 검증: 정렬·셀 내부 인라인·이스케이프 파이프·행별 열 수 불일치·`<br>`·표 여러 개·코드블록 안 파이프 등 10개 케이스 + 실물 문서 전체. 상류 최신(2.1.1)에 이미 있는 결함이라 업스트림 수정 대기 대신 패치를 든다. 패치 유실은 `packages/app/tests/markdown-table-perf.test.ts`(1,600행 3초 예산)가 잡는다 |
| 2026-08-17 | PDF 기본 엔진을 `@firecrawl/pdf-inspector`(1.14.2 정확 핀, Rust/NAPI)로 전환, pdf2md는 `PAPER_MD_STUDIO_PDF_ENGINE=legacy` 탈출구 + 로드 실패 폴백으로 보존 **(배포의 cfb 동봉 부분 2026-10-03 대체됨 — kordoc 제거로 cfb·adler-32·crc-32 동봉을 뺐다. cfb 는 번들에 인라인되고, 미니 node_modules 는 pdf-inspector + rhwp WASM)** | 실물 문서 A/B 실측: 표 감지 107/81행 vs 0행(우리는 표 전멸), 인쇄형 PDF 읽기 순서 79.4% vs 59.1%(저장본 기준 8-gram 교차 포함율), 내용 보존 동일(한글 스트림 7,272자), 결합 토큰도 inspector 승(7,034 vs 7,619). 후처리 `cleanupInspectorMarkdown`으로 점선 리더·Ÿ(한컴 불릿 CP1252 오매핑) 정리. **배포**: NAPI 로더의 전 플랫폼 `require('./*.node')` 때문에 CLI 번들에서 external 처리하고, kordoc dist의 top-level `createRequire()("cfb")`와 함께 `scripts/bundle-runtime-deps.mjs`가 dist-bundle 옆 미니 node_modules(pdf-inspector 로더+플랫폼 바이너리, cfb·adler-32·crc-32)로 동봉 — 이게 없으면 번들이 로드조차 안 된다 |
| 2026-08-08 | PDF 파이프라인 3건 교정 — ① `mergeAdjacentRuns` 의 글꼴 일치 조건 제거 ② 제목 오승격 강등(`demoteFalseHeadings`) ③ 텍스트 없는 PDF 경고를 CLI·GUI 까지 배선 | ① 2026-08-03 수정이 한컴 PDF(단일 글꼴)에서만 통했음. Chrome·Word 산출 PDF 는 한글/숫자를 다른 글꼴에 임베드해 `제 21 조` 가 재발 — 실물 문서에서 그런 인접쌍이 712곳. ② pdf2md 가 최빈 글자 크기를 본문으로 봐서, 표가 많은 문서는 표 셀이 기준이 되어 본문·표 행이 전부 제목이 됐음. ③ 스캔본이 빈 결과를 성공으로 반환해 사용자가 원인을 알 수 없었음 — 표시 경로까지가 수정 범위 |
| 2026-08-19 | **`removeEmptyTableRows`를 app → `packages/md-utils`로 승격**하고 CLI에 `--remove-empty-rows` 노출 | 빈 행 정리가 GUI에만 있어 CLI·server·MCP 사용자가 못 썼다. app 은 `@paper-md-studio/core` 에 의존하지 않으므로(변환을 Rust 로 함) core 로는 못 올린다 — core 는 `node:` API 를 22곳에서 써 프런트 번들에 못 들어간다. 그래서 의존성 없는 순수 함수만 담는 패키지를 따로 뒀다(`safeFetch` 를 core 로 승격했던 것과 같은 판단). 기본값은 끈 채로 둔다 — 빈 행이 원본의 구획인 경우가 있어 일괄 제거가 항상 옳지는 않다. 실측(한글 산출물 문서): 표 행의 30~73%가 빈 행이고 그중 **99%가 표 꼬리**, 플래그 적용 후 빈 데이터 행 0 |
| 2026-10-02 | **XLSX 파서 셀 손상 3건 교정** — ① XML 파서 `parseTagValue: false`·`trimValues: false` (숫자 셀만 `String(Number(raw))`로 .xls와 표기 일치) ② 병합에 통째로 덮인 행도 `<tr>` 출력 ③ 표시형식 `_x`·`*x`를 다음 글자까지 한 토큰으로 처리 | 실물 엑셀 2건을 **독립 구현(openpyxl)과 셀 단위로 전수 대조**한 첫 검증에서 나왔다 — 그전까지 xlsx 검증은 합성 단위 테스트뿐이었고, 실물은 빈 행 잘라내기 성능만 쟀다. ① fast-xml-parser 기본값이 텍스트 셀 `007`→`7`·`1.50`→`1.5`·`1e3`→`1000` 으로 바꾸고, 서식 런(rich text) 경계의 공백·줄바꿈 런을 깎아 `1. 첫째⏎2.`→`1첫째2.` 가 됐다 (한 문서에서 270셀). 코드·사번 앞자리 0이 **경고 없이** 사라지는 종류라 가장 위험했다. .xls는 XML을 안 거쳐 멀쩡했으므로 이 셀들에서 두 포맷 동일성 보장이 깨져 있었는데, 동일성 테스트의 합성 픽스처에 해당 셀이 없어 통과하고 있었다 ② `A1:H3` 같은 병합 아래 행은 그릴 셀이 0개라 건너뛰었는데, 그러면 rowspan이 다음 실제 행을 덮어 내용이 오른쪽으로 밀리고 이후 행이 전부 당겨졌다 (시트 하나가 통째로 어긋남) ③ `0_)`(회계 양식 자릿수 맞춤)가 `2)`로 나왔다. 수정 후 대조 결과: 셀 53,990개 중 불일치 2개(`m, d` 날짜 서식을 ISO로 낸 것 — 의도된 정규화), 병합 표시 1,325개 전부 일치. **테스트는 줄 단위로 비교한다** — 밀린 줄 `\| ↑ \| ↑ \| 프로젝트명 \| …`도 `toContain("\| 프로젝트명 \| …")`를 통과해 처음 쓴 회귀 테스트가 버그를 못 잡았다. 대조 스크립트는 `private/xlsx-check/`(비추적) |
| 2026-10-02 | **엑셀 격자의 앞쪽(위·왼쪽) 빈 행·열도 잘라낸다** (`trimEmptyEdges`) + 죽은 필드 `RenderableSheet.hyperlinkTargets` 제거 | 2026-08-17 결정은 꼬리만 잘랐다. 한국 양식은 A열·1행을 여백으로 비워두는 일이 흔해, 남겨두면 모든 행 앞에 빈 칸이 붙고 **표 머리(GFM 첫 행)가 빈 행**이 된다 — 실물 표본 6시트 중 2시트가 그랬다(수정 후 0). 크기 절감은 작다(0.4%) — 이 변경의 값은 표 머리를 제대로 세우는 데 있다. 좌표에 매달린 병합·가림·숨김·링크를 함께 옮기며, 여백에서 시작해 내용 쪽으로 뻗는 병합은 겹치는 부분으로 시작점을 옮겨 다시 센다. `hyperlinkTargets`는 어느 파서도 채우지 않았는데, 원래 좌표로 채우는 순간 잘라내기 뒤 링크가 엉뚱한 셀에 붙는 구조라 없앴다 — 링크는 파서가 `grid.hyperlinkRels`에 주소로 풀어 두고 좌표 이동은 공용 렌더가 맡는다 |
| 2026-10-02 | **빈 행 정리를 REST(`?removeEmptyRows=true`)·MCP(`removeEmptyRows`)에도 노출** — 응답 직전이 아니라 **저장 전에** 정리하고 옵션을 캐시 키에 섞는다 | 2026-08-19 승격 때 CLI만 배선했다. 응답 직전에 지우면 캐시는 그대로라 간단하지만, conversionId로 다시 읽는 `GET /v1/conversions/:id`·MCP 개요·청크 도구가 정리 안 된 저장본을 봐 같은 id가 경로마다 다른 본문을 낸다 — `includeHidden`(2026-08-16)과 같은 "같은 파일·다른 옵션은 다른 변환" 원칙. 옵션이 없으면 키가 파일 해시 그대로라 기존 캐시 id는 불변(테스트로 고정). 실측(실물 WBS): 빈 표 행 48→0, 문자 −1.7%. 기본값은 계속 끔 |
| 2026-10-03 | **kordoc 제거, `.hwp`(HWP 5.0·3.x·HWPML)는 rhwp(`@rhwp/core` 0.8.6 정확 핀)로 HWPX 를 만든 뒤 자체 HWPX 파서로** — 매직바이트 판별·사전 검사·한국어 오류(`HwpConversionError`)는 자체 구현(`parsers/hwp/`), HWPML 은 버전 거부 시 버전 표기를 고쳐 재시도 | 한컴 HWPX 쌍이 있는 실물 1건에서 rhwp→HWPX 결과가 한컴 저장본과 같았다 — 변환기 차이와 파서 결함을 분리해 볼 수 있다. `.hwp`·`.hwpx` 가 **한 파서**를 타므로 파서 수정이 두 포맷에 동시에 듣는다 (kordoc 경로는 출력 계약이 따로 놀아 GFM 후처리로 맞춰야 했다). 앱 뷰어가 이미 rhwp 라 엔진도 하나로 준다. kordoc 은 OCR 용 선택 의존성(`@huggingface/transformers`·`onnxruntime-node`·`sharp`)을 끌고 와 kordoc 전용 override 3개(adm-zip·sharp·markdown-it)와 감사 대상을 늘렸다 — 함께 지웠다. **위험**: Node 에서 `@rhwp/core` 를 쓰는 것은 비공식이다(`@rhwp/node` 는 철회됨) → 정확 핀 + 계약 테스트(`tests/hwp-rhwp-contract.test.ts` — 우리가 매칭하는 오류 문구·쓰는 API 고정)로 버전 업 때 깨짐을 잡는다. WASM 은 바이트로 init(`fetch` 경로 없음, 오프라인 테스트로 고정), 문서는 반드시 `free()` — WASM 메모리는 줄지 않는다. 수식 변환기만 kordoc 에서 이식(아래 행). CLI 번들 `index.js` 5.7MB→2.6MB |
| 2026-10-03 | **HWPX 파서 결함 교정·보강** (`parsers/hwpx/` 로 분할) — 섹션 XML 은 `parseTagValue: false` + `<hp:t>` stopNode + `captureMetaData` 로 읽어 **`preserveOrder` 없이** 문서 순서를 되살린다. 글머리표·번호·수식 같은 Markdown 마커는 `<hwpx-md>` 전용 요소로 escape 없이 낸다 | XLSX(2026-10-02 행)와 같은 원인이었다 — fast-xml-parser 기본값 `trimValues` 가 run 경계 공백을 깎아 단어가 붙고(가장 큰 표본 811곳 → 3곳), `parseTagValue` 가 `1.0`→`1`·`007`→`7` 로 바꾸고, 혼합 내용(`글<hp:tab/>글`)의 자식 위치를 버려 탭·줄바꿈·인라인 표 순서가 사라졌다. `preserveOrder` 는 트리 모양이 통째로 바뀌어 파서 전부를 다시 써야 하므로, 원문 위치로 이름별 자식들의 순서만 복원했다. 함께 되살린 것: 탭·점선 리더 탭·강제 줄바꿈·고정폭/묶음 빈칸, 엔티티, 글상자, 묶은 그림, 표 캡션, 각주·미주, 하이퍼링크, 변경 추적 삭제분 제외, header 정의대로의 글머리표(실물 490)·NUMBER/OUTLINE 번호(21), 보조 평면 PUA 네모 숫자(U+F02B0~)→원문자, 셀 안 `|` 이중 escape, WMF/EMF 제외 경고, 빈 문서는 오류 대신 빈 결과+경고, `parseBytes`(rhwp 출력이 디스크를 안 거침). turndown 이 `1. `·`- `·`_` 를 escape 하므로 마커는 전용 요소로만 날것을 허용한다 — 일반 텍스트의 escape 는 그대로(테스트 고정). 셀 안 여러 문단을 `" / "` 로 잇는 것은 **의도적으로 유지** — 셀 안 하드 브레이크는 GFM 1행 1줄 계약을 깬다 |
| 2026-10-03 | **한컴 수식 스크립트 → LaTeX 변환기** (`parsers/hwp-equation/`) — HWPX `<hp:script>`(rhwp 가 HWP5 수식도 그대로 옮김)를 인라인 `$…$` 로. 실패하면 원문 스크립트를 인라인 코드로 남기고 경고 | 종전 출력에는 수식이 아예 없었다. kordoc(MIT) 의 `hwpx/equation.ts`·`hwp5/equation.ts` 를 이식하되 토큰 배열 기반으로 다시 썼다 — 원본(문자열 치환)은 최상위 `#` 가 새고, 짝 없는 괄호·`\left` 가 남으면 렌더러가 수식 전체를 버렸다. kordoc 쪽 원본 알고리즘·치환표는 hml-equation-parser(Apache-2.0, Copyright 2018 Open Bapul) 유래라 두 출처를 각 파일 머리말과 `THIRD_PARTY_LICENSES.md` 에 고지한다(§4(b) 변경 사항 포함). `|`·`\|` 는 `\vert`·`\Vert` 로 바꿔 GFM 표 셀을 가르지 않게 하고, `$$` 블록은 표 셀에 못 들어가 늘 인라인. KaTeX 0.16.45 로 무작위 스크립트 60만 건 퍼징 오류 0 (2026-10-03). 앱은 편집 모드(Crepe)에서 수식을 그리고 보기 모드는 아직 원문 |
| 2026-10-03 | **Java(hwp2hwpx) 경로·JRE 번들 제거** — jar·Maven 툴(`tools/hwp-to-hwpx`)·jlink JRE·사이드카 래퍼와 Windows 셰임의 JRE 추출 코드(셰임의 tar·flate2 의존성 포함)·release.yml `build-jar` 잡. 남은 `PAPER_MD_STUDIO_HWP_ENGINE`·`_HWP_JAR` 는 오류 없이 무시 | 제거 직전 마지막 A/B(rhwp·Java·한컴 HWPX 를 같은 파서로)에서 Java 쪽이 더 나빴다 — 점선 리더 탭·글머리표를 잃고 보조 평면 PUA 를 망가뜨렸다. 폴백으로 남기려면 JRE(~45MB)·첫 실행 추출·JitPack 에 기대는 CI 잡을 통째로 유지해야 했다 (GUI 는 번들 JRE 없이는 java 를 못 찾으니 "JRE 없는 폴백"은 성립하지 않는다). 서명 안 한 로컬 `.app` 157.8MB→134.7MB(−14.6%), 업데이트 `.tar.gz` 는 v0.6.0 대비 −37%. **업그레이드한 PC 의 앱 데이터에 풀려 있던 JRE(`com.paper-md-studio.app/jre`·`jre.stamp`)는 정리하지 않는다** — 정리 코드를 넣지 않았고 CHANGELOG 0.7.0 으로 수동 삭제를 안내한다. `.gitignore` 의 JRE·jar 항목은 다른 PC 의 잔여 빌드 산출물(~45MB)이 커밋되지 않게 0.8.0 까지 둔다 |
| 2026-10-03 | **`.hwp` 압축 폭탄 사전 검사** (`parsers/hwp/inflate-guard.ts`·`precheck.ts`) — rhwp 에 넘기기 전에 Node zlib 로 상한을 걸고 모든 스트림을 먼저 풀어 잰다: 스트림당 100MB, 레코드(DocInfo·BodyText·ViewText) 합계 64MB, 문서 합계 512MB. 배포용 문서의 ViewText 는 **복호화해서** 잰다. 대소문자만 다른 중복 스트림은 손상으로 거부 | P0 — rhwp 는 상한 없이 푼다. 270KB 파일 본문을 256MB 의 0 으로 바꾸면 RSS ~3GB 를 잡고 WASM 트랩으로 죽는데, **WASM 메모리는 줄지 않아** 서버·MCP 프로세스가 끝까지 3GB 를 안고 간다(실측). 상한: 스트림당은 실물 최대 34.5MB 의 약 3배이자 kordoc 과 같은 값(예전보다 더 거부하지 않는다), 레코드는 객체로 펼쳐져 증폭이 커서(0 으로 채운 64MB 본문 → RSS 1.2GB) 실물 최대 0.9MB 대비로 따로, 합계는 실물 최대 127.7MB 의 4배. 배포용 플래그(0x04)를 켜고 폭탄을 ViewText 에 넣는 우회를 막으려 복호화를 이식했다(rhwp 가 우리 합성 배포용 문서를 여는 것으로 형식 일치 확인). raw deflate 뿐 아니라 zlib 로 감싼 스트림도 rhwp 가 풀어서 함께 잰다. 중복 스트림은 우리가 잰 것과 rhwp 가 읽는 것이 다를 수 있어 거부. 256MB 폭탄 거부 ~20ms |
| 2026-10-03 | **변환기 개정(`CONVERTER_REVISION`, `core/src/converter-revision.ts`)을 REST·MCP 캐시 키에 섞는다** (server `conversionCacheId`). 입력 탓 `.hwp` 오류(`HwpConversionError` 중 `CONVERSION_FAILED` 제외)는 REST 422 | 키가 "파일 바이트 + 옵션"뿐이라 업그레이드 후에도 kordoc 시절 `.hwp` 결과와 수정 전 `.hwpx` 결과가 캐시에서 그대로 나갈 상황이었다. 키는 여전히 64-hex 라 ID 검증·shard·서명 URL 은 무변경이고, 개정이 바뀌면 기존 캐시는 한 번에 무효가 된다(옛 파일은 지우지 않음). **규칙: 변환 결과(markdown·이미지·경고)를 바꾸는 core 수정을 하면 올린다** — 형식은 날짜, 같은 날 두 번이면 `.2`. 422 는 다시 보내도 같은 결과라 클라이언트가 재시도하지 않게 하려는 것 — 변환기 자체 실패는 500 으로 남긴다 |
| 2026-10-03 | **앱 번들 Node v20.18.0 → v22.23.3 + SHA-256 고정 검증**(`scripts/bundle-node.mjs`), **CLI `beforeExit` 가드**(결과 없이 이벤트 루프가 비면 한국어 오류 + exit 1), **릴리스 워크플로 번들 CLI 스모크 스텝**(`pnpm smoke:cli-bundle`, macOS·Windows, 서명 뒤·tauri-action 전) | 번들 Node 20.18 에서 PDF 대체 엔진(pdf2md — 의존성 unpdf 1.4 에 내장된 PDF.js 5.4)의 promise 가 영영 끝나지 않아(같은 번들을 Node 22 로 돌리면 정상) CLI 가 **오류도 출력도 없이 exit 0** 으로 끝났고 앱에는 "CLI 출력 파싱 실패"만 보였다 — 저장소 `engines` 는 이미 ≥22.13 이었는데 번들 Node 만 따로 놀았다. 빌드·단위 테스트로는 안 잡히는 종류라 출하 그대로 실행해 보는 검사를 릴리스 게이트로 둔다: `resources/cli` 를 저장소 **밖**으로 복사해 번들 Node 로 .hwp·.xls·.pdf(기본·대체 엔진)를 변환한다 — 저장소 안에서는 상위 `node_modules` 가 빠진 파일을 가린다. 릴리스에 그대로 실리는 실행 파일을 내려받기만 하고 있어 체크섬을 고정했다. 22.23.3 macOS 바이너리도 OpenJS Developer ID·hardened runtime·같은 엔타이틀먼트라 공증·서명한 `.node` 로드 조건이 그대로다(로컬 codesign 확인) |
