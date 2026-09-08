/**
 * Phase 5b — Remote Config validation, cache priority, killSwitch, OFF mode.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_REMOTE_CONFIG,
  clearCachedRemoteConfig,
  fetchConfig,
  loadCachedRemoteConfig,
  REMOTE_CONFIG_STORAGE_KEY,
  resolveBootstrapConfig,
  saveCachedRemoteConfig,
  validateRemoteConfig,
  isRuntimeAtLeast,
} from "../../src/services/config-service.js";
import { withRemoteConfigGate } from "../../src/services/config-gate.js";
import {
  clearServerSettings,
  saveServerSettings,
} from "../../src/services/network-settings.js";
import { clearInstallation } from "../../src/schemas/installation.js";
import { createNetworkService } from "../../src/services/network-service.js";
import { createLogger } from "../../src/services/logger.js";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { ModuleUnavailableError } from "../../src/runtime/errors.js";
import type {
  LuftballonsModule,
  ModuleAvailability,
} from "../../src/runtime/types.js";
import type { AppliedConfigState } from "../../src/services/config-service.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_TOKEN = "test-token-placeholder-not-a-real-secret";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  } as Storage;
}

function availableModule(id = "youtube.channel.basic"): LuftballonsModule {
  return {
    id,
    name: "Test",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: ["READ"],
    detect: async (): Promise<ModuleAvailability> => ({ available: true }),
    run: async () => ({ status: "COMPLETED", summary: "ok" }),
  };
}

describe("validateRemoteConfig (P5-T6)", () => {
  it("accepts whitelist schema", () => {
    const result = validateRemoteConfig({
      schemaVersion: 1,
      modules: {
        "youtube.channel.basic": { enabled: true, killSwitch: false },
      },
      minRuntimeVersion: "0.1.0",
      features: { syncPreview: true },
      unknownRoot: "ignored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.modules["youtube.channel.basic"]?.enabled).toBe(true);
      expect(
        (result.config as { unknownRoot?: unknown }).unknownRoot,
      ).toBeUndefined();
    }
  });

  it("rejects wrong type enabled:\"yes\"", () => {
    const result = validateRemoteConfig({
      schemaVersion: 1,
      modules: { m: { enabled: "yes" } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects forbidden keys", () => {
    expect(
      validateRemoteConfig({
        schemaVersion: 1,
        modules: {},
        script: "alert(1)",
      }).ok,
    ).toBe(false);
    expect(
      validateRemoteConfig({
        schemaVersion: 1,
        modules: { m: { enabled: true, selector: ".x" } },
      }).ok,
    ).toBe(false);
  });

  it("rejects non-1 schemaVersion", () => {
    expect(
      validateRemoteConfig({ schemaVersion: 2, modules: {} }).ok,
    ).toBe(false);
  });
});

describe("config cache priority", () => {
  afterEach(() => {
    clearCachedRemoteConfig();
    clearServerSettings();
    clearInstallation();
  });

  it("Defaults when no cache", () => {
    clearCachedRemoteConfig();
    const state = resolveBootstrapConfig();
    expect(state.source).toBe("defaults");
    expect(state.config.schemaVersion).toBe(
      BUNDLED_REMOTE_CONFIG.schemaVersion,
    );
  });

  it("Cached > Defaults", () => {
    saveCachedRemoteConfig({
      payload: {
        schemaVersion: 1,
        modules: { "youtube.channel.basic": { enabled: false } },
      },
      fetchedAt: "2026-09-08T00:00:00.000Z",
      revision: 3,
    });
    const state = resolveBootstrapConfig();
    expect(state.source).toBe("cached");
    expect(state.config.modules["youtube.channel.basic"]?.enabled).toBe(false);
    expect(state.revision).toBe(3);
  });

  it("Fresh valid > Cached via network.refreshConfig", async () => {
    const storage = memoryStorage();
    saveCachedRemoteConfig(
      {
        payload: {
          schemaVersion: 1,
          modules: { "youtube.channel.basic": { enabled: true } },
        },
        fetchedAt: "2026-09-07T00:00:00.000Z",
      },
      storage,
    );
    saveServerSettings(
      {
        baseUrl: "http://127.0.0.1:8000",
        token: SAMPLE_TOKEN,
        networkMode: "MANUAL",
      },
      storage,
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            modules: {
              "youtube.channel.basic": { enabled: false, killSwitch: true },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      initialApplied: resolveBootstrapConfig(storage),
    });
    expect(network.getAppliedConfig().source).toBe("cached");
    const next = await network.refreshConfig();
    expect(next.source).toBe("fresh");
    expect(next.config.modules["youtube.channel.basic"]?.killSwitch).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("invalid JSON → keep cached", async () => {
    const storage = memoryStorage();
    saveCachedRemoteConfig(
      {
        payload: {
          schemaVersion: 1,
          modules: { "youtube.channel.basic": { enabled: true } },
        },
        fetchedAt: "2026-09-07T00:00:00.000Z",
      },
      storage,
    );
    saveServerSettings(
      {
        baseUrl: "http://127.0.0.1:8000",
        token: SAMPLE_TOKEN,
        networkMode: "MANUAL",
      },
      storage,
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response("not-json{{{", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      initialApplied: resolveBootstrapConfig(storage),
    });
    const before = network.getAppliedConfig().config;
    await network.refreshConfig();
    expect(network.getAppliedConfig().source).toBe("cached");
    expect(network.getAppliedConfig().config).toEqual(before);
    expect(network.getAppliedConfig().lastRefresh?.ok).toBe(false);
  });

  it("wrong type → reject use old config", async () => {
    const storage = memoryStorage();
    saveCachedRemoteConfig(
      {
        payload: { schemaVersion: 1, modules: {} },
        fetchedAt: "2026-09-07T00:00:00.000Z",
      },
      storage,
    );
    saveServerSettings(
      {
        baseUrl: "http://127.0.0.1:8000",
        token: SAMPLE_TOKEN,
        networkMode: "MANUAL",
      },
      storage,
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            modules: { m: { enabled: "yes" } },
          }),
          { status: 200 },
        ),
    );
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      initialApplied: resolveBootstrapConfig(storage),
    });
    await network.refreshConfig();
    expect(network.getAppliedConfig().source).toBe("cached");
    expect(network.getAppliedConfig().lastRefresh?.ok).toBe(false);
  });

  it("fetch failure → cached; no cache → defaults", async () => {
    const storage = memoryStorage();
    saveServerSettings(
      {
        baseUrl: "http://127.0.0.1:8000",
        token: SAMPLE_TOKEN,
        networkMode: "MANUAL",
      },
      storage,
    );
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(network.getAppliedConfig().source).toBe("defaults");
    await network.refreshConfig();
    expect(network.getAppliedConfig().source).toBe("defaults");
    expect(network.getAppliedConfig().lastRefresh?.ok).toBe(false);
  });
});

describe("killSwitch + minRuntimeVersion", () => {
  it("killSwitch=true → detect DISABLED", async () => {
    let applied: AppliedConfigState = {
      source: "fresh",
      config: {
        schemaVersion: 1,
        modules: {
          "youtube.channel.basic": { enabled: false, killSwitch: true },
        },
      },
    };
    const gated = withRemoteConfigGate(
      availableModule(),
      () => applied,
      "0.1.0",
    );
    const avail = await gated.detect({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
      logger: createLogger({ minLevel: "ERROR" }),
    });
    expect(avail.available).toBe(false);
    expect(avail.reason).toBe("DISABLED");
    expect(avail.metadata?.cause).toBe("killSwitch");
  });

  it("TaskRunner.start on DISABLED throws clear error", async () => {
    const applied: AppliedConfigState = {
      source: "cached",
      config: {
        schemaVersion: 1,
        modules: {
          "youtube.channel.basic": { enabled: false, killSwitch: true },
        },
      },
    };
    const registry = new ModuleRegistry();
    registry.register(
      withRemoteConfigGate(availableModule(), () => applied, "0.1.0"),
    );
    const runner = new TaskRunner({
      registry,
      logger: createLogger({ minLevel: "ERROR" }),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: "https://studio.youtube.com/",
      }),
    });
    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      ModuleUnavailableError,
    );
    await expect(runner.start("youtube.channel.basic")).rejects.toThrow(
      /DISABLED/,
    );
  });

  it("minRuntimeVersion unmet → DISABLED + metadata", async () => {
    const applied: AppliedConfigState = {
      source: "fresh",
      config: {
        schemaVersion: 1,
        modules: {},
        minRuntimeVersion: "9.0.0",
      },
    };
    const gated = withRemoteConfigGate(
      availableModule(),
      () => applied,
      "0.1.0",
    );
    const avail = await gated.detect({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
      logger: createLogger({ minLevel: "ERROR" }),
    });
    expect(avail.available).toBe(false);
    expect(avail.reason).toBe("DISABLED");
    expect(avail.metadata?.cause).toBe("minRuntimeVersion");
  });

  it("killSwitch ignored on bundled defaults source", async () => {
    const applied: AppliedConfigState = {
      source: "defaults",
      config: {
        schemaVersion: 1,
        modules: {
          "youtube.channel.basic": { enabled: false, killSwitch: true },
        },
      },
    };
    const gated = withRemoteConfigGate(
      availableModule(),
      () => applied,
      "0.1.0",
    );
    const avail = await gated.detect({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
      logger: createLogger({ minLevel: "ERROR" }),
    });
    expect(avail.available).toBe(true);
  });

  it("isRuntimeAtLeast compares dotted versions", () => {
    expect(isRuntimeAtLeast("0.1.0", "0.1.0")).toBe(true);
    expect(isRuntimeAtLeast("0.2.0", "0.1.9")).toBe(true);
    expect(isRuntimeAtLeast("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("OFF mode zero network", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
    clearCachedRemoteConfig();
  });

  it("refresh/sync/error make zero fetch calls", async () => {
    const storage = memoryStorage();
    saveServerSettings(
      {
        baseUrl: "http://127.0.0.1:8000",
        token: SAMPLE_TOKEN,
        networkMode: "OFF",
      },
      storage,
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await network.refreshConfig();
    await network.getConfig();
    await network.sendCollection({
      collectionId: "c1",
      installationId: "i1",
      collector: "youtube.channel.basic",
      collectorVersion: 1,
      schemaVersion: 1,
      capturedAt: "2026-09-08T00:00:00.000Z",
      status: "COMPLETE",
      data: {},
    });
    await network.sendError({ message: "boom" });
    await network.registerInstallation();

    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});

describe("fetchConfig helper", () => {
  it("returns FAILED on non-JSON body", async () => {
    const result = await fetchConfig({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      fetchImpl: (async () =>
        new Response("nope", { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("FAILED");
  });
});

describe("fetch egress allowlist (static)", () => {
  it("fetch( only in remote-sink / config-service", () => {
    const root = resolve(HERE, "../../src");
    const allowed = new Set([
      resolve(root, "sinks/remote-sink.ts"),
      resolve(root, "services/config-service.ts"),
    ]);
    const stack = [root];
    const offenders: string[] = [];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!full.endsWith(".ts")) {
          continue;
        }
        const src = readFileSync(full, "utf8");
        if (/GM_xmlhttpRequest/.test(src)) {
          offenders.push(full);
        }
        if (/\bfetch\s*\(/.test(src) && !allowed.has(full)) {
          offenders.push(full);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("withRemoteConfigGate extras", () => {
  it("preserves subtitle setTargetLanguages after gate wrap", () => {
    const applied: AppliedConfigState = {
      source: "defaults",
      config: { schemaVersion: 1, modules: {} },
    };
    const base = {
      ...availableModule("youtube.subtitle.multilang"),
      setTargetLanguages(languages: { code: string; label: string }[]) {
        void languages;
      },
      getTargetLanguages() {
        return [{ code: "fr", label: "Français" }];
      },
    };
    const gated = withRemoteConfigGate(base, () => applied, "0.1.0") as typeof base;
    expect(typeof gated.setTargetLanguages).toBe("function");
    expect(gated.getTargetLanguages()).toEqual([
      { code: "fr", label: "Français" },
    ]);
  });
});

describe("corrupt cache ignored", () => {
  it("loadCachedRemoteConfig returns null on bad payload", () => {
    const storage = memoryStorage();
    storage.setItem(
      REMOTE_CONFIG_STORAGE_KEY,
      JSON.stringify({ payload: { schemaVersion: 1, modules: { m: { enabled: "no" } } }, fetchedAt: "x" }),
    );
    expect(loadCachedRemoteConfig(storage)).toBeNull();
  });
});
