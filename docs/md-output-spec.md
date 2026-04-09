# Markdown 출력 스펙

docs-to-md가 생성하는 Markdown은 **GFM(GitHub Flavored Markdown)** 을 기준으로 합니다.

## 변환 엔진

| 구성 요소 | 라이브러리 | 역할 |
|-----------|-----------|------|
| HTML → MD | Turndown | HTML을 Markdown으로 변환 |
| GFM 확장 | turndown-plugin-gfm | 테이블, 취소선, 태스크 리스트 지원 |

## Turndown 설정

| 옵션 | 값 | 설명 |
|------|----|------|
| `headingStyle` | `atx` | `# 제목` 형식 (setext 아님) |
| `hr` | `---` | 수평선 |
| `bulletListMarker` | `-` | 비순서 목록 마커 |
| `codeBlockStyle` | `fenced` | ` ``` ` 펜스 코드 블록 |
| `emDelimiter` | `*` | `*강조*` 형식 |

## 지원 요소

### 블록 요소

| 요소 | Markdown 출력 | 비고 |
|------|--------------|------|
| 제목 (h1~h6) | `# ~ ######` | ATX 스타일 |
| 단락 | 빈 줄로 구분 | |
| 비순서 목록 | `- 항목` | |
| 순서 목록 | `1. 항목` | |
| 테이블 | GFM 파이프 테이블 | `turndown-plugin-gfm` |
| 수평선 | `---` | |
| 코드 블록 | ` ``` ` 펜스 | |
| 인용문 | `> 인용` | |

### 인라인 요소

| 요소 | Markdown 출력 |
|------|--------------|
| 굵게 | `**텍스트**` |
| 기울임 | `*텍스트*` |
| 취소선 | `~~텍스트~~` |
| 인라인 코드 | `` `코드` `` |
| 링크 | `[텍스트](URL)` |
| 이미지 | `![대체텍스트](경로)` |

## 포맷별 변환 경로

```
HWPX  ──→  XML 직접 파싱  ──→  HTML  ──→  Turndown  ──→  GFM Markdown
DOCX  ──→  mammoth        ──→  HTML  ──→  Turndown  ──→  GFM Markdown
PDF   ──→  pdf2md         ──→  Markdown (직접)
```

- **HWPX**: ZIP 해제 → header.xml에서 스타일/볼드 파싱 → section XML에서 본문 추출 → HTML 생성 → Turndown
- **DOCX**: mammoth가 HTML로 변환 → Turndown
- **PDF**: pdf2md가 직접 Markdown 생성 (Turndown 미사용)

## 이미지 참조 (Phase 2 예정)

```markdown
![이미지 설명](./{문서명}_images/img_001.png)
```

- 이미지는 `{문서명}_images/` 디렉토리에 추출
- Markdown에서 상대경로로 참조
- `--images-dir` 옵션으로 디렉토리명 변경 가능

## 인코딩

- 출력 파일: UTF-8
- 줄바꿈: LF (`\n`)

## 알려진 제한사항

- PDF 변환은 레이아웃 기반이라 복잡한 단/표 구조에서 정확도가 떨어질 수 있음
- HWPX 스타일 매핑은 한글 기본 스타일명 기준 (커스텀 스타일은 일반 단락으로 처리)
- 수식(MathML, LaTeX)은 현재 미지원
