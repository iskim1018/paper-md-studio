# Milestones

## 전체 흐름

```
Phase 0 ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4/5 (병렬) ──> Phase 6 ──> Phase 7
스캐폴딩    CLI 변환     이미지      Tauri GUI    뷰어/에디터         배치 처리    패키징
                                                  
(v2) Phase 8: HWP + DOC 지원
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
| 3-1 | Tauri 2.x + React + Vite 초기화 (packages/app) | M | ⬜ |
| 3-2 | 3-panel 레이아웃 (파일목록 / 뷰어 / 에디터) | M | ⬜ |
| 3-3 | 드래그 앤 드롭 + 파일 유효성 검증 | M | ⬜ |
| 3-4 | Zustand 파일 상태 관리 | S | ⬜ |
| 3-5 | core 패키지 통합 (Tauri IPC → 변환 실행) | L | ⬜ |
| 3-6 | 변환 진행률 UI | M | ⬜ |
| 3-7 | Tailwind CSS + shadcn/ui 설정 | M | ⬜ |

**완료 기준**:
- [ ] 파일 드롭 → 변환 → MD 결과 표시

---

## Phase 4: 원본 파일 뷰어

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 4-1 | PDF 뷰어 (pdfjs-dist + canvas) | M | ⬜ |
| 4-2 | DOCX 뷰어 (mammoth → HTML 렌더링) | M | ⬜ |
| 4-3 | HWPX 뷰어 (HTML 변환 후 표시) | L | ⬜ |
| 4-4 | 원본/변환 결과 비교 뷰 | M | ⬜ |
| 4-5 | 줌/스크롤/페이지 네비게이션 | M | ⬜ |

---

## Phase 5: MD 에디터

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 5-1 | Milkdown WYSIWYG 에디터 통합 | M | ⬜ |
| 5-2 | CodeMirror 6 소스 편집 모드 | M | ⬜ |
| 5-3 | 편집/미리보기/분할 모드 전환 | M | ⬜ |
| 5-4 | 파일 저장 (Cmd+S) | M | ⬜ |
| 5-5 | 다크모드 지원 | S | ⬜ |

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

## (v2) Phase 8: HWP + DOC 지원

| # | 태스크 | 복잡도 | 상태 |
|---|--------|--------|------|
| 8-1 | HWP 바이너리 파서 (베스트 에포트) | L | ⬜ |
| 8-2 | DOC → DOCX 변환 (macOS textutil) | M | ⬜ |
| 8-3 | 뷰어/에디터 통합 | M | ⬜ |
