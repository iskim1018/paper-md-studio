# CLAUDE.md

이 파일은 Claude Code가 이 저장소 작업 시 참고하는 가이드입니다.

## 프로젝트 개요

docs-to-md — macOS 전용 문서 변환 도구. HWPX, DOCX, PDF를 Markdown으로 변환합니다.
CLI-first 접근: 변환 엔진(core)을 먼저 구축하고, 이후 Tauri GUI(app)를 씌웁니다.

## 기술 스택

- **런타임**: Node.js 20+
- **언어**: TypeScript (strict mode)
- **GUI**: Tauri 2.x + React (Phase 3~)
- **빌드**: tsup (core/cli), Vite (app)
- **패키지 매니저**: pnpm (모노레포)
- **린트/포맷**: Biome
- **테스트**: Vitest

## 프로젝트 구조

```
packages/
├── core/    # 변환 엔진 라이브러리 (@docs-to-md/core)
├── cli/     # CLI 인터페이스 (@docs-to-md/cli)
└── app/     # Tauri GUI (Phase 3~, @docs-to-md/app)
```

## 명령어

```bash
pnpm install          # 의존성 설치
pnpm build            # 전체 빌드
pnpm test             # Vitest 테스트
pnpm lint             # Biome 검사
pnpm lint:fix         # Biome 자동 수정
pnpm format           # Biome 포맷
pnpm typecheck        # TypeScript 타입 검사
pnpm security         # npm 보안 감사
```

## MVP 범위 (v1)

- HWPX → Markdown (@ssabrojs/hwpxjs)
- DOCX → Markdown (mammoth + turndown)
- PDF → Markdown (unpdf 또는 @opendocsg/pdf2md)

v2 후순위: HWP(바이너리), DOC(레거시)

## 코딩 규칙

### TypeScript
- `any` 타입 사용 금지 → `unknown` 사용
- `Array<T>` 문법 사용 (`T[]` 금지)
- non-null assertion(`!`) 자제, 타입 가드 또는 early return 사용
- import 정렬은 Biome가 자동 처리
- CLI 패키지 외에는 `console.*` 사용 금지

### 네이밍
- 파일명: kebab-case (`html-to-md.ts`, `hwpx-parser.ts`)
- 타입/인터페이스: PascalCase (`ConvertResult`, `ImageAsset`)
- 함수/변수: camelCase (`detectFormat`, `inputPath`)
- 상수: UPPER_SNAKE_CASE (`FORMAT_MAP`)
- 테스트 파일: `{대상}.test.ts` (`pipeline.test.ts`)

### 파일 구조
- 한 파일에 하나의 주요 책임
- public API는 `index.ts`에서 re-export
- 테스트는 `tests/` 디렉토리에 소스 구조를 미러링

### 한글 파일명 (macOS NFD 대응)
- macOS는 파일명을 NFD로 저장하여 한글이 자모 분리됨
- 모든 파일 경로 진입점에서 `normalizePath()`로 NFC 정규화 필수
- `@docs-to-md/core`의 `normalizePath`, `normalizeToNFC` 사용

### 기타
- 모든 에러 메시지는 한국어로 작성
- 이미지 저장: `{문서명}_images/` 디렉토리, 상대경로 참조

## 커밋 컨벤션

Conventional Commits 형식:
```
<type>(<scope>): <설명>
```

- type: feat, fix, docs, style, refactor, test, chore, build, ci, perf, revert
- scope: core, cli, app, config 등

### Git Hooks (lefthook)

커밋 시 자동 실행:
- **pre-commit**: Biome lint + TypeScript 타입 검사
- **commit-msg**: Conventional Commits 형식 검증

## 주요 결정 로그

| 날짜 | 결정 | 근거 |
|------|------|------|
| 2026-04-07 | Tauri 2.x 선택 | 번들 크기, 성능, 보안 이점 |
| 2026-04-07 | CLI-first 개발 | 변환 품질 우선 검증 |
| 2026-04-07 | MVP: HWPX+DOCX+PDF | HWP/DOC 라이브러리 미성숙 |
| 2026-04-07 | pnpm 모노레포 | core/cli/app 패키지 분리, 재사용성 |
| 2026-04-07 | Biome 채택 | ESLint+Prettier 대체, 단일 도구 |
