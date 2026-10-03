# 서버 환경변수

`@paper-md-studio/server` 가 읽는 환경변수 전체 목록. `.env.example` 도 같은 내용을 참고하세요.

| 이름 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | HTTP listen 포트 |
| `HOST` | `0.0.0.0` | bind 주소. 로컬 전용이면 `127.0.0.1` |
| `STORAGE_ROOT` | `./.paper-md-storage` | 변환 결과(markdown + 이미지 + 메타) 디렉토리. 쉐어드 마운트 권장 |
| `SIGNING_SECRET` | `dev-secret-change-me-0123456789` | HMAC-SHA256 시크릿. 이미지 signed URL 서명·검증에 사용. **최소 16자. 프로덕션에서 반드시 교체**. |
| `SIGNED_URL_TTL_SECONDS` | `900` | `?images=urls` 응답의 이미지 URL 유효 기간 (초). 기본 15분 |
| `MAX_UPLOAD_MB` | `50` | `POST /v1/convert` 단일 업로드 상한 (MiB). URL 모드에도 동일하게 적용. 초과 시 413 |
| `FETCH_TIMEOUT_MS` | `30000` | `POST /v1/convert` URL 모드(`application/json { url }`)의 원격 fetch 타임아웃 (ms). 초과 시 502. SSRF 방어 로직 내장 — `http:`/`https:` 만 허용, 사설·loopback·link-local IP 차단, 리다이렉트 매 단계 재검증 |
| `PAPER_MD_PUBLIC_BASE_URL` | (비어있음) | `?images=urls` 응답에서 절대 URL 을 구성할 때 사용 (예: `https://api.example.com`). 비어있으면 경로만 (`/v1/...`) 반환. 끝의 `/` 는 자동 제거. OpenAPI `servers[]` 에도 반영 |
| `PAPER_MD_PUBLIC_MAX_INLINE_KB` | `512` | `?images=inline` 으로 base64 인라인할 때 이미지 한 장당 허용 크기 (KB). 초과 시 413 + `?images=urls` / `?images=refs` 힌트 |
| `LOG_LEVEL` | `info` | pino 로그 레벨: `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |

## 예시 `.env`

### 로컬 개발

```bash
PORT=3000
STORAGE_ROOT=./.paper-md-storage
LOG_LEVEL=debug
```

### 절대 URL 노출

```bash
PORT=8080
HOST=0.0.0.0
STORAGE_ROOT=/var/lib/paper-md/storage
SIGNING_SECRET=<32자 이상 랜덤>
PAPER_MD_PUBLIC_BASE_URL=https://paper-md.internal.example.com
SIGNED_URL_TTL_SECONDS=900
LOG_LEVEL=info
```

## 비밀 관리

`SIGNING_SECRET` 이 바뀌면 기존 signed URL 은 전부 무효화됩니다 (`?images=urls` 재발급 필요).

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

- Node.js 22.13+
- LibreOffice — `.doc` 변환 시 필요 (headless). 설치 안 돼 있으면 macOS 에선 `textutil` 폴백 (이미지 손실)

`.hwp` / `.hwpx` / `.docx` / `.pdf` / `.xlsx` / `.xls` 는 추가 런타임 불필요. `.hwp` 는
core 에 들어 있는 rhwp(WASM)가 HWPX 로 바꾼 뒤 자체 HWPX 파서로 변환한다 (0.7.0 부터
Java 불필요).

## 변환 엔진 환경변수 (core)

서버·MCP·CLI 가 공통으로 쓰는 core 가 읽는다.

| 이름 | 설명 |
|------|------|
| `PAPER_MD_STUDIO_PDF_ENGINE` | `legacy` 면 PDF 를 대체 엔진(pdf2md + pdfjs)으로 변환한다. 그 밖의 값·미설정은 기본 엔진(`@firecrawl/pdf-inspector`) |
| `PAPER_MD_STUDIO_LIBREOFFICE` | `.doc` 변환에 쓸 `soffice` 실행 파일 경로 (미설정 시 자동 탐색) |

> 0.6.x 의 `PAPER_MD_STUDIO_HWP_ENGINE`·`PAPER_MD_STUDIO_HWP_JAR` 는 Java(hwp2hwpx)
> 경로와 함께 없어졌다. 값이 남아 있어도 **무시**되고 `.hwp` 는 항상 rhwp 로 변환된다
> (오류 없음).

## 캐시와 변환기 개정

변환 캐시 키에는 파일 바이트·변환 옵션과 함께 core 의 `CONVERTER_REVISION` 이 섞인다.
변환 결과를 바꾸는 core 수정이 들어간 버전으로 올리면 키가 달라져 예전 결과를 다시
쓰지 않고 새로 변환한다 (기존 `STORAGE_ROOT` 내용은 지워지지 않으므로 용량 정리는 위
"스토리지 용량" 절대로).
