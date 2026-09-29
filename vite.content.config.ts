import { defineConfig } from "vite";

// content.ts는 chrome.scripting.registerContentScripts로 동적으로 등록하므로(manifest의
// static content_scripts를 쓰지 않음) @crxjs/vite-plugin의 번들링 대상이 아니다.
// 그래서 별도의 단순한 빌드로 dist/content.js를 만든다 (IIFE 하나짜리 순수 스크립트).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "__bookmarkshotContentScript",
      fileName: () => "content.js",
    },
  },
});
