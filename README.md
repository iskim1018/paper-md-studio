# docs-to-md

macOS 전용 문서 변환 도구. HWPX, DOCX, PDF 파일을 Markdown으로 변환합니다.

## 특징

- **CLI 지원**: 커맨드라인에서 바로 변환
- **다중 포맷**: HWPX, DOCX, PDF 지원
- **이미지 추출**: 문서 내 이미지를 별도 저장하고 MD에서 참조
- **macOS 네이티브 앱**: Tauri 기반 GUI (개발 예정)

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
docs-to-md document.hwpx
docs-to-md report.docx -o ./output
docs-to-md paper.pdf --images-dir assets

# 도움말
docs-to-md --help
```

### 지원 형식

| 형식 | 확장자 | 상태 |
|------|--------|------|
| 한글 문서 (HWPX) | `.hwpx` | 개발 중 |
| Word 문서 | `.docx` | 개발 중 |
| PDF | `.pdf` | 개발 중 |
| 한글 문서 (HWP) | `.hwp` | v2 예정 |
| Word 문서 (레거시) | `.doc` | v2 예정 |

## 기술 스택

- **TypeScript** + Node.js 20+
- **pnpm** 모노레포 (core / cli / app)
- **Biome** 린팅 & 포맷팅
- **Vitest** 테스트
- **Tauri 2.x** + React (GUI, 예정)

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
