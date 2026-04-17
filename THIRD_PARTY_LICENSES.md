# Third-Party Licenses

Paper MD Studio는 다음 오픈소스 라이브러리 및 런타임을 사용합니다.

---

## Apache License 2.0

### neolord0/hwp2hwpx

- 용도: HWP 5.0 바이너리를 HWPX(OWPML) 형식으로 변환
- 저장소: https://github.com/neolord0/hwp2hwpx
- 라이선스: Apache-2.0
- 내부 의존성: `kr.dogfoot:hwplib` (Apache-2.0), `kr.dogfoot:hwpxlib` (Apache-2.0)

### pdfjs-dist (Mozilla PDF.js)

- 용도: PDF 파일 뷰어 렌더링
- 저장소: https://github.com/nicolo-ribaudo/pdfjs-dist
- 라이선스: Apache-2.0

### DOMPurify

- 용도: HTML 새니타이징 (XSS 방지)
- 저장소: https://github.com/cure53/DOMPurify
- 라이선스: Apache-2.0 OR MPL-2.0

---

## BSD 2-Clause License

### mammoth

- 용도: DOCX를 HTML로 변환
- 저장소: https://github.com/mwilliamson/mammoth.js
- 라이선스: BSD-2-Clause

---

## MIT License

### Tauri

- 패키지: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-shell`, `tauri` (Rust crate), `tauri-build`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-fs`
- 저장소: https://github.com/tauri-apps/tauri
- 라이선스: MIT OR Apache-2.0

### React

- 패키지: `react`, `react-dom`
- 저장소: https://github.com/facebook/react
- 라이선스: MIT

### Milkdown

- 패키지: `@milkdown/crepe`, `@milkdown/kit`, `@milkdown/preset-commonmark`, `@milkdown/preset-gfm`, `@milkdown/react`, `@milkdown/theme-nord`
- 저장소: https://github.com/Milkdown/milkdown
- 라이선스: MIT

### CodeMirror

- 패키지: `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/state`, `@codemirror/theme-one-dark`, `@codemirror/view`
- 저장소: https://github.com/codemirror/dev
- 라이선스: MIT

### turndown

- 용도: HTML을 Markdown으로 변환
- 저장소: https://github.com/mixmark-io/turndown
- 라이선스: MIT

### turndown-plugin-gfm

- 용도: Turndown GFM(GitHub Flavored Markdown) 확장
- 저장소: https://github.com/mixmark-io/turndown-plugin-gfm
- 라이선스: MIT

### fast-xml-parser

- 용도: HWPX XML 파싱
- 저장소: https://github.com/NaturalIntelligence/fast-xml-parser
- 라이선스: MIT

### fflate

- 용도: ZIP/압축 해제 (HWPX 아카이브 추출)
- 저장소: https://github.com/101arrowz/fflate
- 라이선스: MIT

### @opendocsg/pdf2md

- 용도: PDF 텍스트를 Markdown으로 변환
- 저장소: https://github.com/nicolo-ribaudo/pdf2md
- 라이선스: MIT

### zustand

- 용도: React 상태 관리
- 저장소: https://github.com/pmndrs/zustand
- 라이선스: MIT

### react-markdown

- 용도: Markdown 렌더링 (보기/분할 모드)
- 저장소: https://github.com/remarkjs/react-markdown
- 라이선스: MIT

### remark-gfm

- 용도: GFM 지원 (테이블, 체크박스 등)
- 저장소: https://github.com/remarkjs/remark-gfm
- 라이선스: MIT

### react-resizable-panels

- 용도: 분할 패널 레이아웃
- 저장소: https://github.com/bvaughn/react-resizable-panels
- 라이선스: MIT

### serde / serde_json (Rust)

- 용도: Rust 직렬화/역직렬화
- 저장소: https://github.com/serde-rs/serde
- 라이선스: MIT OR Apache-2.0

---

## ISC License

### lucide-react

- 용도: UI 아이콘
- 저장소: https://github.com/lucide-icons/lucide
- 라이선스: ISC

---

## 번들 런타임

### Node.js

- 버전: v20.18.0 (LTS)
- 용도: CLI 변환 엔진 실행 런타임
- 저장소: https://github.com/nodejs/node
- 라이선스: MIT
- 전체 라이선스: https://github.com/nodejs/node/blob/main/LICENSE

### Eclipse Temurin JRE

- 용도: HWP 변환 Java 툴체인 실행 (jlink 최소 번들)
- 저장소: https://github.com/adoptium/temurin-build
- 라이선스: GPL-2.0 with Classpath Exception
- 전체 라이선스: https://openjdk.org/legal/gplv2+ce.html
- 참고: Classpath Exception에 의해 JRE를 애플리케이션과 함께 배포할 수 있으며, 애플리케이션 자체에 GPL 의무가 전파되지 않습니다.

---

## 개발 도구 (번들에 포함되지 않음)

아래 도구들은 개발 시에만 사용되며 배포 바이너리에 포함되지 않습니다:

- **Biome** (MIT) — 린팅 및 포맷팅
- **Vitest** (MIT) — 테스트 프레임워크
- **Playwright** (Apache-2.0) — E2E 테스트
- **tsup** (MIT) — TypeScript 번들러
- **Vite** (MIT) — 프론트엔드 빌드 도구
- **Tailwind CSS** (MIT) — 유틸리티 CSS 프레임워크
- **lefthook** (MIT) — Git hooks 관리
