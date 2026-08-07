# kordoc 통합 계획 · 작업지시서

> 이 문서는 다른 세션·모델(Opus 등)·장비에서 작업을 이어받을 수 있도록
> 배경, 결정, 완료 상태, 다음 단계의 작업지시를 자족적으로 기록한다.
> 마지막 갱신: 2026-08-07 (K1 완료 시점)

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

### 미해결 후속 항목 (K1 범위 밖으로 미룸)

- [ ] **app GUI**: `packages/app/src/store/file-store.ts`가 core와 무관한 자체
  `DocumentFormat` 타입·확장자 목록을 가짐 — xlsx/xls를 GUI에서 열려면 확장 필요
  (파일 다이얼로그 필터 포함)
- [ ] **mcp**: `packages/mcp/src/input-resolver.ts`의 `SUPPORTED_EXTS`에
  `.xlsx`/`.xls` 추가
- [ ] server `convert-cache.test.ts`에 xlsx/xls 케이스 추가 (매핑 자체는
  `Record<DocumentFormat,…>` 전수성으로 typecheck가 보증)
- [ ] `rewriteImageRefs`는 문자열 일치 치환이라 kordoc이 참조를 인코딩하면
  조용히 no-op (저위험 — kordoc은 `image_NNN.ext` 순차 명명)

## 5. K2 — PDF A/B 실측 (다음 작업)

**목표**: 현행 PDF 파이프라인(pdf2md + `pdf-text-runs.ts`/`pdf-postprocess.ts`
보정) vs kordoc PDF 파서를 실측 비교해 위임 범위를 결정.

**작업지시**:

1. kordoc PDF 경로는 optionalDependency `pdfjs-dist`가 필요하다. core에 이미
   pdf 스택이 있으므로 충돌 없는지 확인 후 설치.
2. 비교 스크립트 작성 (scratch, 커밋 불필요): 같은 PDF를 (a) `convert()`,
   (b) kordoc `parse(buffer)` 로 각각 변환해 나란히 저장.
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

## 6. K3 — HWP5 Java 툴체인 대체 실험

**목표**: kordoc의 순수 TS HWP5 파서로 Java(jar+JRE) 번들을 제거할 수 있는지 검증.

**작업지시**:

1. `HwpParser`에 환경변수 플래그(예: `PAPER_MD_STUDIO_HWP_ENGINE=kordoc`)로
   kordoc 직파싱 경로를 병행 추가 (기본값은 기존 Java 경로 유지).
2. 실무 HWP5 코퍼스로 (a) Java→HWPX→자체 파서, (b) kordoc 직파싱 결과 비교.
   표·이미지·PUA 심볼(체크박스 등)·중첩표 평탄화 규약 차이에 유의.
3. 통과 시 제거 대상: `packages/core/resources/hwp-to-hwpx.jar`,
   `tools/hwp-to-hwpx/`, `build:hwp-tool` 스크립트, app의 JRE 번들,
   CLI·README의 "Java 11+ 필요" 문구. **설치본 수십 MB 경량화 + 공증 단순화**가 보상.

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

- `patchHwpx`/`HwpxSession`: 에디터에서 "원본 HWPX로 저장" — 2026-08-03에
  보류한 MD→HWPX를 "생성"이 아닌 "원본 패치"로 재정의하는 접근
- `compare`: 문서 비교/신구대조표 (크로스 포맷, 셀 단위)
- `fillForm`/`extractFormSchema`: 양식 채우기 + 폼 UI 자동 생성
- `redactMarkdown`: 개인정보 마스킹

## 9. 참고

- kordoc 저장소: https://github.com/chrisryugj/kordoc (MIT). 소스 확인이 필요하면
  shallow clone. 오프라인 근거 문서: 저장소 `docs/offline-deployment.md`
- kordoc 자체가 rhwp(MIT)·한컴 OpenDataLoader(Apache-2.0)·PaddleOCR(Apache-2.0)
  등의 포팅 집합체이며 NOTICE로 고지함 — 우리도 `THIRD_PARTY_LICENSES.md`에
  kordoc·rhwp를 고지한다.
