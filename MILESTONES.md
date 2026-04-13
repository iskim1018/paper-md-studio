# Milestones

## 전체 흐름

```
Phase 0 ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4 ──> Phase 4.5 ──> Phase 5 ──> Phase 6 ──> Phase 7
스캐폴딩    CLI 변환     이미지      Tauri GUI    원본 뷰어    HWP 지원     MD 에디터    배치 처리    패키징

(v2) Phase 8: DOC(레거시) 지원
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
- [x] CLI로 `docs-to-md <파일>` 실행 가능
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
- [x] `docs-to-md sample.hwp` 실행 시 Markdown 생성 성공 (513ms, 이미지 1개 추출)
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

## Phase 6: 배치 처리

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 6-1 | 배치 변환 큐 (Web Worker Pool) | M | ⬜ |
| 6-2 | 배치 진행률 UI | M | ⬜ |
| 6-3 | 출력 디렉토리 선택 | S | ⬜ |
| 6-4 | 변환 취소/재시도 | M | ⬜ |
| 6-5 | 대용량 파일 최적화 | L | ⬜ |

---

## Phase 7: 폴리싱 & 패키징

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 7-1 | macOS 앱 아이콘 | S | ⬜ |
| 7-2 | DMG 패키징 설정 | M | ⬜ |
| 7-3 | 코드 서명 & 공증 (Notarization) | L | ⬜ |
| 7-4 | E2E 테스트 (Playwright) | L | ⬜ |
| 7-5 | 성능 프로파일링 | M | ⬜ |
| 7-6 | README/CLAUDE.md 최종화 | S | ⬜ |
| 7-7 | npm 보안 감사 최종 실행 | S | ⬜ |

---

## (v2) Phase 8: DOC(레거시) 지원

HWP는 Phase 4.5에서 선행 지원됨.

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 8-1 | DOC → DOCX 변환 (macOS textutil 또는 LibreOffice headless) | M | ⬜ |
| 8-2 | 뷰어/에디터 통합 | M | ⬜ |
