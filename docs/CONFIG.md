# 서버 환경변수

`@paper-md-studio/server` 가 읽는 환경변수 전체 목록. `.env.example` 도 같은 내용을 참고하세요.

| 이름 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | HTTP listen 포트 |
| `HOST` | `0.0.0.0` | bind 주소. 로컬 전용이면 `127.0.0.1` |
| `STORAGE_ROOT` | `./.paper-md-storage` | 변환 결과(markdown + 이미지 + 메타) 디렉토리. 쉐어드 마운트 권장 |
| `API_KEYS` | (비어있음) | 콤마 구분 API Key 리스트. 비어있으면 인증 비활성 (개발 전용). 하나라도 값이 있으면 `/v1/health`, `/docs*`, `/v1/conversions/.../images/...` 를 제외한 모든 요청이 `X-API-Key` 헤더를 요구. |
| `SIGNING_SECRET` | `dev-secret-change-me-0123456789` | HMAC-SHA256 시크릿. (1) API Key 해싱, (2) 이미지 signed URL 서명에 공용. **최소 16자. 프로덕션에서 반드시 교체**. |
| `SIGNED_URL_TTL_SECONDS` | `900` | `?images=urls` 응답의 이미지 URL 유효 기간 (초). 기본 15분 |
| `MAX_UPLOAD_MB` | `50` | `POST /v1/convert` 단일 업로드 상한 (MiB). URL 모드에도 동일하게 적용. 초과 시 413 |
| `FETCH_TIMEOUT_MS` | `30000` | `POST /v1/convert` URL 모드(`application/json { url }`)의 원격 fetch 타임아웃 (ms). 초과 시 502. SSRF 방어 로직 내장 — `http:`/`https:` 만 허용, 사설·loopback·link-local IP 차단, 리다이렉트 매 단계 재검증 |
| `PAPER_MD_PUBLIC_BASE_URL` | (비어있음) | `?images=urls` 응답에서 절대 URL 을 구성할 때 사용 (예: `https://api.example.com`). 비어있으면 경로만 (`/v1/...`) 반환. 끝의 `/` 는 자동 제거. OpenAPI `servers[]` 에도 반영 |
| `PAPER_MD_PUBLIC_MAX_INLINE_KB` | `512` | `?images=inline` 으로 base64 인라인할 때 이미지 한 장당 허용 크기 (KB). 초과 시 413 + `?images=urls` / `?images=refs` 힌트 |
| `RATE_LIMIT_PER_MINUTE` | `60` | 레이트리밋 값 (아직 적용 안 됨). 프로덕션 배포는 앞단 API Gateway 사용 권장 |
| `LOG_LEVEL` | `info` | pino 로그 레벨: `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |

## 예시 `.env`

### 로컬 개발 (인증 없음)

```bash
PORT=3000
STORAGE_ROOT=./.paper-md-storage
# API_KEYS 비어있어도 OK
LOG_LEVEL=debug
```

### 사내 팀 서버 (인증 + 절대 URL)

```bash
PORT=8080
HOST=0.0.0.0
STORAGE_ROOT=/var/lib/paper-md/storage
API_KEYS=alice-key-x9f4,bob-key-7a2c
SIGNING_SECRET=<32자 이상 랜덤>
PAPER_MD_PUBLIC_BASE_URL=https://paper-md.internal.example.com
SIGNED_URL_TTL_SECONDS=900
LOG_LEVEL=info
```

## 비밀 관리

`SIGNING_SECRET` 이 바뀌면:
- 기존 signed URL 은 전부 무효화 (`?images=urls` 재발급 필요)
- 기존 API Key 해시가 달라지므로 모든 클라이언트에 새 키 발급 필요 없음 — `API_KEYS` 원본 값이 동일하면 재해싱만 일어남

`SIGNING_SECRET` 은 **로그·백업·Git 에 절대 남기지 말 것**. 앱 시작 시 `min(16)` 검증으로 `dev-secret-change-me-*` 기본값도 통과하나, 프로덕션에선 **32자 이상 랜덤 문자열** 권장.

## 스토리지 용량

현재 GC 가 없습니다. `STORAGE_ROOT` 가 무한 증가하므로 주기적으로 비우거나 cron 으로 삭제가 필요합니다:

```bash
# 24시간 이상된 변환 제거 (예시)
find "$STORAGE_ROOT" -type d -mtime +1 -name '[0-9a-f][0-9a-f]' -prune \
  -exec rm -rf {} \;
```

Phase 11 에서 LRU/TTL GC 가 추가될 예정입니다.

## 런타임 의존성

- Node.js 20+
- Java 11+ — `.hwp` 변환 시에만 필요 (내부적으로 child_process 로 Java 프로세스 spawn)
- LibreOffice — `.doc` 변환 시 필요 (headless). 설치 안 돼 있으면 macOS 에선 `textutil` 폴백 (이미지 손실)

`.hwpx` / `.docx` / `.pdf` 는 추가 런타임 불필요.
