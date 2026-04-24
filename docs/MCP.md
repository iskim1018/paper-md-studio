# paper-md-studio MCP 서버

`@paper-md-studio/mcp` — Claude Desktop / Cursor / 기타 MCP 클라이언트에서 HWP·HWPX·DOCX·DOC·PDF 문서를 Markdown 으로 변환하고 부분 조회할 수 있게 해주는 [Model Context Protocol](https://modelcontextprotocol.io) 서버입니다.

> **왜 MCP 인가?** LLM 이 문서 바이너리를 직접 토큰으로 먹지 않고, 변환된 Markdown 이나 섹션만 소비하게 하면 **토큰 50배 이상 절감**이 가능합니다. 같은 파일은 SHA-256 해시 기반 캐시로 1회만 변환됩니다.

## MCP 첨부 UX 한계 (중요)

MCP 프로토콜은 JSON-RPC 기반으로 **파일 업로드 primitive 가 없습니다**. Claude Desktop · Cursor · Antigravity 모두 채팅창의 파일 첨부는 클라이언트 자체 파서가 처리하므로 MCP 서버가 가로챌 방법이 없습니다. 즉 "채팅에 HWP 를 드래그하면 자동 변환" UX 는 **불가능**합니다.

본 서버는 **대화 기반** 으로 설계되었습니다. LLM 에게 아래처럼 지시하면 `convert_document` 툴이 호출됩니다:

- `"/Users/me/Downloads/report.hwp 변환해줘"` → `path` 입력
- `"이 URL 문서의 목차 보여줘: https://example.com/report.pdf"` → `url` 입력
- base64 바이트 직접 전달 (특수 상황)

자체 UI(드롭존/데스크톱 앱)는 의도적으로 제공하지 않습니다 — AI 서비스 채팅 UI 를 저희가 통제할 수 없으므로, 대화로 가능한 범위에서만 제공합니다. 팀/원격 공유가 필요하면 REST API 의 `POST /v1/convert` URL 모드(`{"url":"..."}`) 를 사용하세요.

## 지원 기능 (MVP)

| 툴 | 설명 |
|----|------|
| `convert_document` | 원본 → Markdown 변환 + outline 반환. path / url / base64 입력 지원. |
| `get_document_outline` | 이미 변환된 문서의 헤딩 트리만 조회 (수백 토큰). |
| `get_document_chunk` | anchor / headingPath / range 로 특정 섹션만 추출. |

후속 작업(예정): `search_document` (BM25), 이미지 Resources, `list_conversions`, Streamable HTTP 전송.

## 실행 모드: embedded vs remote

| 모드 | 설명 | 지원 입력 | 실행 장소 |
|------|------|-----------|----------|
| **embedded** (기본) | `@paper-md-studio/core` 를 MCP 서버 프로세스에 직접 import | `path` · `url` · `base64` | 유저 로컬 PC |
| **remote** | REST API 서버로 HTTP 프록시 | `url` · `base64` (**path 불가**) | MCP 서버와 REST 서버가 분리됨 |

### embedded 모드 (기본)

혼자 Claude Desktop / Antigravity 에서 쓸 때. 변환 결과가 로컬 스토리지 (`PAPER_MD_MCP_STORAGE`) 에 캐시됨. JVM 은 `.hwp` 변환 시에만 필요.

### remote 모드

팀 공유 서버 · 외부 에이전트 · n8n 같은 자동화. 구조:

```
Claude Desktop ──stdio── MCP 서버(remote) ──HTTPS── REST 서버 ──── core 변환 + 캐시
   (유저 PC)               (유저 PC)                (서버)
```

**장점**: 팀원들이 같은 캐시·저장소 공유. REST 서버 1 대만 유지.
**제약**:
- `input.path` **거부** — 원격 MCP 는 유저 로컬 FS 를 못 읽음. `url` 또는 `base64` 사용.
- `images=inline` **미지원** — 바이트 전송 비용 커서 MVP 제외. `refs` (기본) 또는 `omit` 사용.

#### Claude Desktop config (remote 예시)

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
        "PAPER_MD_MCP_REST_URL": "https://papermd.internal.team",
        "PAPER_MD_MCP_API_KEY": "your-key-here"
      }
    }
  }
}
```

REST 서버는 `@paper-md-studio/server` 를 별도 호스트에서 실행하세요 (환경변수 `API_KEYS` 설정 권장).

## 설치

### 1. 빌드 (저장소 내)

```bash
pnpm install
pnpm --filter @paper-md-studio/core --filter @paper-md-studio/server --filter @paper-md-studio/mcp build
```

결과: `packages/mcp/dist/bin.js` — `#!/usr/bin/env node` shebang 포함 실행 파일.

### 2. 의존 런타임

- **Node.js 20+** — MCP 서버 자체
- **Java 11+** — `.hwp` 변환 시에만 필요 (시스템 PATH 에서 `java` 탐지)
- **LibreOffice** — `.doc` 변환 시에만 필요 (macOS 는 `textutil` fallback 사용 가능)

## Claude Desktop 등록

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "paper-md": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/docs-to-md/packages/mcp/dist/bin.js"
      ],
      "env": {
        "PAPER_MD_MCP_STORAGE": "/Users/YOU/.paper-md-studio/mcp-storage",
        "PAPER_MD_MCP_MAX_UPLOAD_MB": "50",
        "PAPER_MD_MCP_LOG": "info"
      }
    }
  }
}
```

재시작하면 Claude Desktop 의 툴 목록에 `convert_document` · `get_document_outline` · `get_document_chunk` 가 노출됩니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PAPER_MD_MCP_MODE` | `embedded` | `embedded` (로컬 core 직접) / `remote` (REST 프록시) |
| `PAPER_MD_MCP_REST_URL` | — | **remote 필수** — REST 서버 베이스 URL (예: `http://localhost:3000`) |
| `PAPER_MD_MCP_API_KEY` | — | **remote 선택** — REST 서버 `X-API-Key` 값 (서버 `API_KEYS` 설정 시 필요) |
| `PAPER_MD_MCP_STORAGE` | `~/.paper-md-studio/mcp-storage` | **embedded 전용** — 변환 결과 캐시 루트 (SHA-256 샤딩) |
| `PAPER_MD_MCP_MAX_UPLOAD_MB` | `50` | 단일 입력 최대 크기 (path/url/base64 공통) |
| `PAPER_MD_MCP_MAX_INLINE_KB` | `512` | `images=inline` 모드에서 개별 이미지 최대 크기 (embedded 전용) |
| `PAPER_MD_MCP_FETCH_TIMEOUT_MS` | `120000` | **remote 전용** — REST 호출 타임아웃 (ms) |
| `PAPER_MD_MCP_LOG` | `info` | `silent` / `error` / `warn` / `info` / `debug`. **항상 stderr 로 출력** (stdout 은 MCP 프로토콜 채널) |

## 툴 사용 예시

### `convert_document`

```jsonc
// Request
{
  "name": "convert_document",
  "arguments": {
    "input": { "path": "/Users/me/docs/report.pdf" },
    "images": "refs"
  }
}
```

`images` 모드:
- `"refs"` (기본) — Markdown 내 이미지 링크를 `conv://{conversionId}/images/{name}` URI 로 치환. LLM 이 필요할 때만 이미지를 fetch.
- `"inline"` — `data:image/png;base64,...` 로 치환. `PAPER_MD_MCP_MAX_INLINE_KB` 초과 시 오류.
- `"omit"` — 이미지를 `_[이미지: alt]_` placeholder 로 대체. 텍스트만 필요할 때.

응답 예시:
```json
{
  "conversionId": "a3f1...ef9",
  "format": "pdf",
  "cached": false,
  "elapsedMs": 842,
  "markdown": "# 보고서\n\n...",
  "images": [
    { "name": "img_001.png", "mimeType": "image/png", "size": 24856, "uri": "conv://a3f1.../images/img_001.png" }
  ],
  "outline": [
    { "level": 1, "text": "보고서", "anchor": "보고서" },
    { "level": 2, "text": "요약", "anchor": "요약" }
  ]
}
```

### `get_document_outline`

```jsonc
{
  "name": "get_document_outline",
  "arguments": { "conversionId": "a3f1...ef9" }
}
```

### `get_document_chunk`

Anchor 기반 (outline 결과에서 얻은 `anchor` 값 사용):
```jsonc
{
  "name": "get_document_chunk",
  "arguments": { "conversionId": "a3f1...ef9", "anchor": "요약" }
}
```

Heading path 기반 (`["부모 제목", ..., "대상 제목"]`):
```jsonc
{
  "name": "get_document_chunk",
  "arguments": {
    "conversionId": "a3f1...ef9",
    "headingPath": ["보고서", "2장 분석", "2.3 결론"]
  }
}
```

Line range (0-indexed):
```jsonc
{
  "name": "get_document_chunk",
  "arguments": {
    "conversionId": "a3f1...ef9",
    "range": { "start": 0, "end": 40 }
  }
}
```

응답에는 `neighbors.prev`/`neighbors.next` 가 포함되어 순차 탐색이 가능합니다.

## 입력 방법 3종

| 방식 | 사용 시점 | 주의 |
|------|-----------|------|
| `input.path` | Claude Desktop 로컬 파일 | 절대경로 권장. macOS NFD 한글 자동 NFC 정규화. |
| `input.url` | HTTP(S) 원본 | `content-length` / 실제 바이트 모두 검증. |
| `input.base64` | 바이너리 직접 전달 | `filename` 옵션으로 확장자 추론 필수. |

## 오류 메시지 (한국어)

| 상황 | 메시지 |
|------|--------|
| Java 미설치 + `.hwp` 변환 | `java 실행 파일을 찾을 수 없습니다...` (core 전달) |
| LibreOffice 미설치 + `.doc` | `LibreOffice/soffice 를 찾을 수 없습니다...` (core 전달) |
| `path`/`url`/`base64` 누락 | `path / url / base64 중 하나는 반드시 지정해야 합니다.` |
| 크기 한도 초과 | `파일이 최대 업로드 한도(50.00MB)를 초과했습니다: 73.12MB` |
| 잘못된 `conversionId` | `conversionId 를 찾을 수 없습니다: ...` |
| inline 모드 한도 초과 | `인라인 이미지 중 한도(512KB)를 초과한 항목이 있습니다: ...` |

## 수동 검증 (MCP Inspector)

```bash
pnpm --filter @paper-md-studio/mcp build
npx @modelcontextprotocol/inspector node packages/mcp/dist/bin.js
```

브라우저에서:
1. `convert_document` 호출 → `conversionId` 기록
2. `get_document_outline` → 헤딩 트리 확인
3. `get_document_chunk` → anchor 로 섹션 조회

## 캐시 삭제

```bash
rm -rf ~/.paper-md-studio/mcp-storage
```

또는 `PAPER_MD_MCP_STORAGE` 를 바꾸면 새로운 캐시 공간이 생깁니다.
