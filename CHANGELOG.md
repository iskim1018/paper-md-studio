# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/) 형식을 따릅니다.

## [0.4.2] - 2026-07-23

### 수정

- GUI에서 폴더를 드래그 앤 드롭하면 인식하지 못하던 문제 — 폴더 열기와
  동일하게 하위 폴더까지 재귀 스캔(깊이 8·최대 500파일)해 지원 문서를
  추가하도록 수정. 드롭 오버레이 안내 문구에 폴더 지원 명시

## [0.4.1] - 2026-07-23

### 수정

- HWPX 한컴 보조 평면 PUA-A(U+F0000~) 기호가 깨져 보이던 문제 — 한/글이
  Plane 15 사설영역에 저장하는 기호(삼각형 불릿 ▶◀▲▼, 수식 괄호 조각,
  음표 등) 57건을 표준 유니코드로 정규화 (함초롬바탕 글리프 비트맵 대조로
  자동 생성 + 시각 검증). 매핑에 없는 코드는 원본 유지

## [0.4.0] - 2026-07-23

### 추가

- **HTML → Markdown 변환** — 지원 포맷에 HTML 추가
  - 로컬 `.html`/`.htm` 파일 및 http(s) URL 입력 지원
  - `@mozilla/readability` + `linkedom` 기반 본문 추출 (nav·사이드바·푸터·광고
    제거, 실패 시 전체 폴백, `--no-extract`로 비활성)
  - SPA 렌더링 (`--render`): 시스템 Chrome으로 JS 렌더링 후 DOM 캡처
    (`playwright-core` optionalDependency, `--wait-selector`/`--timeout` 지원)
  - 원격 이미지 다운로드 (`--download-images`): `{문서명}_images/`에 저장,
    실패 시 원본 URL 유지, 문서당 50개 한도
  - SSRF 방어: `safeFetch`를 core로 승격해 URL fetch·이미지 다운로드·SPA
    sub-resource 요청까지 사설 대역 차단
- **블로그 플랫폼 대응** — 네이버 블로그 등 iframe 껍데기 페이지의 본문
  프레임 자동 추적, 본문 컨테이너 힌트 셀렉터(SmartEditor·티스토리·
  `itemprop=articleBody`), lazy-load 이미지 원본 승격, zero-width 문자 제거
- **앱: URL 변환 + 원본 미리보기** — 파일 목록에 URL 입력(🔗), 변환 전
  "추출된 본문 미리보기" 표시 (사이드카 `--html` + DOMPurify)
- **앱: 파일 탐색기·폴더 열기** — 네이티브 다이얼로그로 파일 다중 선택,
  폴더 선택 시 하위 폴더를 재귀 스캔해 트리로 표시 (기본 접힘, 전체
  펼침/닫힘 토글, 폴더 체크박스로 하위 전체 일괄 선택)

### 수정

- HWPX 체크박스 등 PUA 심볼 문자(U+F0xx)가 보이지 않던 버그 — Wingdings
  계열 12개 코드를 유니코드(■ □ ☑ ✓ 등)로 정규화
- 배포 번들 빌드가 `playwright-core` 포함 시도로 실패하던 문제
- CLI `--version`이 구버전(v0.1.0)을 출력하던 문제

### 보안

- pnpm audit 취약점 34건 해결 (`undici`, `vite`, `hono`, `dompurify`,
  `esbuild`, `fast-uri` 등 — `pnpm.overrides`로 패치)
- HTML sanitize: 제어문자 난독화 `javascript:` URI 우회 차단, `data:`는
  이미지만 허용

## [0.3.0] - 2026-05-15

### 추가

- **Cmd/Ctrl+F 통합 검색** — 모든 편집/뷰어 영역에서 일관된 단축키
  - Markdown 소스 편집기 (CodeMirror): 매치 하이라이트 + 다음/이전 이동
  - WYSIWYG 미리보기 (Milkdown) 및 미리보기 패널: DOM 텍스트 검색
  - DOCX 원본 뷰어: HTML 텍스트 검색 + 자동 스크롤
  - HWPX 원본 뷰어: rhwp 문서 트리(본문 + 표 셀 + 중첩 표 셀)를 직접 순회한
    텍스트 인덱스 기반. SVG 좌표로 하이라이트 오버레이
  - 검색바는 상단 고정, 재오픈 시 자동 포커스

- **Markdown 파일 직접 등록** — `.md` 파일 D&D 시 변환 큐를 거치지 않고
  즉시 자동 로드 (변환 skip + 원본 미리보기 placeholder)

### 수정

- HWPX 표 안 표(table-in-cell) 변환 누락 — 셀 내부 중첩 `<hp:tbl>`을
  인라인 평탄화 (`(표 R×C) 행1셀1 | 행1셀2 / ...` 형식, 깊이 5단)
- HWPX 표 colSpan/rowSpan 병합 셀 누락 — grid normalize로 빈 셀 padding
- 소스 편집기 매 키 입력마다 재마운트되어 입력 누락·undo 실패하던 문제
- `.md` 자동 로드가 spinner에서 멈추던 버그
- HWPX 뷰어에서 Cmd+F 검색바 미표출 / 스크롤 시 사라짐 / 재오픈 포커스 안 감

### 보안

- pnpm audit 취약점 4건 해결 (`fast-uri`, `fast-xml-builder`, `hono`,
  `ip-address` — 모두 transitive 의존, `pnpm.overrides`로 패치)

## [0.2.0] - 2026-04-17

### 추가

- **DOC (레거시 Word) 지원** (Phase 8)
  - `.doc` (Word 97-2003) 파일을 DOCX로 선변환 후 Markdown으로 변환
  - LibreOffice headless를 1순위 변환 도구로 사용 (크로스플랫폼, 이미지 보존)
  - macOS에서 LibreOffice 미설치 시 textutil fallback (텍스트만 변환)
  - `PAPER_MD_STUDIO_LIBREOFFICE` 환경변수로 커스텀 경로 지정 가능
  - App에서 `.doc` 파일 드래그 앤 드롭 + 뷰어 + 배치 변환 지원

## [0.1.0] - 2026-04-16

첫 번째 릴리스. HWP/HWPX/DOCX/PDF를 Markdown으로 변환하고 편집하는 데스크톱 앱.

### 추가

- **문서 변환** (Phase 1~2)
  - HWPX → Markdown (표, 스타일, 이미지 추출 포함)
  - DOCX → Markdown (mammoth + turndown)
  - PDF → Markdown (텍스트 추출)
  - HWP 5.0 바이너리 → HWPX → Markdown (Java hwp2hwpx 경유)
  - 이미지 추출: `{문서명}_images/` 디렉토리에 저장, 상대경로 참조
  - HWPX 볼드/이탈릭/취소선 스타일 변환

- **CLI** (Phase 1)
  - `paper-md-studio <파일>` 커맨드라인 변환
  - `--output`, `--images-dir`, `--html` 옵션
  - 한글 파일명 NFD→NFC 정규화 (macOS 대응)

- **Tauri 데스크톱 앱** (Phase 3~7)
  - 드래그 앤 드롭 파일 등록
  - 3패널 레이아웃: 파일 목록 / 원본 뷰어 / 변환 결과
  - 원본 뷰어: PDF (Canvas), DOCX/HWPX (HTML 렌더링)
  - 4-모드 에디터: 보기 / 편집(WYSIWYG) / 소스(CodeMirror) / 분할
  - `Cmd/Ctrl+S` 덮어쓰기, `Cmd/Ctrl+Shift+S` 다른 이름으로 저장
  - `Cmd/Ctrl+Shift+F` 결과 패널 전체화면 토글
  - 시스템/라이트/다크 테마 전환 (localStorage 영속화)
  - 배치 변환: 다중 파일 동시성 5 병렬 처리
  - 출력 디렉토리 선택 (설정 영속화)
  - 실패 파일 개별/일괄 재시도
  - 멀티 셀렉트 (체크박스 + Cmd/Shift 모디파이어)
  - 파일 충돌 프롬프트 (덮어쓰기/다른 이름/취소)
  - 빈 테이블 행 정리 + 1-step 취소

- **패키징** (Phase 7)
  - macOS Apple Silicon (.dmg) + Windows x64 (.msi) 배포
  - 번들 Node 런타임 (v20.18.0)
  - 번들 최소 JRE (jlink, HWP 변환용)
  - GitHub Actions CI/Release 파이프라인

### 알려진 제한사항

- PDF 이미지 추출 미지원
- DOC (레거시 Word) 미지원 (v2 예정)
- macOS: Apple Developer 인증서 미서명 (ad-hoc), Gatekeeper 우회 필요
- Windows: WebView2 런타임 자동 다운로드 (첫 실행 시)
