# Test Fixtures

보안상 실제 문서 파일은 이 저장소에 포함되지 않습니다 (`.gitignore` 참고).

로컬 테스트를 실행하려면 다음 파일을 이 디렉토리에 직접 배치하세요:

| 파일명 | 용도 |
|--------|------|
| `sample.hwp` | HWP 바이너리 변환 테스트 (`hwp-parser.test.ts`) — Java 런타임 필요 |
| `sample.hwpx` | HWPX 변환 / 이미지 추출 테스트 |
| `sample.docx` | DOCX 변환 테스트 |
| `sample-with-image.docx` | DOCX 이미지 추출 테스트 |
| `sample.pdf` | PDF 변환 테스트 |

샘플 파일이 없으면 관련 테스트는 `describe.skipIf`로 **자동 skip**되며
단위/E2E 테스트 전체는 그대로 통과합니다.

## 재현 가능한 샘플 준비 가이드 (예시)

- HWPX: 임의의 한글 문서를 한컴오피스에서 "HWPX 형식"으로 저장
- HWP: 한컴오피스에서 "HWP 5.0 바이너리"로 저장
- DOCX/DOCX with image: Word/Google Docs 등에서 생성
- PDF: 임의 PDF (텍스트 기반 권장)
