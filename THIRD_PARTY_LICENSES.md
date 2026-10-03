# Third-Party Licenses

Paper MD Studio는 다음 오픈소스 라이브러리 및 런타임을 사용합니다.

---

## Apache License 2.0

### pdfjs-dist (Mozilla PDF.js)

- 용도: PDF 파일 뷰어 렌더링
- 저장소: https://github.com/nicolo-ribaudo/pdfjs-dist
- 라이선스: Apache-2.0

### DOMPurify

- 용도: HTML 새니타이징 (XSS 방지)
- 저장소: https://github.com/cure53/DOMPurify
- 라이선스: Apache-2.0 OR MPL-2.0

### cfb (SheetJS js-cfb)

- 용도: OLE2(Compound File) 컨테이너 읽기 — `.xls`(BIFF8) 파서와 `.hwp` 사전
  검사(암호·DRM·압축 폭탄·중복 스트림)
- 배포 형태: CLI 단일 파일 번들(`index.js`)에 인라인된다
- 저장소: https://github.com/SheetJS/js-cfb
- 라이선스: Apache-2.0 — Copyright (C) 2013-present SheetJS LLC
- 전문: 아래 [부록 A](#부록-a--apache-license-20-전문)

### hml-equation-parser

- 용도: `packages/core/src/parsers/hwp-equation/`(한컴 수식 스크립트 → LaTeX)의
  원본 알고리즘과 치환표(`hulkEqParser.py`·`hulkReplaceMethod.py`·`convertMap.json`).
  kordoc(MIT)이 TypeScript 로 옮긴 것을 다시 이식·재작성했다
- 저장소: https://github.com/OpenBapul/hml-equation-parser
- 라이선스: Apache-2.0 — Copyright 2018 Open Bapul
- 상류 저장소에는 NOTICE 파일이 없다. 상류 `LICENSE` 는 Apache-2.0 표준 전문
  그대로라 부록의 저작권 줄이 `Copyright {yyyy} {name of copyright owner}`
  자리표시자로 남아 있다 — 위 저작권 표기는 kordoc 의 NOTICE 를 따랐다
  (2026-10-03 확인)
- 변경 사항(Apache-2.0 §4(b)): TypeScript 토큰 배열 기반 재작성, HWP5 사전
  정규화, 괄호 없는 인자 묶기, 최상위 `#` 줄바꿈 처리, GFM 표 셀·인라인 수식에
  안전한 escape, 짝 없는 괄호 보정 등. 파일별 상세는 각 소스 머리말에 적었다
- 전문: 아래 [부록 A](#부록-a--apache-license-20-전문)

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

### kordoc

- 용도: `packages/core/src/parsers/hwp-equation/` 수식 변환기의 출처 — kordoc
  4.7.2 의 `src/hwpx/equation.ts`·`src/hwp5/equation.ts` 를 이식·재작성했다.
  2026-10-03 부터 패키지 의존성으로는 쓰지 않는다 (예전에는 XLSX·XLS·HWP 3.x·
  HWPML 변환에 썼다)
- 저장소: https://github.com/chrisryugj/kordoc
- 라이선스: MIT — Copyright (c) 2026 chrisryugj
- 전문: 아래 [부록 C](#부록-c--mit-license-전문)
- 참고: kordoc 의 `src/hwpx/equation.ts` 자체가 hml-equation-parser(Apache-2.0)
  에서 파생됐다 — 위 Apache-2.0 절의 해당 항목 참고

### rhwp (@rhwp/core)

- 용도: ① `.hwp`(HWP 5.0·HWP 3.x·HWPML) → HWPX 변환 — core·CLI·REST 서버·MCP
  서버가 쓰며, CLI 번들(앱 사이드카 포함)에 `rhwp.js`·`rhwp_bg.wasm`·`LICENSE`
  를 동봉한다 ② 데스크톱 앱의 HWP·HWPX 뷰어 렌더링
- 버전: 0.8.6 (정확 핀)
- 저장소: https://github.com/edwardkim/rhwp
- 라이선스: MIT — Copyright (c) 2025-2026 Edward Kim
- WASM 에는 Rust 크레이트가 컴파일돼 들어 있다. 목록은 상류
  https://github.com/edwardkim/rhwp/blob/v0.8.6/THIRD_PARTY_LICENSES.md 참고.
  대부분 MIT·Apache-2.0 계열(일부 Zlib·Unlicense·0BSD·ISC·CC0·
  Unicode-DFS-2016)이다. 상류 목록이 직접 의존성으로 적은 것 중 바이너리
  재배포 시 고지가 필요한 BSD-3-Clause 는 `encoding_rs` 0.8.35(WHATWG Encoding
  Standard 데이터)와 `ed25519-dalek` 2.2.0 이라 고지 전문을 아래
  [부록 B](#부록-b--bsd-3-clause-고지-rhwp-wasm-포함분)에 싣는다

### @firecrawl/pdf-inspector

- 용도: PDF → Markdown 기본 엔진 (Rust/NAPI)
- 배포 형태: 플랫폼별 네이티브 바이너리(`pdf-inspector.<platform>.node`)와
  로더를 CLI 번들 옆 `node_modules` 에 동봉한다
- 버전: 1.14.2 (정확 핀)
- 저장소: https://github.com/firecrawl/pdf-inspector
- 라이선스: MIT — Copyright (c) 2026 Firecrawl (npm 패키지에 LICENSE 파일이
  없어 상류 저장소 기준)
- 전문: 아래 [부록 C](#부록-c--mit-license-전문)

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

- 버전: v22.23.3 (LTS) — 내려받은 압축 파일을 SHA-256 으로 검증한다
- 용도: CLI 변환 엔진 실행 런타임 (데스크톱 앱 사이드카)
- 저장소: https://github.com/nodejs/node
- 라이선스: MIT
- 전체 라이선스: https://github.com/nodejs/node/blob/main/LICENSE

> 0.7.0 부터 JRE(Eclipse Temurin)와 `hwp2hwpx` jar 는 배포에 포함되지 않습니다.

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

---

## 부록 A — Apache License 2.0 전문

cfb·hml-equation-parser·pdfjs-dist 등 Apache-2.0 항목에 적용된다. 아래는
hml-equation-parser 상류 `LICENSE` 파일 그대로다 (끝의 저작권 줄은 표준 전문의
자리표시자).

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

## 부록 B — BSD-3-Clause 고지 (rhwp WASM 포함분)

### encoding_rs 0.8.35 — WHATWG Encoding Standard 데이터

encoding_rs 본체는 Apache-2.0 OR MIT (Copyright Mozilla Foundation)이고, 그
안의 WHATWG Encoding Standard 유래 데이터에 아래 고지가 붙는다.

```text
Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ed25519-dalek 2.2.0

```text
Copyright (c) 2017-2019 isis agora lovecruft. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
```

## 부록 C — MIT License 전문

아래 저작권 표기마다 같은 허가 문구가 적용된다.

- kordoc — Copyright (c) 2026 chrisryugj
- @firecrawl/pdf-inspector — Copyright (c) 2026 Firecrawl
- rhwp (@rhwp/core) — Copyright (c) 2025-2026 Edward Kim

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
