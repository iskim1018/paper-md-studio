# Milestones

## 전체 흐름

```
Phase 0 ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4 ──> Phase 4.5 ──> Phase 5 ──> Phase 6 ──> Phase 7
스캐폴딩    CLI 변환     이미지      Tauri GUI    원본 뷰어    HWP 지원     MD 에디터    배치 처리    패키징

(v2) Phase 8: DOC(레거시) 지원
(v3) Phase 9 ──> Phase 10 ──> Phase 11
     REST API     MCP 서버     운영 확장
```

---

## Phase 0: 프로젝트 스캐폴딩 ✅

| # | 태스크 | 상태 |
|---|--------|------|
| 0-1 | pnpm 모노레포 구조 초기화 (core/cli) | ✅ |
| 0-2 | Biome 설정 (lint + format) | ✅ |
| 0-3 | Vitest 설정 | ✅ |
| 0-4 | Git 초기화 + .gitignore | ✅ |
| 0-5 | CLAUDE.md 작성 | ✅ |
| 0-6 | README.md 초안 | ✅ |
| 0-7 | .claude/settings.json (hooks, permissions) | ✅ |
| 0-8 | .claude/skills (convert-test, security-check, doc-update) | ✅ |
| 0-9 | MILESTONES.md 작성 | ✅ |
| 0-10 | Git pre-commit hook 설정 (lefthook) | ✅ |

---

## Phase 1: CLI 변환 엔진

**목표**: HWPX, DOCX, PDF를 Markdown으로 변환하는 CLI 도구 완성

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 1-1 | 변환 파이프라인 인터페이스 설계 | M | ✅ |
| 1-2 | Turndown + GFM 플러그인 공통 포매터 | S | ✅ |
| 1-3 | HWPX 파서 구현 (@ssabrojs/hwpxjs → HTML → Turndown → MD) | M | ✅ |
| 1-4 | DOCX 파서 구현 (mammoth → HTML → Turndown → MD) | M | ✅ |
| 1-5 | PDF 파서 구현 (@opendocsg/pdf2md → MD) | M | ✅ |
| 1-6 | CLI 명령어 검증 (parseArgs 기반) | M | ✅ |
| 1-7 | 각 포맷별 테스트 (실제 파일 fixture) | M | ✅ |
| 1-8 | MD 출력 스펙 문서화 (GFM 기준) | S | ✅ |

**의존성**: 1-1 → 1-2 → (1-3, 1-4, 1-5 병렬) → 1-6 → 1-7

**완료 기준**:
- [x] 3개 포맷 각각 실제 파일로 변환 성공
- [x] CLI로 `paper-md-studio <파일>` 실행 가능
- [x] 각 포맷별 최소 1개 테스트 통과

---

## Phase 2: 이미지 추출 & 관리

**목표**: 문서 내 이미지를 추출하여 별도 저장하고 MD에서 참조

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 2-1 | 이미지 저장 디렉토리 전략 구현 ({문서명}_images/) | S | ✅ |
| 2-2 | HWPX 이미지 추출 | M | ✅ |
| 2-3 | DOCX 이미지 추출 (mammoth convertImage 핸들러) | M | ✅ |
| 2-4 | PDF 이미지 추출 | M | ✅ (미지원 문서화) |
| 2-5 | CLI --images-dir 옵션 통합 | S | ✅ |
| 2-6 | 이미지 추출 테스트 | M | ✅ |

**완료 기준**:
- [x] 이미지 포함 문서 변환 시 이미지 파일 추출
- [x] MD 내 `![alt](./images/img_001.png)` 참조 정상 동작

---

## Phase 3: Tauri GUI 셸

**목표**: 드래그 앤 드롭으로 파일을 받아 변환하는 기본 GUI

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 3-1 | Tauri 2.x + React + Vite 초기화 (packages/app) | M | ✅ |
| 3-2 | 3-panel 레이아웃 (파일목록 / 뷰어 / 에디터) | M | ✅ |
| 3-3 | 드래그 앤 드롭 + 파일 유효성 검증 | M | ✅ |
| 3-4 | Zustand 파일 상태 관리 | S | ✅ |
| 3-5 | core 패키지 통합 (Tauri sidecar → 변환 실행) | L | ✅ |
| 3-6 | 변환 진행률 UI | M | ✅ |
| 3-7 | Tailwind CSS v4 설정 | M | ✅ |

**완료 기준**:
- [x] 파일 드롭 → 변환 → MD 결과 표시

---

## Phase 4: 원본 파일 뷰어 ✅

**목표**: PreviewPanel을 원본 문서 뷰어로 전환, 포맷별 렌더링

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 4-1 | PDF 뷰어 (pdfjs-dist + canvas, 페이지/줌 컨트롤) | M | ✅ |
| 4-2 | DOCX 뷰어 (mammoth → HTML + DOMPurify + blob URL 이미지) | M | ✅ |
| 4-3 | HWPX 뷰어 (CLI --html sidecar + DOMPurify) | L | ✅ |
| 4-4 | 원본/변환 결과 비교 뷰 (기존 3패널이 비교 구조) | S | ✅ |
| 4-5 | 줌/스크롤/페이지 네비게이션 | M | ✅ |

**주요 변경사항**:
- core에 `convertToHtml()` 함수 추가, CLI에 `--html` 옵션 추가
- Tauri fs 플러그인 통합 (파일 바이너리 읽기)
- PreviewPanel: 포맷별 뷰어 자동 선택 + 접이식 메타데이터

**완료 기준**:
- [x] PDF 파일 선택 시 Canvas 기반 페이지 렌더링 + 네비게이션
- [x] DOCX/HWPX 파일 선택 시 HTML 변환 후 sanitized 렌더링
- [x] 단위 테스트 10개 + E2E 테스트 업데이트

---

## Phase 4.5: HWP 지원 (hwp2hwpx 선변환) ✅

**목표**: `.hwp` 바이너리 파일을 Java 툴체인으로 `.hwpx`로 선변환한 뒤 기존 HWPX 파이프라인에 태워 지원 포맷에 포함시킨다.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 4.5-1 | `tools/hwp-to-hwpx/` Maven 프로젝트 스캐폴딩 (JitPack 기반 neolord0/hwp2hwpx 의존성 + main class + maven-shade-plugin fat jar) | M | ✅ |
| 4.5-2 | `packages/core/src/parsers/hwp-parser.ts` 프리프로세서 (java 탐지 → child_process.spawn → tmp HWPX → HwpxParser 위임) | M | ✅ |
| 4.5-3 | jar 경로 resolver 및 `packages/core/resources/hwp-to-hwpx.jar` 번들링, pipeline.ts 포맷 등록 | S | ✅ |
| 4.5-4 | CLI `.hwp` 지원 + help 메시지 + core 유닛/통합 테스트 (fixture: sample.hwp) | M | ✅ |
| 4.5-5 | Tauri app `.hwp` 확장자 허용 + Java 미설치 안내 UI | S | ✅ |

**결정 로그**:
- **라이브러리**: `neolord0/hwp2hwpx` (Apache-2.0) — `HWPReader` → `Hwp2Hwpx.toHWPX` → `HWPXWriter` 3-step API. 내부적으로 `kr.dogfoot.hwplib` + `kr.dogfoot.hwpxlib` 사용
- **의존성 해결**: JitPack (`com.github.neolord0:hwp2hwpx`) — Maven Central 미배포, 커밋 SHA 고정
- **런타임**: 시스템 `java` 탐지 (Phase 7에서 `jlink` 번들링 수용 예정)
- **HWPX 이미지 표 셀 추출 버그** (2026-04-13 수정): 9개 중 8개 누락 → `parseCellText`에 `ImageCollector` 전달하여 해결

**완료 기준**:
- [x] `paper-md-studio sample.hwp` 실행 시 Markdown 생성 성공 (513ms, 이미지 1개 추출)
- [x] Tauri app에서 `.hwp` 드롭 → 변환 결과 표시
- [x] Java 미설치 환경에서 명확한 한국어 안내 메시지
- [x] 추가 부가 수정: 뷰어 DOMPurify가 data/blob URI를 제거하던 문제 수정 (Phase A)

---

## Phase 5: MD 에디터 ✅

**목표**: 변환된 Markdown을 그 자리에서 편집·저장. 4개 보기 모드 + 저장 단축키 + 다크모드.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 5-1 | Milkdown WYSIWYG 에디터 통합 (+ 스토어 editing 상태) | M | ✅ |
| 5-2 | CodeMirror 6 소스 편집 모드 | M | ✅ |
| 5-3 | 편집/미리보기/분할 모드 전환 (react-resizable-panels) | M | ✅ |
| 5-4 | 파일 저장 (Cmd/Ctrl+S 덮어쓰기 / Shift+S 다른 이름) | M | ✅ |
| 5-5 | 다크모드 지원 (system/light/dark 순환 + localStorage 영속화) | S | ✅ |

**결정 로그**:
- **WYSIWYG 엔진**: Milkdown Crepe 7.20 (React 19 호환, CommonMark + GFM 기본)
- **소스 편집기**: CodeMirror 6 (lang-markdown, history, oneDark 테마, lineNumbers + lineWrapping)
- **dirty 전략**: `editedMarkdown` 필드와 원본 `result.markdown` 비교. `setEditedMarkdown` 호출 시 자동 계산
- **Undo/Redo**: 각 에디터 내장 히스토리 재사용 (모드 전환 시 초기화 허용)
- **다크모드**: `data-theme` 속성으로 CSS 변수 오버라이드, `prefers-color-scheme` 미디어 쿼리와 공존

**완료 기준**:
- [x] 4-모드 토글 (보기/편집/소스/분할) 정상 전환
- [x] Milkdown WYSIWYG 편집 시 dirty 인디케이터 표시
- [x] CodeMirror 소스 편집에서 Cmd+Z undo 동작
- [x] Cmd/Ctrl+S 덮어쓰기, Cmd/Ctrl+Shift+S 다른 이름 저장
- [x] 헤더 테마 토글이 localStorage에 영속화
- [x] Unit/Integration 110 passed, E2E 24 passed (Phase 5 신규 24개 포함)

---

## Phase 5.5: MD 에디터 UX 개선 ✅

**목표**: Phase 5 에디터 사용자 피드백을 반영한 UX/안정성 개선.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 5.5-1 | SourceEditor 스크롤 안 되던 버그 (cm-scroller overflow) | S | ✅ |
| 5.5-2 | 결과 패널 전체화면 토글 (헤더 버튼 + Cmd/Ctrl+Shift+F) | S | ✅ |
| 5.5-3 | 모드 의미 재정의: 보기=react-markdown, 분할=소스+렌더 | M | ✅ |
| 5.5-4 | HWPX 셀 다중 paragraph를 단일 라인으로 flatten (테이블 안전성) | M | ✅ |
| 5.5-5 | 빈 테이블 행 일괄 정리 + 정리 취소(1-step undo) | M | ✅ |
| 5.5-6 | 툴바/배너/푸터 sticky 고정 (shrink-0 + min-h-0) | S | ✅ |
| 5.5-7 | 빈 행 정리 시 구분선 앞 헤더 row 보존 (테이블 구조 유지) | S | ✅ |

**결정 로그**:
- **보기 모드 렌더러**: react-markdown + remark-gfm (Milkdown readOnly보다 순수 렌더링 우월, GFM 테이블/체크박스 내장)
- **분할 모드**: 좌측을 Milkdown → SourceEditor로 교체해 "편집=WYSIWYG / 분할=소스+프리뷰"로 의도 분리
- **하드 브레이크 전략**: GFM 테이블 셀 내 `  \n`이 구조를 깨뜨리므로 `parseCellText`는 항상 단일 라인으로 flatten, 3+ paragraph는 `" / "` 구분자 사용
- **빈 행 정리 헤더 보존**: 구분선 바로 앞 row는 비어있어도 GFM 문법상 필수 → lookahead로 보존
- **1-step undo**: 정리 버튼 클릭 전 상태를 `cleanupSnapshot`에 저장, 수동 편집 발생 시 자동 무효화

**완료 기준**:
- [x] 긴 문서를 소스/편집 모드에서 스크롤해도 툴바·배너·푸터 항상 보임
- [x] Cmd/Ctrl+Shift+F로 결과 패널 전체화면 전환
- [x] 보기 모드에서 Markdown이 렌더된 HTML로 표시 (pre 원문 아님)
- [x] 분할 모드 좌측 SourceEditor, 우측 MarkdownPreview 실시간 동기화
- [x] HWPX 테이블이 셀 안 하드 브레이크로 깨지지 않음
- [x] "빈 행 정리" 1-click → 구분선 앞 헤더 row 보존 + body 빈 row 제거 + "정리 취소" 배너
- [x] Unit/Integration 124 passed (신규 14개 포함), lint/typecheck clean

---

## Phase 6: 배치 처리 ✅ (6-5 deferred)

**목표**: 다중 파일을 동시성 5로 병렬 변환하고 진행률·취소·재시도·출력 폴더를 제공.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 6-1 | 배치 변환 큐 (worker pool 패턴, 동시성 5) | M | ✅ |
| 6-2 | 배치 진행률 UI (BatchProgress: done/total + %) | M | ✅ |
| 6-3 | 출력 디렉토리 선택 (localStorage 영속화) | S | ✅ |
| 6-4 | 변환 취소/재시도 (큐 레벨 cancel + 개별/일괄 재시도) | M | ✅ |
| 6-5 | 대용량 파일 최적화 | L | ⏸ deferred (사용자 실측 후) |
| 6-6 | 멀티 셀렉트 (체크박스 + Cmd/Shift 모디파이어) | M | ✅ |
| 6-7 | HWPX 스타일 변환 강화 (bold/italic/strike) | M | ✅ |

**결정 로그**:
- **동시성 5 고정**: 슬라이더 없이 시작 (사용자 요청), 기본값 `navigator.hardwareConcurrency` 대신 단순 상수
- **취소 전략**: 큐 레벨 cancel만 (pending 폐기 + running은 끝까지). sidecar 강제 kill은 Phase 7+로 연기
- **출력 폴더**: settings-store에서 `outputDir: string | null` 관리, `null`=원본과 같은 폴더
- **자동 변환 X**: 드롭 시 자동 시작하지 않고 "변환" 버튼 명시 클릭
- **멀티 셀렉트 중첩 순서**: `<strong>` > `<em>` > `<del>` 고정, 상태 전환 시 모든 태그 close/reopen (연속 같은 스타일은 그대로 merge)
- **취소선 detection**: `<strikeout shape="..."/>` allowlist (SOLID/DOT/DASH/DASH_DOT/... 12종). `shape="3D"`는 HWP의 text effect placeholder이므로 비적용

**주요 버그 수정 이력**:
- `3e0b539`: 멀티 셀렉트 추가 (체크박스 + 단축키)
- `ddd8ccd`: 편집/보기 모드 타이포그래피 통일 (Milkdown + react-markdown)
- `86871ce`: HWPX 취소선 변환 지원 (bold와 동일 패턴)
- `943efc4`: 연속 동일 스타일 run 병합 (`**t1****t2**` → `**t1t2**`)
- `6c13f82`: 취소선 `shape="NONE"` 인식
- `2c97a71`: 취소선 shape allowlist 도입 (`3D` 오탐 해결)
- `dfffdf5`: 이탈릭 지원 추가

**완료 기준**:
- [x] 다중 파일을 드롭 → "변환" 클릭 → 5개씩 병렬 처리
- [x] 진행 바에 실시간 done/total · % 표시
- [x] 출력 폴더 변경 시 모든 변환에 반영되고 재시작 후에도 유지
- [x] 실패 파일 재시도 (개별 + "실패 N개 재시도" 일괄)
- [x] 체크박스 다중 선택으로 부분 변환 ("선택 N개 변환")
- [x] 행 클릭 + Cmd/Ctrl/Shift 모디파이어 표준 동작
- [x] HWPX bold/italic/strike 정확 변환 (오탐 0)
- [x] Unit 157 passed, E2E 18 batch + 17 editor + 기존 파일 인터랙션

---

## Phase 7: 폴리싱 & 패키징

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 7-A | 전체 리네임 `docs-to-md` → `paper-md-studio` (패키지 scope, Tauri 메타, Rust crate, 런타임 식별자, LICENSE, 문서) | M | ✅ |
| 7-B | Tauri 제품 메타데이터 보강 (productName, identifier, category, long/shortDescription, macOS minSystemVersion, Windows webviewInstallMode) | S | ✅ |
| 7-C | Windows sidecar wrapper (.cmd) + 번들 JRE/jar 탐지 + `install-sidecar.mjs` OS 분기 | M | ✅ |
| 7-D | jlink로 HWP 변환용 최소 JRE 번들 (45.5MB, `build:jre`) | M | ✅ |
| 7-E | 배포 번들 파이프라인: Node 런타임(90MB) + CLI tsup 단일 파일(2.2MB, ESM+createRequire) + JRE tar.gz 아카이브 + sidecar wrapper 배포 모드 + ESM sentinel `package.json` | L | ✅ |
| 7-F | 다크 모드에서 Milkdown 편집기 배경 오버라이드 (frame-dark 변수 덮어쓰기) | S | ✅ |
| 7-G | 파일 충돌 프롬프트 (동일 이름 .md 존재 시 덮어쓰기/다른 이름/취소), CLI `--output` .md 경로 지원, 큐 skip 집계, "초기화" 버튼이 progress bar까지 리셋, 툴바 버튼 flex-wrap+whitespace-nowrap | M | ✅ |
| 7-H | macOS 앱 아이콘 교체 (`tauri icon source.png` 세트 재생성) | S | ✅ |
| 7-I | Windows MSI/NSIS 빌드 검증 (GitHub Actions windows-latest) | M | ✅ (release.yml matrix로 통합) |
| 7-J | GitHub Actions CI/Release matrix (macOS + Windows, tag push 자동 릴리스) | M | ✅ |
| 7-K | macOS Gatekeeper 우회 가이드 + ad-hoc 코드사인 (Apple Developer 멤버십 없음) | S | ✅ |
| 7-L | README / DEVELOPMENT.md / CHANGELOG 최종화 | S | ✅ |
| 7-M | THIRD_PARTY_LICENSES.md (Milkdown, hwp2hwpx, Node, Temurin, 기타 의존성) | S | ✅ |
| 7-N | E2E 회귀 테스트 (Playwright, 배포 빌드 대상) | L | ✅ (playwright.prod.config.ts) |
| 7-O | 성능 프로파일링 (대용량 HWPX/PDF, 배치 변환) | M | ⏸ deferred (v0.1.1) |
| 7-P | npm 보안 감사 최종 실행 (dompurify ^3.4.0 패치 적용) | S | ✅ |

### Phase 7 결정 로그

| 날짜 | 결정 | 근거 |
|------|------|------|
| 2026-04-14 | 이름 `paper-md-studio` 확정 | "종이 문서를 마크다운으로 편집"이라는 도구 성격을 직관적으로 표현 |
| 2026-04-15 | JRE를 tar.gz로 묶어 번들 후 첫 실행 시 앱 데이터 디렉토리로 추출 | Tauri resource walker가 jlink 생성물의 `legal/*` 심볼릭 링크/권한을 처리하지 못해 "Permission denied" 실패 → 디렉토리째 번들 불가 |
| 2026-04-15 | CLI 번들 = tsup ESM + createRequire banner + `{"type":"module"}` sentinel | mammoth/pdf2md 등 CJS 의존성을 ESM 단일 파일로 묶되 Node의 CJS 로더로 잘못 로드되지 않게 타입 명시 |
| 2026-04-15 | 아이콘 서명은 ad-hoc + Gatekeeper 우회 가이드로 대체 | Apple Developer 멤버십 미보유, 개인 배포 시나리오만 요구됨 |

---

## Phase 8: DOC(레거시) 지원 ✅

**목표**: `.doc` (Word 97-2003) 파일을 DOC→DOCX 선변환 후 기존 DocxParser에 위임하여 Markdown으로 변환.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 8-1 | DocParser 구현 (LibreOffice headless 1순위, macOS textutil fallback) + 타입/파이프라인 등록 | M | ✅ |
| 8-2 | CLI `.doc` 지원 + help 텍스트 + App 뷰어/파일스토어/배지 통합 | M | ✅ |
| 8-3 | 테스트 (포맷 등록 검증 + file-store .doc 수용 + doc-parser.test.ts) | S | ✅ |

**결정 로그**:
- **변환 도구**: LibreOffice headless를 1순위 사용 (크로스플랫폼, 이미지 보존). macOS에서 LibreOffice 미설치 시 textutil fallback (이미지 손실).
- **번들링 안 함**: LibreOffice는 300MB+ → 시스템 설치 요구 (Java와 동일 전략)
- **환경변수**: `PAPER_MD_STUDIO_LIBREOFFICE`로 커스텀 경로 지정 가능
- **뷰어**: HwpxViewer 재사용 (CLI sidecar --html 경유, DOC→DOCX→HTML)

**완료 기준**:
- [x] pipeline이 `.doc` 확장자를 지원 포맷으로 인식
- [x] App에서 `.doc` 파일 드래그 앤 드롭 허용 + 배지 표시
- [x] Unit 159 passed (신규 2개 포함), 기존 테스트 전부 통과
- [x] LibreOffice 미설치 환경에서 명확한 한국어 안내 메시지

---

## Phase 9: REST API 서버 🚧

**목표**: `@paper-md-studio/core`를 HTTP로 노출하여 외부 서비스/에이전트가 문서를 Markdown으로 변환하도록 지원. content-addressed 캐시로 재변환 비용을 제거하고 Phase 10 MCP의 토큰 절감 기반을 마련한다.

**브랜치**: `feat/phase9-rest-api` · **계획 문서**: `.claude/plan/phase9-rest-api.md` (로컬 전용)

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 9-1  | `packages/server` 스캐폴딩 (Fastify 5 + Zod + tsup + Vitest) | S | ✅ |
| 9-2  | `StorageAdapter` 인터페이스 + `LocalFsStorage` 구현 (SHA-256 content-addressed) | M | ✅ |
| 9-3  | `ConvertCache` (core 래핑 + 캐시 히트·미스 로깅) | M | ✅ |
| 9-4  | `POST /v1/convert` 동기 엔드포인트 + Zod 스키마 + 멀티파트 업로드 | M | ✅ |
| 9-5  | `?images=` 분기 (inline / urls / refs / omit; zip 제거) | M | ✅ |
| 9-6  | HMAC signed URL 유틸 (발급·검증, 15분 만료) | S | ✅ |
| 9-7  | `GET /v1/conversions/:id/images/:name` 다운로드 핸들러 | S | ✅ |
| 9-8  | 비동기 잡: 인메모리 큐 + `POST/GET /v1/conversions` | M | ⏳ |
| 9-9  | SSE 진행률 (`GET /v1/conversions/:id/events`) | M | ⏳ |
| 9-10 | API Key 미들웨어 (`X-API-Key`, HMAC-SHA256 저장소) | S | ✅ |
| 9-11 | 레이트리밋 (`@fastify/rate-limit`, IP+API Key) | S | ⏳ |
| 9-12 | OpenAPI 자동 생성 + `/docs` Swagger UI | S | ✅ |
| 9-13 | 업로드 한계·MIME 검증 | S | ✅ |
| 9-14 | 통합 테스트 (5 포맷 × 5 이미지 모드, `fastify.inject`) | L | ⏳ |
| 9-15 | 캐시 히트 테스트 (같은 파일 재업로드 elapsed 비교) | S | ✅ (9-4 convert.test.ts 에서 커버) |
| 9-16 | Dockerfile (Node 20 + JRE 11 + HWP jar) | M | ⏳ |
| 9-17 | `docs/REST_API.md` 레퍼런스 + curl 예제 | S | ✅ |
| 9-18 | `.env.example` + `CONFIG.md` | S | ✅ |
| 9-19 | CI 워크플로우 업데이트 | S | ⏳ |

**설계 결정 요약**:
- **이미지 처리**: Hybrid — `?images=` 쿼리로 5가지 모드 선택, 기본값 `urls`(signed URL). MCP 전용 `refs` 모드 별도.
- **캐시 키**: `sha256(file_bytes)` 64자 hex. 동일 파일 재업로드 시 파싱 스킵.
- **스토리지**: `StorageAdapter` 인터페이스로 추상화 → Phase 11에서 S3/R2 어댑터 교체.
- **동기/비동기**: 작은 문서는 `POST /v1/convert` 즉시 응답, HWP·대용량은 202 Accepted + SSE 진행률.
- **인증**: MVP는 `X-API-Key`만. OAuth/JWT는 Phase 11.

**완료 기준**:
- [ ] 5개 포맷 × 5개 이미지 모드 통합 테스트 그린
- [ ] 동일 파일 재업로드 시 캐시 히트 (elapsed < 50ms)
- [ ] OpenAPI `/docs` 접근 가능
- [ ] Docker 이미지에서 HWP 변환 성공
- [ ] API Key 없이 401, 레이트 초과 시 429

### Phase 9 결정 로그

| 날짜 | 결정 | 근거 |
|------|------|------|
| 2026-04-20 | Phase 9+ 는 **장기 feature 브랜치 전략** 채택 (`feat/phase9-rest-api`, `feat/phase10-mcp-server`, `feat/phase11-ops`) | Phase 8까지 main 직접 작업과 달리, 서버 패키지 도입은 변경 범위가 크고 검증 주기가 길어 main을 항상 릴리스 가능 상태로 유지해야 함 |
| 2026-04-23 | Phase 9-1/9-2 를 `main`으로 fast-forward 병합 (3 commits) | 스캐폴딩·StorageAdapter는 독립 가치가 있고 리스크 낮음. 나머지 9-3~9-19 는 main 에서 계속 진행 |
| 2026-04-23 | Phase 4/5 historical 플랜 문서를 `.claude/plan/archive/` 로 이동 | 완료된 Phase 의 설계 문서는 기록 용도로 격리, 현역 로드맵(`README.md`, `phase9/10/11.md`)과 시야 분리 |

---

## Phase 10: MCP 서버 📋

**목표**: Phase 9의 REST API 위에(또는 core 직접 호출 모드로) MCP 서버를 제공하여 Claude Desktop/Cursor 등 LLM 클라이언트가 원본 바이너리(HWPX/DOCX/HWP/DOC/PDF)를 **토큰으로 직접 먹지 않고** 변환된 Markdown만 소비하도록 지원. outline/chunk/search로 부분 조회하여 컨텍스트 비용을 추가 절감한다.

**브랜치**: `feat/phase10-mcp-server` · **계획 문서**: `.claude/plan/phase10-mcp-server.md`

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 10-1  | `packages/mcp` 스캐폴딩 (`@modelcontextprotocol/sdk`, stdio + HTTP, bin 엔트리) | S | 📋 |
| 10-2  | `StorageAdapter` 공용화 (server→shared) + core 직접 호출 어댑터 | M | 📋 |
| 10-3  | Outline 추출 유틸 (MD heading 트리) | S | 📋 |
| 10-4  | `convert_document` 툴 (refs 기본 모드) | M | 📋 |
| 10-5  | `get_document_outline` 툴 | S | 📋 |
| 10-6  | `get_document_chunk` 툴 (anchor/heading path slice) | M | 📋 |
| 10-7  | BM25 검색 엔진 + `search_document` 툴 | M | 📋 |
| 10-8  | 이미지 Resources 노출 (`conv://{id}/images/...`) | M | 📋 |
| 10-9  | `list_conversions` 툴 | S | 📋 |
| 10-10 | Remote 모드 (REST 프록시 + API Key) | M | 📋 |
| 10-11 | Streamable HTTP 전송 (Fastify에 MCP 라우트 부착) | M | 📋 |
| 10-12 | 통합 테스트 (MCP Inspector / in-memory transport) | L | 📋 |
| 10-13 | 토큰 절감 벤치마크 스크립트 | M | 📋 |
| 10-14 | Claude Desktop/Cursor 등록 가이드 (`docs/MCP.md`) | S | 📋 |
| 10-15 | CI: `packages/mcp` 빌드·테스트 추가 | S | 📋 |

**토큰 절감 목표** (10MB HWPX 기준):
- 원본 바이너리 LLM 투입: 불가
- `convert_document` 전체 MD: ≈15,000 토큰
- `get_document_outline`만: ≈300 토큰 (**50배 절감**)
- `search_document(q, topK=3)`: ≈1,500 토큰 (**10배 절감**)
- content-hash 캐시로 재파싱 비용 0

**완료 기준**:
- [ ] Claude Desktop에서 `convert_document` 호출 성공
- [ ] 5개 툴 모두 동작 (convert/outline/chunk/search/list)
- [ ] 토큰 벤치마크: outline vs full 10배 이상 차이 입증
- [ ] 같은 `conversionId` 재호출 < 100ms

---

## Phase 11: 운영 확장 📋 (후순위)

**목표**: Phase 9/10 MVP를 프로덕션 품질로 끌어올린다. Phase 9/10 완료 후 실사용 패턴을 보고 우선순위를 재조정한다.

**브랜치**: `feat/phase11-ops` · **계획 문서**: `.claude/plan/phase11-ops-hardening.md`

| 영역 | 주요 태스크 |
|------|-------------|
| 인증 | OAuth2 / JWT (스코프: `convert:read`, `convert:write`) |
| 스토리지 | `S3StorageAdapter` + 프리사인드 URL |
| 큐 | BullMQ + Redis 영속 큐 (워커 분리) |
| 관측 | Prometheus `/metrics` + OpenTelemetry 트레이싱 |
| 캐시 GC | 크론 기반 LRU/TTL, 용량 상한 |
| 배포 | Fly.io/Railway 템플릿, Helm 차트(옵션) |
| 한글 검색 | mecab-ko / kiwi-nlp 품질 개선 |
| 비용 대시보드 | MCP 토큰 절감 실측 대시보드 |
| 로드 테스트 | k6/autocannon + 튜닝 |
| 보안 감사 | OWASP API Top 10 점검 |
