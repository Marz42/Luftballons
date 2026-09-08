import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };
const runtimeVersion = pkg.version;

export default defineConfig({
  define: {
    __LUFTBALLONS_RUNTIME_VERSION__: JSON.stringify(runtimeVersion),
  },
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
        version: runtimeVersion,
        description:
          "Local-first YouTube Studio automation runtime (Human-triggered, Fail-closed)",
        author: "Luftballons",
        match: [
          "https://www.youtube.com/*",
          "https://studio.youtube.com/*",
        ],
        grant: ["GM_getValue", "GM_setValue", "GM_deleteValue"],
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
