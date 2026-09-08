import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_DEFAULTS } from "../../src/runtime/runtime.js";
import pkg from "../../package.json";

describe("runtime version single source of truth", () => {
  it("BUNDLED_DEFAULTS.runtimeVersion matches client/package.json", () => {
    expect(BUNDLED_DEFAULTS.runtimeVersion).toBe(pkg.version);
  });

  it("built userscript @version matches client/package.json when dist exists", () => {
    const distPath = resolve(__dirname, "../../dist/Luftballons.user.js");
    let header: string;
    try {
      header = readFileSync(distPath, "utf8").slice(0, 800);
    } catch {
      // Dist optional for unit-only runs; build gate covers this.
      return;
    }
    const match = header.match(/@version\s+(\S+)/);
    expect(match?.[1]).toBe(pkg.version);
    expect(match?.[1]).toBe(BUNDLED_DEFAULTS.runtimeVersion);
  });
});
