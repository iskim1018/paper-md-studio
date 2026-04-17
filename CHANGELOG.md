# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/) 형식을 따릅니다.

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
