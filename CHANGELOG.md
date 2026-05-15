# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/) 형식을 따릅니다.

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
