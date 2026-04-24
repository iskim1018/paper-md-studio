# paper-md-studio REST API

`@paper-md-studio/server` 는 `@paper-md-studio/core` 의 변환 엔진을 HTTP 로 노출합니다.
HWP/HWPX/DOCX/DOC/PDF 를 업로드하면 Markdown 으로 변환된 결과를 반환하며,
동일 파일은 SHA-256 content-addressed 캐시로 재파싱 없이 응답합니다.

- **Base URL** (로컬 개발): `http://localhost:3000`
- **OpenAPI 스펙**: `GET /docs/json`
- **Swagger UI**: `GET /docs`
- **인증**: `X-API-Key` 헤더 (옵션 — `API_KEYS` 환경변수로 활성화)

## 빠른 시작

```bash
# 1. 서버 실행
pnpm --filter @paper-md-studio/server dev
#   → http://localhost:3000 에서 대기

# 2. 헬스 체크
curl http://localhost:3000/v1/health
# {"status":"ok","version":"0.1.0"}

# 3. 문서 변환 (DOCX 예시)
curl -X POST http://localhost:3000/v1/convert \
  -F "file=@packages/core/tests/fixtures/sample.docx"

# 4. 같은 파일 재호출 → cached:true, elapsedMs 급감
```

## 엔드포인트

### `GET /v1/health`

서버 생존 확인. 인증 불필요.

```json
{ "status": "ok", "version": "0.1.0" }
```

---

### `POST /v1/convert`

문서를 업로드하고 Markdown 으로 변환합니다. **두 가지 입력 방식** 을 지원합니다.

**방식 1 — 파일 업로드**
- Content-Type: `multipart/form-data`
- 필드: `file` (단일)

**방식 2 — 원격 URL (서버가 fetch)**
- Content-Type: `application/json`
- 바디: `{ "url": "https://example.com/file.pdf", "filename": "hint.pdf" }` (filename 은 선택)
- URL 경로에 확장자가 없으면 `filename` 힌트 필수
- SSRF 방어 (아래 섹션 참고)

**공통**
- 허용 확장자: `.hwp` · `.hwpx` · `.doc` · `.docx` · `.pdf`
- 크기 한계: `MAX_UPLOAD_MB` 환경변수 (기본 50MB)
- 인증: `X-API-Key` 헤더 (`API_KEYS` 가 설정돼 있을 때)
- fetch 타임아웃 (URL 모드): `FETCH_TIMEOUT_MS` (기본 30000)

**쿼리 파라미터**

| 이름 | 값 | 기본 | 설명 |
|------|-----|------|------|
| `images` | `urls` / `inline` / `refs` / `omit` | `urls` | 이미지 전달 방식 (아래 참조) |

**이미지 모드**

| 모드 | Markdown 내부 | 응답 `images[].url/uri` | 용도 |
|------|---------------|-------------------------|------|
| `urls` | `/v1/conversions/{id}/images/{name}?exp=&sig=` (HMAC signed) | `url` | 기본. 브라우저/Markdown 뷰어에서 즉시 렌더 |
| `inline` | `data:image/png;base64,...` | — | 자기완결. 이미지 총량 작을 때. 초과 시 **413** |
| `refs` | `conv://{id}/images/{name}` | `uri` | MCP/에이전트 — 토큰 최소화 |
| `omit` | `_[이미지: alt]_` placeholder | — | OCR/텍스트 전용 |

`urls` 모드에서 `PAPER_MD_PUBLIC_BASE_URL` 환경변수가 설정돼 있으면 절대 URL (`https://host/v1/...`),
미설정 시 경로만 (`/v1/...`) 반환합니다. 이미지 URL 은 15분 (기본) 만료되는 HMAC 서명을 포함합니다.

**성공 응답** (`200`)

```json
{
  "success": true,
  "data": {
    "conversionId": "f8b1...64자 hex",
    "format": "docx",
    "markdown": "# Title\n\n본문\n\n![](./images/img_001.png)",
    "images": [
      {
        "name": "img_001.png",
        "mimeType": "image/png",
        "size": 12345,
        "url": "/v1/conversions/f8b1.../images/img_001.png?exp=1716000000&sig=abc..."
      }
    ],
    "cached": false,
    "elapsedMs": 512,
    "createdAt": "2026-04-24T...",
    "originalName": "sample.docx",
    "size": 18234
  }
}
```

**에러 응답** (모든 포맷 공통)

```json
{ "success": false, "error": "<한국어 메시지>" }
```

| 상태 | 사유 |
|------|------|
| `400` | 파일 필드 누락 / 빈 파일 / 지원하지 않는 확장자 / 잘못된 쿼리 값 / URL 스킴·호스트 차단 / 잘못된 JSON 바디 |
| `401` | API Key 누락·불일치 (`API_KEYS` 활성 시) |
| `413` | 업로드 크기 초과 / URL 응답 크기 초과 / `inline` 모드에서 이미지가 `PAPER_MD_PUBLIC_MAX_INLINE_KB` 초과 |
| `500` | 파서 실패 등 예상치 못한 내부 오류 |
| `502` | 원격 URL fetch 타임아웃 / 네트워크 오류 / HTTP 오류 / 리다이렉트 루프 |

**URL 모드 예시**

```bash
# 정상 — 공개 URL 의 문서를 변환
curl -X POST http://localhost:3000/v1/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/reports/q1.pdf"}'

# 확장자 없는 URL — filename 힌트 제공
curl -X POST http://localhost:3000/v1/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://api.example.com/download?id=42","filename":"report.docx"}'

# 차단 예시 — 사설/loopback 호스트
curl -X POST http://localhost:3000/v1/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:22"}' -i
# → 400 { "success": false, "error": "사설·loopback·link-local 대역 IP 는 차단됩니다: 127.0.0.1" }
```

**SSRF 방어 동작**
1. 스킴은 `http:` / `https:` 만 허용 (`file:`, `data:`, `gopher:`, `ftp:` 거부)
2. 호스트가 IP 리터럴이든 도메인이든 **리졸브된 모든 IP** 를 검사:
   - `127.0.0.0/8` (loopback), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918)
   - `169.254.0.0/16` (link-local — AWS/GCP metadata 포함)
   - `0.0.0.0/8`, `240.0.0.0/4`, multicast 대역
   - IPv6: `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped 카운터파트
3. `30x` 리다이렉트는 수동 follow(최대 3회) + **매 단계 재검증**
4. `Content-Length` 헤더 사전 검증, 스트리밍 수신 중에도 누적 바이트 감시
5. `AbortController` + 타임아웃 (`FETCH_TIMEOUT_MS`)

---

### `GET /v1/conversions/:id`

변환된 문서의 metadata 와 markdown 을 반환합니다. **MCP remote 모드** 가 이 엔드포인트를 사용해 후속 호출(outline/chunk) 의 입력 markdown 을 받아옵니다.

**요구**
- `id` 는 64자 16진수 (SHA-256). 형식 불일치 → 400.
- 인증: `X-API-Key` 헤더 (활성 시)

**성공 응답** (`200`)
```json
{
  "success": true,
  "data": {
    "conversionId": "f8b1...",
    "format": "hwpx",
    "markdown": "# Title\n\n...",
    "images": [{ "name": "img_001.png", "mimeType": "image/png", "size": 12345 }],
    "cached": true,
    "elapsedMs": 0,
    "createdAt": "2026-04-24T...",
    "originalName": "sample.hwpx",
    "size": 3865259
  }
}
```

**에러**: `400` 형식 오류, `401` API Key 누락·불일치, `404` 없는 id. 이미지 바이너리는 포함되지 않으며 `/v1/conversions/:id/images/:name` 로 별도 조회합니다.

---

### `GET /v1/conversions/:id/images/:name`

변환된 이미지 바이너리 다운로드.

**요구**
- `id` 는 64자 16진수 (SHA-256). 형식 불일치 → 404.
- `?exp=<unix_sec>&sig=<hex>` 쿼리는 **`POST /v1/convert?images=urls` 응답의 URL 에서 복사**. 직접 생성할 수 없음.
- API Key 불필요 — 서명 자체가 인증.

**응답**
- 성공: 200, `Content-Type: <이미지 mime>`, `Cache-Control: private, max-age=60`
- `401 {success:false, error:"이미지 URL 서명이 필요합니다."}` — 쿼리 누락
- `401 {success:false, error:"이미지 URL 이 유효하지 않습니다."}` — 위조/만료 (단일 메시지)
- `404` — 존재하지 않는 conversion id 또는 image name

---

## 캐시 동작

같은 파일을 두 번 업로드하면 두 번째 응답의 `cached: true` 가 되고 `elapsedMs` 가 급감합니다.

```bash
# 첫 요청 — MISS (elapsedMs ≈ 수백 ms)
curl -X POST http://localhost:3000/v1/convert -F "file=@sample.hwpx" | jq '.data.cached, .data.elapsedMs'
# false
# 487

# 두 번째 — HIT
curl -X POST http://localhost:3000/v1/convert -F "file=@sample.hwpx" | jq '.data.cached, .data.elapsedMs'
# true
# 3
```

캐시 키는 파일 **바이트의 SHA-256** 이므로 파일명이 달라도 내용이 같으면 HIT.

저장 위치는 `STORAGE_ROOT` 환경변수 (기본 `./.paper-md-storage`). TTL/GC 는 MVP 에 없으며 Phase 11 에서 추가됩니다.

## 환경변수

전체 목록은 [`CONFIG.md`](./CONFIG.md) 참고.

## Postman 가이드

1. **헬스**: New Request → GET `http://localhost:3000/v1/health` → Send
2. **변환**: New Request → POST `http://localhost:3000/v1/convert`
   - Body 탭 → **form-data**
   - Key `file` 의 타입을 **File** 로 변경 → 샘플 파일 선택
   - **Content-Type 헤더는 수동으로 추가하지 말 것** (Postman 이 boundary 를 자동 설정)
   - (옵션) Headers 탭에 `X-API-Key: <your-key>` (API_KEYS 활성 시)
   - Params 탭에 `images=refs` 등을 추가해 모드 변경 테스트

## 아직 없는 것들

- 비동기 잡 (`POST /v1/conversions` 202 + SSE 진행률) — 현재 모든 변환이 동기
- 레이트리밋 — 프로덕션 배포 시 앞단 API Gateway 권장
- Redis/RDB 기반 API Key 저장소 — Phase 11
- S3/R2 스토리지 어댑터 — Phase 11
- OAuth / JWT — Phase 11

이 항목들은 Phase 11 또는 별도 배포 레이어에서 다루어집니다.
