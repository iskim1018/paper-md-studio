# kordoc 통합 계획 · 작업지시서

> 이 문서는 다른 세션·모델(Opus 등)·장비에서 작업을 이어받을 수 있도록
> 배경, 결정, 완료 상태, 다음 단계의 작업지시를 자족적으로 기록한다.
> 마지막 갱신: 2026-08-08

## 0. 지금 상태 · 다음에 할 일

- **K1 완료** — XLSX·XLS·HWP3·HWPML 을 kordoc 에 위임. GUI·MCP·REST 까지 관통.
- **K2 보류** — 합성 코퍼스(6종)와 실물 공공문서(1종) 실측을 마쳤으나 **결론이
  엇갈린다**. 합성에서는 kordoc 의 표 복원이 압도적이었는데, 실물에서는 현행
  파이프라인의 텍스트 품질이 앞섰다(§5). PDF 엔진 교체 여부는 **표본을 더
  모아야 확정 가능**하다.
- **곁가지로 현행 PDF 파이프라인 결함 3건을 교정**했다(§5 "실측에서 나온 …").
  실측이 없었으면 못 찾았을 회귀가 포함돼 있다.
- **CI 복구 완료** (2026-08-08) — `pnpm audit` 취약점 20건 → **0건**. override
  바닥값 상향 + pdfjs 6.x 업그레이드. 작업 내역·검증 기록은
  [`docs/security-audit-remediation.md`](./security-audit-remediation.md) §0.
- **K3 착수 (2026-08-08)** — 1단계(엔진 플래그 + A/B 하니스) 완료, 1차 실측도
  마쳤다(§6). 첫 신호는 kordoc 우세 — 11.5× 빠르고 내용도 덜 잃지 않는다.
  **K2 와 독립된 포맷 축**이라 순서를 바꿔 먼저 진행했다.
- **다음에 할 일 (우선)**: **HWP5 실물 표본 확보**(목표 5종 이상, `private/`).
  HWP5 는 OLE2 바이너리라 합성이 불가능해 표본 수집이 유일한 병목이다.
  절차는 §6 "다음 작업".
- **그 다음**: §5 "추가 표본 확보" 의 빈칸(한컴 네이티브 PDF·2단 조판·
  복잡 병합표)을 채워 재실측 → **K2 확정**.

> 🔒 **비공개 문서 취급 원칙** — 실측에 쓰는 업무 문서는 `private/` 안에서만
> 다룬다(폴더 전체 gitignore). 문서 제목·본문·발췌를 저장소(문서·커밋 메시지·
> 테스트 데이터 어디에도) 남기지 않는다. 파일 단위 예외(`!sample.pdf` 등)는
> 만들지 않는다 — 예외 목록은 언젠가 틀리고, 그 순간이 곧 유출이다.

## 1. 배경과 목표

- 프로젝트 목표 범위: **외부 AI 에이전트 연계 없이 로컬 환경에서만 동작**하는
  문서 → Markdown 변환 데스크톱 앱. 현재 우선순위는 "to Markdown" 변환 품질·범위 보강.
- [kordoc](https://github.com/chrisryugj/kordoc) (MIT, npm 패키지)을 core 변환
  엔진의 내부 구성요소로 채택. 순수 TypeScript ~43K줄로 HWP 3.x/5.x, HWPX,
  HWPML, PDF, XLS(X), DOCX, 이미지(OCR)를 파싱한다.
- 채택 근거 (2026-08-07 조사 실측):
  - 소스 전체에서 `fetch` 호출은 **2곳뿐** (OCR 모델 최초 다운로드, watch webhook —
    둘 다 opt-in). `KORDOC_OFFLINE=1`이면 요청 발신 전 차단. 폐쇄망 배포가
    1급 지원 대상 (kordoc 저장소의 `docs/offline-deployment.md` 참조).
  - 텔레메트리·계정·API 키 없음. 런타임 필수 의존성 5개(경량).
  - HWPX 코퍼스 291문서 표 1,673/1,673 무손실, HWP5↔HWPX 유사도 99.94% 등
    실코퍼스 벤치 게이트로 품질 검증됨.
- 우리가 앞서는 영역(GUI·에디터·뷰어·HTML 변환)은 유지하고, kordoc은 파서
  계층에만 위임한다.

## 2. 설계 원칙 (변경 시 이 문서도 갱신할 것)

1. **kordoc은 core 내부 구현 세부사항** — 공개 API(`convert()`, `ConvertResult`)는
   불변. CLI·app·server 호출부는 kordoc의 존재를 모른다.
2. **어댑터 1곳 격리** — `packages/core/src/parsers/kordoc-adapter.ts`만 kordoc을
   import한다. kordoc 타입이 어댑터 밖으로 새지 않게 유지.
3. **정확 버전 핀 + 계약 테스트** — `"kordoc": "4.7.2"` (`^` 금지).
   버전 업 절차: 핀 변경 → `tests/kordoc-adapter.test.ts` 계약 테스트 통과 확인 →
   코퍼스 스모크. (`@rhwp/core` 0.8.2에서 확립한 패턴과 동일)
4. **오프라인 기본** — 어댑터가 `KORDOC_OFFLINE=1`을 기본 강제
   (`ensureOfflineDefault()`, 사용자가 명시 설정하면 존중). 이 동작을 제거하지 말 것.

## 3. 포맷 라우팅 결정표

| 포맷 | 엔진 | 상태 |
|------|------|------|
| XLSX / XLS | kordoc | ✅ K1 완료 |
| HWP 3.x / HWPML (`.hwp` 매직바이트 판별) | kordoc | ✅ K1 완료 |
| HWP 5.x (OLE2) | Java `hwp2hwpx` → HWPX → 자체 파서 | 유지 (K3에서 kordoc 대체 실험) |
| HWPX | 자체 파서 (PUA·중첩표·grid normalize 누적 투자) | 유지 |
| PDF | pdf2md + 자체 보정 2단 | 유지 (K2에서 A/B 실측 후 결정) |
| DOCX | mammoth + turndown | 유지 (후순위 재검토) |
| HTML | 자체 (readability + linkedom) | 유지 — kordoc에 없는 고유 기능 |
| 이미지 (PNG/JPG/WebP, OCR) | kordoc | 📋 K4 |

## 4. K1 — 완료 (2026-08-07)

### 구현 내역

- `packages/core/package.json` — `"kordoc": "4.7.2"` 정확 핀
- `packages/core/src/parsers/kordoc-adapter.ts` (신규) —
  `KordocParser implements Parser`. 이미지 참조를 `./{문서명}_images/` 규약으로
  재작성(`rewriteImageRefs`), kordoc 에러 코드 12종 → 한국어 메시지
  (`failureMessage`), 경고 → `warnings` 문자열(`toWarningMessages`),
  `detectBinaryFormat`(매직바이트 감지), `ensureOfflineDefault`
- `packages/core/src/parsers/hwp-parser.ts` — 파일 앞 1KB만 읽어 3분기:
  hwp3·hwpml → `KordocParser`, OLE2 → 기존 Java 경로
- `packages/core/src/types.ts` — `DocumentFormat`에 `"xlsx" | "xls"`,
  `ParseResult`/`ConvertResult`에 `warnings?: Array<string>` (하위호환 확장)
- `packages/core/src/pipeline.ts` — FORMAT_MAP/PARSER_MAP 확장, warnings 전달
- `packages/server/src/routes/convert.ts` — 업로드 허용 확장자에 `.xlsx`/`.xls`
- `packages/server/src/schemas/api.ts` — `format` enum에 `"html","xlsx","xls"`
  (html은 기존 잠재 불일치 수정)
- `packages/server/src/cache/convert-cache.ts` — 전수 매핑 갱신
- `packages/cli/src/index.ts` — 도움말 갱신
- `packages/core/tests/kordoc-adapter.test.ts` (신규) — 헬퍼 단위 테스트 +
  **kordoc 계약 테스트** (detectFormat 매직바이트, 합성 XLSX/HWPML 파싱,
  실패 계약, 오프라인 기본값)

### 검증

- typecheck·lint(Biome)·build 전부 통과, 테스트 674개 통과 (2026-08-07)
- typescript-reviewer 리뷰: CRITICAL 0. HIGH 2건(서버 라우트 누락, 전체 파일
  읽기) 반영 완료.

### 후속 항목

- [x] **app GUI** (2026-08-07): `file-store.ts` 자체 `DocumentFormat`·확장자
  목록, 파일 다이얼로그 필터(`use-file-pickers.ts`), 뷰어 안내
  (`preview-panel.tsx` — Excel은 원본 미리보기 없이 Markdown 안내) 확장 완료
- [x] **mcp** (2026-08-07): `input-resolver.ts`의 `SUPPORTED_EXTS`에
  `.xlsx`/`.xls` 추가 완료
- [x] server `convert-cache.test.ts`에 xlsx 감지 케이스 추가 완료 (2026-08-07)
- [ ] `rewriteImageRefs`는 문자열 일치 치환이라 kordoc이 참조를 인코딩하면
  조용히 no-op (저위험 — kordoc은 `image_NNN.ext` 순차 명명)

## 5. K2 — PDF A/B 실측 (다음 작업)

**목표**: 현행 PDF 파이프라인(pdf2md + `pdf-text-runs.ts`/`pdf-postprocess.ts`
보정) vs kordoc PDF 파서를 실측 비교해 위임 범위를 결정.

**작업지시**:

1. ~~kordoc PDF 경로는 optionalDependency `pdfjs-dist`가 필요~~ → **확인 완료
   (2026-08-07)**: pnpm이 kordoc의 optionalDependencies(pdfjs-dist·
   onnxruntime-node·sharp·@hyzyla/pdfium·@huggingface/transformers)를 전부
   기본 설치함. K2는 바로 가능. **단, 앱 sidecar 번들에 이들이 딸려가는지
   크기 실측이 K4 선행 과제로 확정됨.**
2. ~~비교 스크립트 작성~~ → **완료**: `scripts/pdf-ab.mjs` (합성 PDF 스모크
   통과, 2026-08-07). 사전에 `pnpm build` 필요.
3. 코퍼스: `packages/core/tests/fixtures`의 PDF + 사용자 제공 실무 문서
   (한컴 워드프로세서 출력 PDF 필수 포함).
4. **판정 기준** (모두 문서화할 것):
   - 표 구조 복원 (현행 파이프라인은 표 복원 없음 — kordoc은 선 기반 그리드 감지)
   - **회귀 3종 재발 여부**: ① 굵은 글씨 겹쳐 그리기로 인한 글자 중복
     (예: `제안요청서` 23회 반복), ② 숫자 경계 공백 오삽입 (`제21조`→`제 21 조`),
     ③ 목차 오인식·점선 리더. 현행 보정의 근거는 CLAUDE.md 결정 로그
     2026-08-03 항목과 `pdf-postprocess.test.ts`/`pdf-text-runs.test.ts` 참조.
   - 2단 조판 문서의 읽기 순서
5. 결정 옵션: 전면 스왑 / 하이브리드(표 감지된 문서만 kordoc) / 현행 유지.
   결과와 무관하게 kordoc의 `pageQuality`/`needsOcr` 신호는 채택 가치 있음
   (스캔 PDF 안내 UI 재료).

### 1차 실측 — 합성 코퍼스 (2026-08-07)

실무 PDF가 없어 `scripts/make-pdf-corpus.mjs` 로 병리별 합성 PDF 6종을
headless chromium 인쇄로 생성해 비교했다. **한계: Chrome 이 만든 PDF라
한컴 실파일의 병리(깨진 ToUnicode, 조판 캐시)는 미재현. 최종 판정은
실무 문서로 해야 한다.**

| 케이스 | 현행 | kordoc |
|--------|------|--------|
| 01 괘선 병합표 | ❌ 표 전멸 — 모든 행이 `###` 헤딩 | ✅ rowspan/colspan HTML 표 + GFM 표 완전 복원 |
| 02 무괘선 표 | ❌ 표 0개 | ✅ 표 복원 |
| 03 2단 조판 | ✅ 읽기 순서 정상 | ❌ 기본값 실패 → **`tables:false` 면 정상** |
| 04 겹쳐 그린 굵은 글씨 | ❌ 글자 중복 + `제 21 조` | ⚠️ 글자 중복 남음, 숫자 공백은 정상 |
| 05 목차·점선 리더 | ⚠️ 전 항목 `##` 헤딩 | ⚠️ 목차를 표로 변환 + 어절 공백 소실 |
| 06 스캔 이미지 | ❌ **빈 결과를 조용히 반환** | ✅ `needsOcr` + 경고 |

핵심 발견:

1. **표 복원은 kordoc 압승** — 현행 파이프라인은 표 구조를 전혀 못 살리고,
   표의 각 행을 헤딩으로 바꿔 문서 구조까지 오염시킨다.
2. **현행의 헤딩 남발이 독립 결함** — pdf2md 의 글자 크기 기반 헤딩 감지가
   본문 문단·표 행을 `##`/`###` 로 만든다. kordoc 채택 여부와 무관하게 문제.
3. **kordoc 표 감지의 과잉 발화** — 2단 구분선·목차 점선 리더를 표로 오인한다.
   `tables:false` 로 회피 가능하므로 **문서별 재시도 전략이 필요**
   (예: 2단 감지 시 tables 끄고 재파싱).
4. **`제 21 조` 회귀가 현행에서 재현됨** (CLAUDE.md 2026-08-03 수정 항목).
   원인 확정: `mergeAdjacentRuns` 가 `previous.font !== next.font` 이면 병합을
   포기하는데, Chrome PDF 는 한글(`g_d0_f3`)과 숫자(`g_d0_f2`)를 **다른 폰트로
   임베드**한다(pdfjs 런 덤프로 확인). 한컴 PDF 는 한 폰트라 기존 수정이
   통했지만 Word·Chrome·LibreOffice 산출 PDF 는 폰트가 갈린다.
   → 현행 유지 시 조치: 높이·베이스라인이 같고 간격이 0에 가까우면
   폰트가 달라도 병합하도록 조건 완화.
5. **스캔 PDF 의 silent failure** — 현행은 빈 마크다운을 성공으로 반환한다.
   사용자에게 "왜 비었는지" 알릴 수단이 없다. 이것만으로도 품질 신호 채택 가치 있음.

### 실측에서 나온 현행 파이프라인 수정 (2026-08-08)

위 발견 중 kordoc 채택 여부와 무관하게 손해가 없는 세 가지를 먼저 고쳤다.

- **(a) 숫자 경계 공백** — `mergeAdjacentRuns` 에서 글꼴 일치 조건 제거
  (`pdf-text-runs.ts`). 높이·베이스라인·간격만으로 판정하므로 한글과 숫자를 다른
  글꼴에 임베드한 PDF 도 `제21조` 로 붙는다. 실측 PDF 로 확인.
  트레이드오프: 간격 1pt 이내로 밀착한 서로 다른 칸도 합쳐진다(테스트로 고정).
- **(b) 헤딩 남발** — `demoteFalseHeadings` 신설 (`pdf-postprocess.ts`).
  문장 종결 부호(`.` `。`)로 끝나는 제목과, 같은 단계 제목 3개 이상 연속을
  본문으로 되돌린다. 물음표는 제외했다(FAQ 형식 제목 보호).
  코퍼스 6종에서 문서당 헤딩이 10여 개 → 0~2개로 정상화.
- **(c) 스캔 PDF silent failure** — `hasExtractableText` 판정으로 경고를 붙이고
  (`pdf-parser.ts`), **CLI(`경고:` 줄·JSON `warnings`)와 GUI(결과 패널 상단
  배너)까지 배선**했다. 경고가 표시되지 않으면 silent failure 가 그대로이므로
  표시 경로까지가 이 수정의 범위다.

### 추가 표본 확보 절차 (다음 작업 — 여기서 이어가면 된다)

합성 코퍼스로는 판정할 수 없는 것이 남아 있어(한컴이 만든 PDF 의 깨진
ToUnicode/CMap, 같은 자리 겹쳐 그리기, 실제 표 괘선) **한컴 오피스에서 직접
출력한 PDF** 로 재실측한다. 준비 절차는 아래와 같다.

**1. 출력 방법 — 같은 문서를 두 방식으로 뽑는다.** 한컴의 PDF 내보내기와 OS 인쇄
경로는 서로 다른 PDF 를 만든다(겹쳐 그리기 재현 여부가 갈린다).

- `파일 → PDF로 저장하기` → 파일명 끝에 `-저장`
- `파일 → 인쇄 → PDF로 저장` → 파일명 끝에 `-인쇄`

**2. 문서 선정 — 병리별로 하나씩, 5~10개면 충분하다.**

| 검증 대상 | 고를 문서 |
|-----------|-----------|
| 표 구조 복원 (전환 판단의 핵심) | 병합 셀이 있는 표 — 사업계획서·예산서·신청 양식 |
| 겹쳐 그린 굵은 글씨 | 표지에 크고 굵은 제목 — 제안요청서·보고서 |
| 숫자 경계 공백 (`제21조`) | 조문 번호·금액이 많은 문서 |
| 목차 점선 리더 | 20쪽 이상 긴 보고서 |
| 2단 조판 읽기 순서 | 회의록·속기록 |
| 스캔본 (`needsOcr`) | 이미지로만 된 공고문 |

**3. 배치와 실행.** 저장소 루트의 `private/` 안에 둔다. 이 폴더는 통째로 무시되므로
안에서 무엇을 만들든 저장소로 새지 않고, 파일명·확장자가 무시 규칙에 드러나지도
않는다. **공개하면 안 되는 문서는 `packages/core/tests/fixtures/` 에 두지 말 것** —
그쪽은 추적되는 디렉토리이고 확장자 패턴으로만 걸러진다.

```bash
pnpm build
node scripts/pdf-ab.mjs ./private/pdf-corpus     # 출력 기본값도 private/pdf-ab
```

현행 파이프라인 / kordoc 기본값 / kordoc `tables:false` 세 갈래를 한 번에
비교한다. 표 감지 과잉 발화가 실물에서도 재현되는지가 하이브리드 전략의 근거다.

**4. 판정 항목** — §5 판정 기준의 회귀 3종에 더해, 이번엔 이미 고친 (a)(b)(c)가
실물에서도 유지되는지 함께 본다.

**곁다리 소득**: 같은 기회에 `packages/core/tests/fixtures/` 의 `sample.hwp`·
`sample.hwpx`·`sample.pdf` 도 만들어 두면 현재 fixture 부재로 건너뛰는 테스트
20개가 살아난다.

### 2차 실측 — 실물 공공문서 1종 (2026-08-08)

표본: 공공기관 업무 편람류 1종, 27쪽. `.hwp`·`.hwpx`·PDF(인쇄)·PDF(저장)
네 형태가 모두 있어 **같은 문서의 HWPX 변환 결과를 정답지로 쓸 수 있었다**.

> ⚠️ 실측에 쓴 문서는 **비공개 자료**다. 제목·본문·발췌를 이 저장소(문서·커밋
> 메시지·테스트 데이터 어디에도) 남기지 않는다. 아래는 수치와 현상만 기록한다.
> 문서와 산출물은 통째로 무시되는 `private/` 안에서만 다룬다.

| 지표 | 정답지(HWPX) | 현행 | kordoc | kordoc 표끔 |
|------|--------------|------|--------|-------------|
| 정규화 글자수 | 9,222 | 10,137 (110%) | 14,212 (154%) | 12,065 (131%) |
| 텍스트 재현율(5-gram) | — | **75.5%** | 69.5% | 72.6% |
| 표 | 73 | 0 | 4 | 0 |
| 점선 리더 잔존 줄 | — | 7 | 3 | 62 |

**1차 실측(합성)의 결론이 실물에서 부분적으로 뒤집혔다.**

- **현행이 텍스트 품질에서 앞선다.** 문단을 한 줄로 재조립하고 목차 점선 리더를
  목록으로 정규화한다. kordoc 은 PDF 의 물리적 줄바꿈을 그대로 남겨 표지 제목
  한 줄이 제목 두 개로 쪼개지고 글자수가 154% 로 부풀었다.
- **kordoc 이 찾은 표 4개 중 진짜 표는 1개**였다. 나머지는 레이아웃 상자를 표로
  오인한 것이고, 그 안에서 숫자·조사 앞뒤에 공백이 끼어 어절이 깨졌다. 합성
  코퍼스의 CSS 괘선 표와 달리 실문서의 레이아웃 표는 복원 대상이 아닐 수 있다.
- **(a) 수정이 실물로 검증됐다.** 이 문서에는 글꼴이 다른데 붙어 있는 인접 런이
  **712쌍** 있었다(한 낱말이 글꼴 경계로 쪼개진 경우, 괄호·기호와 본문이 다른
  글꼴인 경우 포함). 글꼴 일치를 요구하던 종전 조건이었다면 전부 공백으로
  벌어졌을 자리다.
- **(c) 수정도 실물로 검증됐다.** 같은 문서를 래스터화한 스캔본
  (`scripts/make-scan-pdf.mjs`)에서 CLI 경고가 정상 발화했다.
- kordoc 경고 12건은 이미지 영역·머리글 필터 안내였고 **mojibake·needsOcr 신호는
  없었다** — 이 PDF 의 텍스트 레이어는 깨끗하다.

**표본의 한계 (다음 표본에서 채워야 할 것)**

- Producer 가 `macOS Quartz`, Creator 가 `미리보기`다. 파일명의 "페이지 자름"대로
  미리보기에서 쪽을 잘라 다시 저장하면서 **한컴 원본 흔적이 덮였다**.
  겹쳐 그린 쌍을 직접 세어보니 **0개** — 우리가 고친 글자 중복 병리가 이 표본에는
  없다. 원본 PDF 는 편집하지 말고 그대로 받아야 한다.
- 2단 조판·복잡한 병합 표(예산서·양식)·깨진 ToUnicode 표본이 아직 없다.

**결론**: 이 한 종만으로 PDF 엔진을 kordoc 으로 바꿀 근거는 되지 못한다.
오히려 **현행 유지 + 표 복원만 선택적으로 보강**하는 쪽이 현재 증거에 부합한다.
확정 전에 위 한계 항목을 채운 표본이 필요하다.

**~~잠정 권고~~ (1차 시점, 2차 실측으로 뒤집힘)**: 합성 코퍼스만 보고는 "kordoc 전환
+ 표 감지 재시도"가 유력했으나, 실물 문서에서 텍스트 품질이 역전됐다.
현재 유효한 판단은 위 "2차 실측" 절의 결론을 따른다.

## 6. K3 — HWP5 Java 툴체인 대체 실험

**목표**: kordoc의 순수 TS HWP5 파서로 Java(jar+JRE) 번들을 제거할 수 있는지 검증.

**작업지시**:

1. ✅ **완료 (2026-08-08)** — `HwpParser`에 `PAPER_MD_STUDIO_HWP_ENGINE=kordoc`
   플래그로 kordoc 직파싱 경로 병행 추가. 기본값은 기존 Java 경로.
   엔진 선택은 순수 함수 `resolveHwp5Engine(env)`로 분리해 테스트했고,
   **모르는 값은 Java로 폴백**한다(오타 하나로 변환 엔진이 바뀌면 안 된다).
   A/B 하니스 `scripts/hwp-ab.mjs` 신규 — 두 경로 모두 core `convert()`를
   통과시켜 이미지 참조 재작성·경고 배선까지 포함한 통합 결과를 비교한다.
2. ⏳ **1차 실측 완료, 표본 부족** — 아래 참조.
3. 통과 시 제거 대상: `packages/core/resources/hwp-to-hwpx.jar`,
   `tools/hwp-to-hwpx/`, `build:hwp-tool` 스크립트, app의 JRE 번들,
   CLI·README의 "Java 11+ 필요" 문구. **설치본 수십 MB 경량화 + 공증 단순화**가 보상.

### 1차 실측 — 실물 HWP5 1종 (2026-08-08)

> ⚠️ **표본 1건**. 방향은 보이지만 확정 근거로 쓸 수 없다.
> PDF(K2)와 달리 **HWP5는 합성이 불가능**하다 — OLE2 바이너리라 writer가
> 없고, 한컴오피스로 실제 저장하는 수밖에 없다. 표본 확보가 K3의 병목이다.

| 지표 | (a) Java→HWPX→자체 파서 | (b) kordoc 직파싱 |
|------|------------------------|-------------------|
| 소요 | 2075ms | **181ms (11.5×)** |
| 글자 수 | 15,140 | 16,174 |
| 표 블록 / 행 | 53 / 161 | 30 / 86 |
| 1열 표(레이아웃 박스) | 19개 | 0개 |
| 중첩표 인라인 `(표 R×C)` | 6곳 | 0곳 (표기 없음) |
| 이미지 | 15 | **16** (전수 시그니처 검증 통과) |
| 경고 | 0 | 5 (BinData 이미지 형식 — 실제 산출물은 정상) |
| 체크박스·불릿 글리프 | □×7 ○×47 ▪×14 | **동일** |

**내용 보존 (토큰 단위 대조)**

- Java 출력의 고유 한글토큰 714개 중 **709개(99%)가 kordoc 출력에도 존재**.
  누락 5개는 전부 자체 파서가 셀을 공백 없이 이어붙여 생긴 합성어라
  **실제 유실이 아니다**.
- 중첩표 인라인 표기는 kordoc에 없지만, 그 안의 내용은 **98/98 토큰 전량 보존**.
  유실이 아니라 표현 방식 차이다.
- 숫자 토큰: Java 고유 66개 중 kordoc에 없는 것 37개로 보이나, 쉼표·끝점을
  제거하면 **36개가 표기 차이**였고 실질 누락은 **1건**.
- 역방향: **kordoc만 살린 산문 토큰 9개** — 현행 경로가 놓친 본문이 있다.

**해석 (잠정)**

- kordoc이 **느리지도, 덜 담지도 않다**. 오히려 빠르고(11.5×) 이미지 1건·
  산문 9토큰을 더 살렸다. Java 제거 가설에 유리한 첫 신호다.
- 최대 쟁점은 **표 표현**이다. 자체 파서는 한컴의 1열 레이아웃 박스까지
  표로 만들지만(19개) kordoc은 산문으로 푼다. 어느 쪽이 읽기 좋은지는
  수치가 아니라 **사람이 눈으로 봐야** 한다 — `private/hwp-ab/*.{java,kordoc}.md`
  를 나란히 열어 판단할 것.
- PUA 정규화는 **kordoc도 한다**(2026-08-08 실측으로 확인). 다만 고르는
  글자가 다르다 — `U+F0A8`: 자체 `□`(U+25A1) vs kordoc `◻`(U+25FB),
  `U+F0FC`: `✓`(U+2713) vs `✔`(U+2714). 이 표본에선 해당 코드가 없어
  차이가 드러나지 않았다. 엔진을 바꾸면 **같은 체크박스가 다른 글자로**
  나올 수 있으니 전환 시 정규화 통일이 필요하다.

### 다음 작업 (여기서 이어가면 된다)

1. **표본 확보** — 실무 HWP5를 `private/` 에 모은다. 표·병합셀·체크박스 양식·
   이미지 다수 문서를 우선. 목표 5종 이상.
2. `node scripts/hwp-ab.mjs private/<디렉토리>` 로 일괄 실측 →
   `private/hwp-ab/summary.json`.
3. 산출물 육안 비교로 **표 표현 우열** 판정. 이게 K3의 실질 판단 기준이다.
4. kordoc 우세 확정 시 작업지시 3번(Java 제거) 착수 + 글리프 정규화 통일.

## 7. K4 — OCR · 이미지 입력 (제품 결정 필요)

- kordoc 내장 OCR(PP-OCRv5 korean)은 ONNX 로컬 추론 — API 키·외부 서비스 불필요.
  단, 모델 ~18MB 최초 다운로드와 네이티브 의존성(`onnxruntime-node`, `sharp`)이 붙는다.
- **결정 대기**: 모델을 인스톨러에 번들(`KORDOC_MODEL_CACHE`를 앱 리소스 경로로)
  vs 설정 화면의 opt-in 다운로드 버튼.
- 선행 실측: onnxruntime-node·sharp의 플랫폼별 크기, macOS 공증 통과 여부
  (전례: 번들 Node·JRE는 재서명 없이 통과 — CLAUDE.md 2026-08-04 항목).
- 구현 시: core `optionalDependencies`로 추가, 미설치 시 한국어 안내 에러
  (playwright-core 전례 패턴).

## 8. K5+ — 보류 (to-Markdown 범위 밖, GUI 트랙)

- `compare`: 문서 비교/신구대조표 (크로스 포맷, 셀 단위)
- `fillForm`/`extractFormSchema`: 양식 채우기 + 폼 UI 자동 생성
- `redactMarkdown`: 개인정보 마스킹

## 9. 참고

- kordoc 저장소: https://github.com/chrisryugj/kordoc (MIT). 소스 확인이 필요하면
  shallow clone. 오프라인 근거 문서: 저장소 `docs/offline-deployment.md`
- kordoc 자체가 rhwp(MIT)·한컴 OpenDataLoader(Apache-2.0)·PaddleOCR(Apache-2.0)
  등의 포팅 집합체이며 NOTICE로 고지함 — 우리도 `THIRD_PARTY_LICENSES.md`에
  kordoc·rhwp를 고지한다.
