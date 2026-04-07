---
name: convert-test
description: 문서 변환 파이프라인 테스트를 실행합니다.
user_invocable: true
---

변환 테스트를 실행합니다: $ARGUMENTS

## 테스트 절차

1. 인수가 특정 파일 형식이면 해당 변환기만 테스트:
   - hwpx: `pnpm test -- packages/core/tests/parsers/hwpx`
   - docx: `pnpm test -- packages/core/tests/parsers/docx`
   - pdf: `pnpm test -- packages/core/tests/parsers/pdf`
2. 인수가 없으면 전체 테스트 실행: `pnpm test`
3. 테스트 결과를 요약하여 보고
4. 실패한 테스트가 있으면 원인을 분석하고 수정 제안
