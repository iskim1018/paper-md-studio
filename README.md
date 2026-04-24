<div align="center">
  <img src="packages/app/src-tauri/icons/logo.png" alt="Paper MD Studio" width="128" height="128" />

  # Paper MD Studio

  HWP · HWPX · DOCX · DOC · PDF 를 Markdown 으로 **변환 · 편집 · 서빙** 하는 크로스플랫폼 도구

  [![CI](https://github.com/iskim1018/paper-md-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/iskim1018/paper-md-studio/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
</div>

---

## 구성

이 저장소는 세 가지 배포 형태를 한 모노레포에서 제공합니다.

| 패키지 | 설명 | 배포 형태 |
|--------|------|-----------|
| [`@paper-md-studio/app`](packages/app) | Tauri 2.x 데스크톱 앱 — 드래그 앤 드롭 변환 + 내장 MD 에디터 + 배치 처리 | macOS DMG / Windows NSIS·MSI |
| [`@paper-md-studio/cli`](packages/cli) | 커맨드라인 변환기 | Node 런타임 + 단일 파일 번들 |
| [`@paper-md-studio/server`](packages/server) | REST API 서버 (베타) · content-hash 캐시 · OpenAPI | Node 프로세스 · Fastify |

코어 변환 엔진은 [`@paper-md-studio/core`](packages/core) 에 모여 있으며 위 3 패키지가 재사용합니다.

## 데스크톱 앱 — 다운로드 & 설치

[GitHub Releases](https://github.com/iskim1018/paper-md-studio/releases) 에서 최신 버전을 받습니다.

| 플랫폼 | 파일 |
|--------|------|
| macOS (Apple Silicon) | `Paper MD Studio_0.1.0_aarch64.dmg` |
| Windows (x64) | `Paper MD Studio_0.1.0_x64-setup.exe` 또는 `.msi` (예정) |

### macOS 설치 안내

Apple Developer 인증서로 서명되지 않았으므로 Gatekeeper 경고가 표시됩니다. 아래 중 하나로 실행합니다.

**방법 1 — 터미널에서 격리 속성 제거**
```bash
xattr -cr "/Applications/Paper MD Studio.app"
```

**방법 2 — 시스템 설정에서 허용**
1. 앱을 처음 열면 차단 경고 표시
2. **시스템 설정 → 개인정보 보호 및 보안**
3. 하단 "확인 없이 열기" 클릭

## 특징

### 변환
- **5 포맷**: HWP · HWPX · DOCX · DOC · PDF → Markdown
- **이미지 자동 추출** — 표 셀 내부 이미지까지 포함 (HWPX)
- **한글 파일명 안전** — macOS NFD 자동 정규화
- **캐시 (서버)** — SHA-256 content-addressed, 동일 파일 재변환 제거

### 데스크톱 앱
- **드래그 앤 드롭 + 다중 선택** — 체크박스 · Cmd/Ctrl/Shift 모디파이어
- **배치 변환** — 동시성 5, 실시간 진행바, 취소/재시도
- **원본 뷰어** — PDF 는 pdfjs, DOCX/HWPX 는 HTML 변환 후 sandboxed 렌더
- **내장 MD 에디터** — 4 모드 (보기 · 편집 WYSIWYG · 소스 · 분할)
- **빈 테이블 행 정리** — 1-click + 1-step undo
- **전체화면 토글** — 결과 패널 (Cmd/Ctrl+Shift+F)
- **저장 단축키** — Cmd/Ctrl+S 덮어쓰기, Cmd/Ctrl+Shift+S 다른 이름으로
- **다크모드** — 시스템/라이트/다크 순환, localStorage 영속화

### REST API 서버 (베타)

`@paper-md-studio/server` 는 코어 변환 엔진을 HTTP 로 노출합니다. 외부 서비스/에이전트가 문서를 업로드하면 Markdown 을 반환.

- `POST /v1/convert` — multipart 업로드, Markdown 반환, 4 가지 이미지 전달 모드 (`urls` / `inline` / `refs` / `omit`)
- `GET /v1/conversions/:id/images/:name?exp=&sig=` — HMAC signed URL 로 이미지 다운로드
- `GET /docs` — Swagger UI · OpenAPI 3.1
- `X-API-Key` 인증 (선택) · HMAC-SHA256 저장

자세한 내용: [`docs/REST_API.md`](docs/REST_API.md) · [`docs/CONFIG.md`](docs/CONFIG.md)

## 빠른 시작

```bash
# 저장소 클론
git clone https://github.com/iskim1018/paper-md-studio.git
cd paper-md-studio

# 의존성 설치
pnpm install

# 전체 빌드
pnpm build

# 테스트 · 린트 · 타입체크
pnpm test
pnpm lint
pnpm typecheck
```

### CLI

```bash
paper-md-studio 문서.hwp            # HWP → HWPX → MD (Java 11+ 필요)
paper-md-studio document.hwpx
paper-md-studio report.docx -o ./output
paper-md-studio paper.pdf --images-dir assets
paper-md-studio --help
```

### 데스크톱 앱 (개발 모드)

```bash
# 사전 요구사항: Rust 툴체인, Xcode Command Line Tools
#               (HWP 변환 시) Java 11+
pnpm --filter @paper-md-studio/app sidecar:install  # 최초 1회
pnpm --filter @paper-md-studio/app tauri dev
```

### REST API 서버

```bash
# 개발 모드 (파일 수정 시 자동 재빌드)
pnpm --filter @paper-md-studio/server dev
# → http://localhost:3000
#    http://localhost:3000/docs  (Swagger UI)
```

**curl 로 빠른 확인:**
```bash
curl http://localhost:3000/v1/health
curl -X POST http://localhost:3000/v1/convert \
  -F "file=@packages/core/tests/fixtures/sample.docx" | jq
```

## 지원 형식

| 형식 | 확장자 | 비고 |
|------|--------|------|
| 한글 (HWP 5.0 바이너리) | `.hwp` | Java 11+ 필요 (hwp2hwpx 경유) |
| 한글 (HWPX) | `.hwpx` | 표 셀 내부 이미지까지 추출 |
| Word | `.docx` | mammoth + turndown |
| Word (레거시) | `.doc` | LibreOffice 필요 (macOS fallback: textutil) |
| PDF | `.pdf` | 텍스트 추출 (이미지 미지원) |

## HWP 변환 툴체인 재빌드 (개발자용)

`packages/core/resources/hwp-to-hwpx.jar` 는 저장소에 포함돼 있습니다. 직접 재빌드하려면:
```bash
pnpm build:hwp-tool   # Maven + JitPack (초기 수 분)
```
환경변수 `PAPER_MD_STUDIO_HWP_JAR` 로 커스텀 jar 경로 지정 가능.

## 기술 스택

- **TypeScript** (strict) · **Node.js 20+** · **pnpm** 모노레포
- **Biome** 린트 · **Vitest** 유닛/통합 · **Playwright** E2E
- **Tauri 2.x** + **React 19** (데스크톱 앱)
- **Milkdown** (WYSIWYG) + **CodeMirror 6** (소스) + **react-resizable-panels** (분할)
- **Fastify 5** + **Zod** + **@fastify/swagger** (REST API 서버)
- **Java 11+** / Maven / `neolord0/hwp2hwpx` (HWP 선변환)

## 로드맵

주요 구현 현황은 [`MILESTONES.md`](MILESTONES.md) 참고.

- ✅ Phase 1~8 — CLI · 이미지 추출 · GUI · 뷰어 · HWP · 에디터 · 배치 · 패키징 · DOC 레거시
- ✅ Phase 9 (진행 중) — REST API: 변환 · 캐시 · 4 이미지 모드 · Signed URL · API Key · OpenAPI
- 📋 Phase 10 — MCP 서버 (Claude Desktop / Cursor 연동)
- 📋 Phase 11 — 운영 확장 (Redis · S3 · OAuth · BullMQ · 메트릭)

## 기여

이슈와 PR 모두 환영합니다. 작업 전 [`CLAUDE.md`](CLAUDE.md) 의 코딩 규칙(네이밍 · 파일 구조 · 한글 파일명 처리 · 테스트 요구)을 훑어봐 주세요.

## 라이선스

MIT License — [`LICENSE`](LICENSE) 참고.

번들된 의존성의 라이선스는 [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) 에 정리돼 있습니다.
