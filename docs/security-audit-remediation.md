# CI 보안 감사 복구 작업지시서

> 조사 결과·처리 방안·검증 절차를 자족적으로 기록한다.
> 작성: 2026-08-08 (기준 커밋 `42f2b9e`) · **완료: 2026-08-08 — 복구 변경은
> 이 문서 갱신과 같은 커밋에 있다** (완료 시점의 별도 기준 커밋 없음)

## 0. 결과 — 완료 ✅

`pnpm audit` **0건 / exit 0**. 1~4단계를 모두 적용했고 pdfjs 메이저 업그레이드도
포함했다. 커밋 전 xhigh 코드리뷰에서 9건이 적발되어 함께 반영했다(아래에 녹여
기록). §1~§4 는 작업 당시의 조사 기록으로 남긴다.

**작업지시서와 달리 한 것** — 공통 원인: 지시서의 `>=` 를 그대로 쓰면 이미 배포된
새 메이저(undici 8.10.0, nanoid 6.0.1, 그리고 향후의 sharp 0.36/adm-zip 0.7)가
전이 의존성에 메이저째 들어온다. 전부 계열 고정으로 좁혔다.

| 항목 | 지시서 | 실제 | 비고 |
|------|--------|------|------|
| `undici` | `>=7.29.0` | `^7.29.0` | jsdom 이 8.x 로 점프하는 것 방지 |
| `nanoid` 3.x | `nanoid@<3.3.17` → `>=3.3.17` | `nanoid@>=3.0.0 <3.3.17` → `^3.3.17` | 키 하한도 추가 — 무하한이면 1.x/2.x 선언까지 3.x 로 강제 승격 (2→3 에서 CJS export 형태 변경) |
| `nanoid` 5.x | `>=5.1.16` | `^5.1.16` | |
| `adm-zip` | `>=0.6.0` | `^0.6.0` | 0.x 는 마이너가 곧 메이저. kordoc 자신의 override 와 동일 |
| `sharp` | `>=0.35.0` | `^0.35.0` | kordoc 의 선언(`^0.35.0`)과 동일 |

**pdfjs 5.x → 6.x 에서 실제로 문제였던 것** — API 는 호환이었다(v6 `render()` 는
`canvas` 인자를 새로 받지만 `canvas = canvasContext.canvas` 로 기본값이 잡혀 기존
호출부 유효). 진짜 문제는 **modern 빌드의 브라우저 바닥**: 6.2.108 은 `Iterator`
헬퍼(Safari 18.4+)와 `Uint8Array.fromBase64`(18.2+)를 폴리필 없이 참조하는데,
Tauri 의 `minimumSystemVersion: "12.0"` 범위인 macOS 12 는 Safari 17.6 이 상한이라
**PDF 뷰어가 로드 단계에서 통째로 깨진다**. headless chromium 렌더 검증으로는
잡히지 않는 종류다(Chrome 은 122부터 지원). → 뷰어를 **`pdfjs-dist/legacy/build`**
로 전환해 해결 (core-js 폴리필 `es.iterator.*`·`es.uint8-array.from-base64` 내장,
뷰어 임포트 2곳 + 테스트 mock 지정자 1곳 변경).

**곁가지로 고친 것 2건**

- `scripts/make-scan-pdf.mjs` 의 `loadFromStore` 가 `.pnpm/` 스토어를 스캔해
  **사전순 첫 매치**를 골라, 상향된 `sharp@0.35.3` 이 아니라 lockfile 이 참조하지
  않는 잔여 디렉토리 `sharp@0.34.5` 를 로드하고 있었다(갓 클론한 환경과 조용히
  갈림). 스캔·버전 파싱 자체를 버리고 **`.pnpm/node_modules/` 숨김 호이스트**
  (pnpm 이 lockfile 에 링크된 정확한 버전을 심링크)를 require 하도록 교체 —
  잔여물이 옛 버전이든 새 버전이든 영향받지 않는다.
- 루트 `engines.node` 를 `>=22.0.0` → `>=22.13.0` 으로 상향 — pdfjs-dist 6.2.108
  의 engines(`>=22.13.0 || >=24`)가 실질 바닥을 올렸는데 선언이 그대로면
  22.0~22.12 사용자에게 거짓 허용이 된다. CI(node 22 최신)는 영향 없음.

**검증 기록** (아래 항목 전부 legacy 빌드 전환·override 확정 후 최종 상태 기준)

| 항목 | 결과 |
|------|------|
| `pnpm audit` | 0건, exit 0 |
| lockfile 수렴 | overrides 대상은 전부 권고 이상. `nanoid` 는 **의도된 2계열**(3.3.18·5.1.16, §3 참조), 나머지는 단일 버전. ⚠️ 앱의 pdfjs-dist 6.2.108 과 별개로 **kordoc 경유 pdfjs-dist 4.10.38 이 lockfile 에 남아 있다**(현 감사 미적발 — 다음 pdfjs 권고 때 함께 점검할 것) |
| build · typecheck · lint | 전부 exit 0 |
| `pnpm test` | 78 files / 688 tests passed |
| `test:e2e` | 54 passed |
| pdfjs legacy 실렌더 | headless chromium 에서 **`Iterator`·`Uint8Array.fromBase64` 전역을 지워 Safari 17.6 을 모사**한 페이지에 legacy 빌드 로드 — 폴리필이 전역 복원, 한글·괘선 표·체크박스 글리프 정상, modern 빌드와 픽셀 계측(ink) 일치, console error 0. 배율 1→2 재렌더·`cancel()` 후 재사용 경로 포함 |
| MCP stdio 경로 | 기동 → `initialize` · `tools/list` 정상 응답 (hono·ip-address·fast-uri 는 이 경로에서 **로드되지 않음** — 아래 별도 확인) |
| MCP HTTP 경로 (hono·ip-address·fast-uri) | SDK `StreamableHTTPServerTransport` 인스턴스화 정상 + 상향 버전 직접 구동: hono 4.13.1 라우팅 200, ip-address 10.4.0 파싱, fast-uri 4.1.2 파싱 |
| REST Swagger UI (brace-expansion) | `/docs` · `/docs/json` 200, 정적 자산 5종 200 |
| `make-scan-pdf.mjs` (sharp) | 숨김 호이스트 로더로 0.35.3 로드, 정상 산출 |

> ⚠️ 유닛 테스트(`tests/viewers/pdf-viewer.test.tsx`)는 `vi.mock` 으로 pdfjs 를
> 통째로 대체하므로 이런 업그레이드를 **전혀 검증하지 못한다**. 다음에 pdfjs 를
> 올릴 때도 ① 실렌더 확인과 ② **modern/legacy 빌드의 브라우저 바닥 대조**
> (릴리스 노트의 supported browsers vs `minimumSystemVersion`)를 반드시 할 것.

## 1. 당시 상태와 확인 방법

CI 잡 두 개 중 `Lint · Typecheck · Test` 만 실패하며, 그 안에서도 마지막
`Security audit` 단계 하나다. 빌드·Biome·타입체크·Vitest·E2E 는 모두 통과한다.

```bash
pnpm audit                 # 로컬 재현 (CI 와 동일)

# CI 결과 확인 (gh CLI 없이)
curl -s "https://api.github.com/repos/iskim1018/paper-md-studio/actions/runs?per_page=3" \
  | python3 -c "import json,sys;[print(r['name'],r['conclusion'],r['head_sha'][:7],r['html_url']) for r in json.load(sys.stdin)['workflow_runs']]"
```

직전 커밋 `42fc00f`(v0.5.4 릴리스, 이번 작업 이전) 실행도 **같은 단계에서 실패**했다.
즉 이번 푸시가 원인이 아니다. 배포에도 영향 없다 — 릴리스는 `v*` 태그 트리거이고
audit 실패와 무관하다.

## 2. 취약점 20건 인벤토리

기준: 2026-08-08 `pnpm audit` (high 9 · moderate 10 · low 1 · critical 0)

| 심각도 | 패키지 | 유입 경로 | 현재 override | 필요 |
|--------|--------|-----------|---------------|------|
| high | `adm-zip` | core→kordoc→@huggingface/transformers→onnxruntime-node | **없음** | `>=0.6.0` |
| high | `sharp` | core→kordoc→@huggingface/transformers | **없음** | `>=0.35.0` |
| high | `nanoid` | app→@milkdown/kit→@milkdown/components | **없음** | `>=5.1.16` |
| high | `nanoid` | root→tsup→postcss | **없음** | `>=3.3.17` |
| high | `pdfjs-dist` | app **직접 의존성** (`^5.6.205`) | — | `>=6.2.108` ⚠️ 메이저 |
| high | `brace-expansion` | server→@fastify/swagger-ui→@fastify/static→glob→minimatch | `@>=3.0.0 <5.0.8` → `>=5.0.8` | `>=5.0.9` (범위도 조정) |
| high | `fast-uri` | mcp→@modelcontextprotocol/sdk→ajv | `>=3.1.4` | `>=4.1.2` |
| high | `ip-address` | mcp→@modelcontextprotocol/sdk→express-rate-limit | `>=10.1.1` | `>=10.3.1` |
| high | `undici` | app→jsdom (**테스트 전용**) | `^7.28.0` | `>=7.29.0` |
| moderate ×4 | `undici` | 〃 | 〃 | 〃 |
| moderate ×3 + low | `hono` | mcp→@modelcontextprotocol/sdk | `>=4.12.27` | `>=4.12.34` |
| moderate ×2 | `ip-address` | 〃 | `>=10.1.1` | `>=10.3.1` |
| moderate | `dompurify` | app **직접 의존성** (`^3.4.0`) | `>=3.4.12` | `>=3.4.13` |

**출처별 집계**: MCP SDK 경유 8 · jsdom(테스트) 경유 5 · 기타 5 · **kordoc 경유 2**

## 3. 작업 순서

루트 `package.json` 의 `pnpm.overrides` 를 갱신하는 것이 대부분이다. **이미 18개
항목이 있으므로 새 블록을 만들지 말고 기존 블록을 수정할 것.**

### 1단계 — kordoc 이 새로 들인 2건 (사용자 요청 "1")

```jsonc
"adm-zip": ">=0.6.0",
"sharp": ">=0.35.0",
```

근거: kordoc 자신의 `package.json` 에도 같은 override 가 있지만, npm/pnpm 의
overrides 는 **루트 프로젝트일 때만** 적용되어 의존성으로 설치된 우리 트리에는
걸리지 않는다. 둘 다 kordoc 의 optionalDependency 인 `@huggingface/transformers`
(OCR·수식 모델용)를 타고 들어오며, **우리는 OCR 을 쓰지 않아 실행되지 않는 경로**다.

> ⚠️ `sharp` 와 `@hyzyla/pdfium` 은 `scripts/make-scan-pdf.mjs` 가 실제로 사용한다
> (PDF 래스터화). 제거가 아니라 **버전 상향**으로 처리할 것.

### 2단계 — 기존 override 바닥값 상향 (사용자 요청 "2")

```jsonc
"fast-uri": ">=4.1.2",        // 종전 >=3.1.4 — 4.0.x 가 취약
"hono": ">=4.12.34",          // 종전 >=4.12.27
"ip-address": ">=10.3.1",     // 종전 >=10.1.1
"undici": ">=7.29.0",         // 종전 ^7.28.0
"dompurify": ">=3.4.13",      // 종전 >=3.4.12
"brace-expansion@>=3.0.0 <5.0.9": ">=5.0.9",  // 종전 상한 5.0.8
```

### 3단계 — 신규 override (버전 계열이 둘이라 키를 나눠야 함)

```jsonc
"nanoid@<3.3.17": ">=3.3.17",
"nanoid@>=4.0.0 <5.1.16": ">=5.1.16",
```

### 4단계 — `pdfjs-dist` 메이저 업그레이드 ⚠️ 별도 취급

app 의 **직접 의존성**이고 `5.x → 6.x` 메이저 점프다(권고 패치 버전이 `>=6.2.108`
뿐이라 5.x 로는 해결 불가). PDF 뷰어 코드가 직접 쓰는 API 라 **깨질 수 있다**.

- 사용처 확인: `grep -rn "pdfjs" packages/app/src`
- 업그레이드 후 반드시 GUI 에서 PDF 열기·페이지 이동·확대를 **눈으로** 확인
- 위험하면 이 항목만 분리해 뒤로 미루고, 나머지로 CI 를 먼저 초록으로 만든 뒤
  별도 작업으로 진행하는 것도 방법이다

## 4. 검증 절차

```bash
pnpm install            # lockfile 갱신 (overrides 반영)
pnpm audit              # 목표: 0건, exit 0
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @paper-md-studio/app test:e2e   # CI 의 두 번째 잡
```

override 는 **의존성이 기대하지 않은 버전을 강제로 끼워넣는 수단**이라, 감사만
통과하고 런타임이 깨질 수 있다. 특히 아래를 확인한다.

- `packages/mcp` — hono·ip-address 상향 후 MCP 서버 기동
- `packages/server` — brace-expansion 상향 후 Swagger UI 라우트
- `packages/app` — dompurify 상향 후 뷰어 sanitize, pdfjs 업그레이드 시 PDF 뷰어
- `scripts/make-scan-pdf.mjs` — sharp 상향 후 동작 (`node scripts/make-scan-pdf.mjs <pdf>`)

## 5. 대안 — 게이트 기준 재정의

전부 막기 어렵다면 CI 의 audit 범위를 좁히는 선택지도 있다. 다만 **적용 전
`.github/workflows/ci.yml` 의 `pnpm audit` 을 바꾸는 결정**이므로 별도 합의가 필요하다.

- `pnpm audit --prod` — 런타임 의존성만. jsdom(테스트) 경유 5건이 빠지지만
  MCP SDK 경유 8건은 런타임이라 남는다
- `pnpm audit --audit-level=high` — moderate 이하 무시

## 6. 이 작업의 성격

취약점 대부분이 **전이 의존성**이고, 상위 패키지가 갱신되면 override 를 다시
올려야 하는 **반복 유지보수**다. 실제로 지금 실패한 6건이 그 패턴이다(예전에
넣어둔 바닥값이 새 권고보다 낮아짐). 근본 해결은 상위 패키지
(`@modelcontextprotocol/sdk`, `jsdom`, `@milkdown/kit`, `tsup`) 정기 업그레이드이며,
override 는 그 사이를 메우는 임시 수단으로 이해하는 편이 맞다.
