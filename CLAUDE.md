# CLAUDE.md

이 파일은 Claude Code가 이 저장소 작업 시 참고하는 가이드입니다.

## 프로젝트 개요

paper-md-studio — HWP, HWPX, DOCX, PDF를 Markdown으로 변환·편집하는
크로스플랫폼 데스크톱 앱 (macOS Apple Silicon + Windows 11). CLI-first
접근: 변환 엔진(core)을 먼저 구축하고, 이후 Tauri GUI(app)를 씌웁니다.

## 기술 스택

- **런타임**: Node.js 22+ (HWP 변환 시 Java 11+ 추가 필요)
- **언어**: TypeScript (strict mode)
- **GUI**: Tauri 2.x + React 19 (Phase 3~)
- **에디터**: Milkdown (WYSIWYG) + CodeMirror 6 (소스) — Phase 5~
- **HWP 툴체인**: Maven + `neolord0/hwp2hwpx` (fat jar, Phase 4.5~)
- **빌드**: tsup (core/cli), Vite (app), Maven (tools/hwp-to-hwpx)
- **패키지 매니저**: pnpm (모노레포)
- **린트/포맷**: Biome
- **테스트**: Vitest (unit/integration), Playwright (E2E)

## 프로젝트 구조

```
packages/
├── core/    # 변환 엔진 라이브러리 (@paper-md-studio/core)
│   └── resources/hwp-to-hwpx.jar  # HWP→HWPX Java 툴 (번들)
├── cli/     # CLI 인터페이스 (@paper-md-studio/cli)
└── app/     # Tauri GUI (Phase 3~, @paper-md-studio/app)

tools/
└── hwp-to-hwpx/   # Maven 프로젝트 (neolord0/hwp2hwpx 래퍼)
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

pnpm build:hwp-tool                              # HWP→HWPX Java jar 재빌드
pnpm --filter @paper-md-studio/app sidecar:install    # Tauri sidecar 래퍼 배포
pnpm --filter @paper-md-studio/app tauri dev          # GUI 개발 실행
pnpm --filter @paper-md-studio/app test:e2e           # Playwright E2E
```

## MVP 범위 (v1)

- HWPX → Markdown (`@ssabrojs/hwpxjs`)
- DOCX → Markdown (`mammoth` + `turndown`)
- PDF → Markdown (`@opendocsg/pdf2md`)
- HWP (5.0 바이너리) → HWPX → Markdown (`neolord0/hwp2hwpx` Java 툴체인)
- HTML → Markdown (`@mozilla/readability` + `linkedom` 본문 추출, 로컬 파일·URL·SPA 렌더링)

v2 후순위: DOC(레거시, Phase 8)

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
| 2026-04-13 | `neolord0/hwp2hwpx` (Java, Apache-2.0) 채택 | `HWPReader → Hwp2Hwpx → HWPXWriter` 단순 API, 활발한 유지보수 |
| 2026-04-13 | JitPack + 커밋 SHA 핀닝 | 배포 태그 부재, 재현성 확보 |
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
| 2026-08-03 | **MD → HWPX 역방향 변환 보류** (`archive/md-to-hwpx` 태그로 보존 후 브랜치 파기) | 표 처리가 현실적 장벽. rhwp 0.8.2 의 표 API 위에 병합·열너비를 얹어도 한컴 양식의 중첩·병합 구조를 감당하지 못했음. MD 변환 품질 개선에 집중하기로 전환. 재개 시 `git checkout archive/md-to-hwpx` |
| 2026-08-03 | PDF 보정을 pdf2md **앞뒤 두 지점**에 배치 (`pdf-text-runs.ts` / `pdf-postprocess.ts`) | 한글 워드프로세서가 굵은 글씨를 "같은 텍스트 0.1pt 씩 밀어 23번 겹쳐 그리기"로 표현해 `제안요청서`가 23번 반복됐고, pdf2md `LineConverter`가 숫자 경계마다 런을 끊어 공백으로 재결합해 `제21조`→`제 21 조`가 됐음. 둘 다 텍스트 런 단계에서만 고칠 수 있어 `pageParsed` 콜백으로 개입. 목차 오인식·점선 리더는 줄 단위 판단이라 출력 후처리로 분리 |
| 2026-08-03 | 겹침 판정 허용오차에 **절대 하한 2pt** 부여 | 공백 글리프는 `height` 가 0이라 비율(25%)만 쓰면 허용오차가 0이 되어 중복 공백 런이 살아남고, 그게 pdf2md 의 각주 판정(`y > firstY`)에 걸려 `^` 가 새로 생겼음 |
| 2026-08-04 | macOS Developer ID 서명 + 공증 도입 (tauri-action `APPLE_*` 시크릿, 법인 계정 P4S6KATL7C) | Gatekeeper `xattr -cr` 우회 안내 제거. 번들된 Node(OpenJS 서명)·JRE(tar.gz 내부)는 재서명 없이 공증 통과 확인 (2026-08-04 로컬 실측). 시크릿 목록·갱신 절차는 `docs/RELEASE.md` |
| 2026-08-07 | **kordoc 4.7.2 채택** (정확 핀, `^` 금지) — XLSX·XLS·HWP3·HWPML 변환 위임, `.hwp` 매직바이트 3분기(HWP3·HWPML→kordoc, OLE2→기존 Java) | 순수 TS·MIT·오프라인 1급 지원(`KORDOC_OFFLINE=1` 기본 강제, fetch 지점 2곳 실측). `parsers/kordoc-adapter.ts` 1곳 격리 + 계약 테스트(`tests/kordoc-adapter.test.ts`). 통합 로드맵·작업지시서는 `docs/kordoc-integration.md` |
