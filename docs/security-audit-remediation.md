# CI 보안 감사 복구 작업지시서

> 이 문서만 읽고 바로 착수할 수 있도록 조사 결과·처리 방안·검증 절차를 자족적으로
> 기록한다. 작성: 2026-08-08 (기준 커밋 `42f2b9e`)

## 0. 한 줄 요약

CI 가 `pnpm audit` 단계에서만 실패한다. **이번 kordoc 도입 이전부터 실패하던
문제**이고, 루트 `package.json` 의 `pnpm.overrides` 바닥값이 새 권고보다 낮은 것이
주원인이다. 취약점 20건 중 **kordoc 이 새로 들인 것은 2건**뿐이다.

## 1. 현재 상태와 확인 방법

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
