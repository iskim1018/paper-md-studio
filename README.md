# docs-to-md

macOS 전용 문서 변환 도구. HWP, HWPX, DOCX, PDF 파일을 Markdown으로 변환합니다.

## 특징

- **CLI 지원**: 커맨드라인에서 바로 변환
- **다중 포맷**: HWP, HWPX, DOCX, PDF 지원
- **이미지 추출**: 문서 내 이미지를 별도 저장하고 MD에서 참조 (표 셀 내부 이미지 포함)
- **macOS 네이티브 앱**: Tauri 2.x 기반 GUI
- **내장 MD 에디터**: WYSIWYG / 소스 / 분할 모드 + 원본 미리보기 비교 + 다크모드
- **파일 저장 단축키**: `Cmd/Ctrl+S` 덮어쓰기, `Cmd/Ctrl+Shift+S` 다른 이름으로 저장

## 설치

```bash
# 저장소 클론
git clone <repository-url>
cd docs-to-md

# 의존성 설치
pnpm install

# 빌드
pnpm build
```

## 사용법

### CLI

```bash
# 단일 파일 변환
docs-to-md 문서.hwp          # HWP → HWPX → MD (Java 11+ 필요)
docs-to-md document.hwpx
docs-to-md report.docx -o ./output
docs-to-md paper.pdf --images-dir assets

# 도움말
docs-to-md --help
```

### GUI (Tauri 앱)

```bash
# 사전 요구사항: Rust 툴체인, Xcode Command Line Tools
#               (HWP 변환 시) Java 11+ 런타임 — sdkman/Homebrew 등
# sidecar 래퍼 설치 (최초 1회)
pnpm --filter @docs-to-md/app sidecar:install
# 개발 모드 실행
pnpm --filter @docs-to-md/app tauri dev
```

파일을 드래그 앤 드롭하면 원본 뷰어와 Markdown 결과가 나란히 표시됩니다.
변환된 `.md`와 이미지는 원본과 같은 디렉토리에 저장됩니다.

**편집 모드**: 변환 결과 패널 상단의 토글로 4가지 모드를 전환할 수 있습니다.

| 모드 | 설명 |
|------|------|
| 보기 | read-only `<pre>` 출력 |
| 편집 | Milkdown WYSIWYG 에디터 |
| 소스 | CodeMirror 6 Markdown 편집기 (문법 하이라이팅 + undo/redo) |
| 분할 | 좌측 편집기 + 우측 실시간 프리뷰 |

헤더 우측 테마 토글로 **시스템 / 라이트 / 다크** 전환, `localStorage`에 영속화됩니다.

### HWP 변환 툴체인 빌드 (개발자 전용)

HWP 바이너리는 Java 툴(`neolord0/hwp2hwpx`)로 HWPX로 선변환됩니다.
번들된 `packages/core/resources/hwp-to-hwpx.jar`을 재생성하려면:

```bash
pnpm build:hwp-tool  # Maven + JitPack (초기 ~수 분)
```

환경변수 `DOCS_TO_MD_HWP_JAR`로 커스텀 jar 경로를 지정할 수 있습니다.

### 지원 형식

| 형식 | 확장자 | 상태 | 비고 |
|------|--------|------|------|
| 한글 문서 (HWP 5.0) | `.hwp` | ✅ | Java 11+ 필요 (hwp2hwpx 경유) |
| 한글 문서 (HWPX) | `.hwpx` | ✅ | 표 셀 내부 이미지까지 추출 |
| Word 문서 | `.docx` | ✅ | mammoth + turndown |
| PDF | `.pdf` | ✅ | 텍스트 추출 (이미지 미지원) |
| Word 문서 (레거시) | `.doc` | v2 예정 | |

## 기술 스택

- **TypeScript** + Node.js 20+
- **pnpm** 모노레포 (core / cli / app / tools)
- **Biome** 린팅 & 포맷팅
- **Vitest** 단위/통합 테스트, **Playwright** E2E
- **Tauri 2.x** + React 19 (GUI)
- **Milkdown** (WYSIWYG) + **CodeMirror 6** (소스 편집) + **react-resizable-panels** (분할)
- **Java 11+** / Maven / `neolord0/hwp2hwpx` (HWP → HWPX 선변환, 선택적)

## 개발

```bash
pnpm install      # 의존성 설치
pnpm build        # 빌드
pnpm test         # 테스트
pnpm lint         # 린트
pnpm lint:fix     # 린트 자동 수정
```

## 라이선스

Private
