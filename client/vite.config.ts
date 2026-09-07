import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "Luftballons",
        namespace: "https://github.com/luftballons",
        version: "0.1.1",
        description:
          "Local-first YouTube Studio automation runtime (Human-triggered, Fail-closed)",
        author: "Luftballons",
        match: [
          "https://www.youtube.com/*",
          "https://studio.youtube.com/*",
        ],
        grant: "none",
        "run-at": "document-idle",
      },
      build: {
        fileName: "Luftballons.user.js",
        metaFileName: false,
      },
    }),
  ],
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
