---
name: security-check
description: npm 의존성 보안 감사 및 코드 보안 점검을 실행합니다.
user_invocable: true
---

보안 점검을 수행합니다.

## 절차

1. `pnpm audit` 실행하여 알려진 취약점 확인
2. `pnpm outdated` 실행하여 업데이트 필요한 패키지 확인
3. 소스 코드에서 하드코딩된 시크릿 패턴 검색 (password, secret, api_key, token)
4. `.env` 파일이 `.gitignore`에 포함되어 있는지 확인
5. 결과를 심각도별로 분류하여 보고 (Critical/High/Medium/Low)
