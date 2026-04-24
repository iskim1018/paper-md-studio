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
| [`@paper-md-studio/mcp`](packages/mcp) | MCP 서버 (베타) · Claude Desktop / Antigravity · 3툴 (convert / outline / chunk) | Node stdio 서버 |

코어 변환 엔진은 [`@paper-md-studio/core`](packages/core) 에 모여 있으며 위 4 패키지가 재사용합니다.

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

- `POST /v1/convert` — **두 가지 입력**: (1) `multipart/form-data` 파일 업로드 (2) `application/json { "url": "..." }` 원격 URL fetch (SSRF 방어 포함). 응답: Markdown + 4 가지 이미지 전달 모드 (`urls` / `inline` / `refs` / `omit`)
- `GET /v1/conversions/:id/images/:name?exp=&sig=` — HMAC signed URL 로 이미지 다운로드
- `GET /docs` — Swagger UI · OpenAPI 3.1
- `X-API-Key` 인증 (선택) · HMAC-SHA256 저장

```bash
# 파일 업로드
curl -X POST http://localhost:3000/v1/convert -F "file=@report.pdf"

# 원격 URL (서버가 fetch)
curl -X POST http://localhost:3000/v1/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/report.pdf"}'
```

자세한 내용: [`docs/REST_API.md`](docs/REST_API.md) · [`docs/CONFIG.md`](docs/CONFIG.md)

### MCP 서버 (베타, v0.1.0 MVP)

`@paper-md-studio/mcp` 는 [Model Context Protocol](https://modelcontextprotocol.io) 로 Claude Desktop · Cursor · **Google Antigravity** 같은 MCP 클라이언트에 문서 변환 기능을 노출합니다. LLM 이 원본 바이너리를 토큰으로 소비하지 않고, 변환된 Markdown 이나 특정 섹션만 받아 **컨텍스트를 50배 이상 절감**할 수 있습니다.

> **대화 기반 UX 원칙**: MCP 프로토콜에는 파일 업로드 primitive 가 없고 AI 서비스 채팅 UI 도 통제할 수 없으므로, 본 서버는 자체 드롭존/데스크톱 연동을 제공하지 않습니다. LLM 에게 파일 **경로** 또는 **URL** 을 대화로 전달하면 `convert_document` 가 호출됩니다. 팀/원격 공유가 필요하면 REST API 의 URL 모드를 사용하세요.

**MVP 3툴**:
- `convert_document` — 원본(path/url/base64) → Markdown + outline, SHA-256 content-hash 캐시
- `get_document_outline` — conversionId → 헤딩 트리만 반환 (수백 토큰)
- `get_document_chunk` — anchor / headingPath / range 로 섹션만 추출 + prev/next 이웃

전송은 **stdio** (Claude Desktop / Antigravity 기본값). 실행 모드는 2 가지:
- **embedded** (기본) — MCP 서버가 core 를 직접 import. `path`/`url`/`base64` 모두 지원. 혼자 쓰는 용도.
- **remote** — MCP 서버가 REST 서버로 HTTP 프록시. `url`/`base64` 만 지원 (로컬 path 불가). 팀 공유·외부 에이전트·n8n 등 자동화용.

자세한 내용: [`docs/MCP.md`](docs/MCP.md)

#### 1) 빌드 & 절대경로 확인

```bash
pnpm install
pnpm --filter @paper-md-studio/core --filter @paper-md-studio/server --filter @paper-md-studio/mcp build

# 등록용 절대경로 (복사해두기)
node -e "console.log(require('path').resolve('packages/mcp/dist/bin.js'))"
#   /Users/you/projects/docs-to-md/packages/mcp/dist/bin.js
```

> Java 11+ 는 `.hwp` 변환 시에만 필요합니다 (`java -version` 으로 확인). `.docx` / `.pdf` / `.hwpx` 만 테스트한다면 없어도 됩니다.

#### 2) Claude Desktop 연동

**config 파일 위치**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**embedded 모드 (기본, 로컬 혼자 사용)**
```json
{
  "mcpServers": {
    "paper-md": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/paper-md-studio/packages/mcp/dist/bin.js"
      ],
      "env": {
        "PAPER_MD_MCP_STORAGE": "/Users/YOU/.paper-md-studio/mcp-storage",
        "PAPER_MD_MCP_LOG": "info"
      }
    }
  }
}
```

**remote 모드 (팀 REST 서버 연결)**
```json
{
  "mcpServers": {
    "paper-md": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/paper-md-studio/packages/mcp/dist/bin.js"
      ],
      "env": {
        "PAPER_MD_MCP_MODE": "remote",
        "PAPER_MD_MCP_REST_URL": "https://papermd.your-team.internal",
        "PAPER_MD_MCP_API_KEY": "your-api-key"
      }
    }
  }
}
```
- remote 모드는 `input.path` 거부 (로컬 파일 불가). URL 이나 base64 만 사용.
- `images=inline` 은 remote 에서 미지원 — `refs` (기본) 또는 `omit` 사용.

Claude Desktop 을 **완전히 재시작** 하면 하단 `🔧` 아이콘에 3 개 툴이 노출됩니다. 예시 대화:

> "첨부한 PDF 의 목차만 보여줘" → `convert_document` → `get_document_outline`
>
> "3 번째 섹션만 읽어줘" → `get_document_chunk`

#### 3) Google Antigravity 연동

Antigravity 도 MCP 표준을 따르므로 **동일한 JSON 구조**로 등록합니다. IDE 의 MCP 설정 패널(또는 `mcp.json`) 에 아래를 추가하세요.

```json
{
  "mcpServers": {
    "paper-md": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/paper-md-studio/packages/mcp/dist/bin.js"
      ],
      "env": {
        "PAPER_MD_MCP_STORAGE": "/Users/YOU/.paper-md-studio/mcp-storage"
      }
    }
  }
}
```

Antigravity 를 재시작하거나 "Reload MCP Servers" 를 실행하면 3 개 툴이 활성화됩니다. Cursor · Zed · Windsurf 등 다른 MCP 클라이언트도 같은 구조를 지원합니다.

> 경로에 한글 · 공백이 섞여 있어도 동작하지만 절대경로를 권장합니다. 상대경로는 클라이언트마다 해석이 달라 실패할 수 있습니다.

#### 4) MCP Inspector 로 직접 검증 (권장)

클라이언트에 등록하기 전에 [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) 로 서버 단독 동작을 먼저 확인할 수 있습니다.

```bash
npx @modelcontextprotocol/inspector node packages/mcp/dist/bin.js
```

브라우저가 열리면:
1. **Connect** → `initialize` 자동 실행
2. **Tools 탭** → 3 개 툴 노출 확인
3. `convert_document` 호출:
   ```json
   {
     "input": { "path": "/ABSOLUTE/PATH/TO/paper-md-studio/packages/core/tests/fixtures/sample.docx" },
     "images": "refs"
   }
   ```
   응답의 `conversionId` 를 복사해 두세요.
4. `get_document_outline` → 같은 `conversionId` 입력 → 헤딩 트리 확인
5. `get_document_chunk` → `conversionId` + outline 에서 본 `anchor` 입력 → 섹션만 반환 확인
6. 같은 파일로 다시 `convert_document` 호출 → 응답의 `cached: true`, `elapsedMs < 100` 확인 (캐시 히트)

stderr 에 JSON 로그가 흐르고 stdout 은 JSON-RPC 전용이어야 합니다 (프로토콜 오염 방지).

#### 5) 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PAPER_MD_MCP_STORAGE` | `~/.paper-md-studio/mcp-storage` | 변환 결과 캐시 루트 (SHA-256 샤딩) |
| `PAPER_MD_MCP_MAX_UPLOAD_MB` | `50` | 단일 입력 최대 크기 (path/url/base64 공통) |
| `PAPER_MD_MCP_MAX_INLINE_KB` | `512` | `images=inline` 모드에서 개별 이미지 최대 크기 |
| `PAPER_MD_MCP_LOG` | `info` | `silent` / `error` / `warn` / `info` / `debug` — 항상 **stderr** 로 출력 |

> 서버 동작이 이상해 보이면 캐시를 비우세요: `rm -rf ~/.paper-md-studio/mcp-storage`

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
- ✅ Phase 9 (진행 중) — REST API: 변환 · 캐시 · 4 이미지 모드 · Signed URL · API Key · OpenAPI · URL 입력 (SSRF 방어)
- 🚧 Phase 10 (MVP 완료) — MCP 서버: embedded + remote + stdio + 3툴 (Claude Desktop / Antigravity). search / 이미지 Resources / HTTP 전송 등은 후속
- 📋 Phase 11 — 운영 확장 (Redis · S3 · OAuth · BullMQ · 메트릭)

## 라이선스

MIT License — [`LICENSE`](LICENSE) 참고.

번들된 의존성의 라이선스는 [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) 에 정리돼 있습니다.
