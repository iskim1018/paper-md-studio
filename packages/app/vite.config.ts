import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // micromark 가 쓰는 엔티티 디코더는 `browser` 조건에서 `document` 로
      // 디코드하는 빌드를 낸다. 미리보기 Markdown 은 Web Worker 에서 파싱하는데
      // (lib/markdown-html.worker.ts) Worker 에는 document 가 없어 로드 즉시
      // 죽고, 메인 스레드 대체 경로로 떨어져 큰 문서에서 앱이 멈췄다.
      // 표 기반 빌드(index.js)로 고정한다 — 메인 스레드에서도 결과는 같다.
      // micromark 를 올릴 때 이 패키지의 메이저가 바뀌었는지 다시 확인한다.
      {
        find: /^decode-named-character-reference$/,
        replacement: require.resolve("decode-named-character-reference"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    exclude: ["**/tests/e2e/**", "**/node_modules/**"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
