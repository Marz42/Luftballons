/**
 * Phase 6 / FT-018 — Remote Compromise Simulation (IMPLEMENTATION §61).
 *
 * Malicious remote config must be rejected wholesale: no fetch side-effects
 * beyond an explicit refresh that fails validation, no eval path, module
 * detect remains available on prior/default config, sync/refresh not applied.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedRemoteConfig,
  resolveBootstrapConfig,
  saveCachedRemoteConfig,
  validateRemoteConfig,
} from "../../src/services/config-service.js";
import { withRemoteConfigGate } from "../../src/services/config-gate.js";
import {
  clearServerSettings,
  saveServerSettings,
} from "../../src/services/network-settings.js";
import { clearInstallation } from "../../src/schemas/installation.js";
import { createNetworkService } from "../../src/services/network-service.js";
import { createLogger } from "../../src/services/logger.js";
import type {
  LuftballonsModule,
  ModuleAvailability,
} from "../../src/runtime/types.js";

const SAMPLE_TOKEN = "test-token-placeholder-not-a-real-secret";

/** IMPLEMENTATION §61 malicious payload (+ javascript/url extras). */
const MALICIOUS_CONFIG = {
  script: 'fetch("https://evil.example")',
  endpoint: "https://evil.example",
  selector: "#publish",
  command: "click",
  url: "https://evil.example/x",
  javascript: "alert(1)",
};

const MIXED_SMUGGLE = {
  schemaVersion: 1,
  modules: {
    "youtube.channel.basic": { enabled: true },
  },
  script: "evil()",
  endpoint: "https://evil.example",
  selector: "#publish",
  command: "click",
  url: "https://evil.example",
  javascript: "alert(1)",
};

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

describe("Remote Compromise Simulation (§61)", () => {
  afterEach(() => {
    clearCachedRemoteConfig();
    clearServerSettings();
    clearInstallation();
    vi.restoreAllMocks();
  });

  it("rejects pure malicious payload (forbidden keys)", () => {
    const result = validateRemoteConfig(MALICIOUS_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden/i);
    }
  });

  it("rejects mixed legal + malicious payload wholesale (anti-smuggle)", () => {
    const result = validateRemoteConfig(MIXED_SMUGGLE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden/i);
    }
  });

  it("malicious refresh: zero apply, prior config kept, detect still available, no sync", async () => {
    const storage = memoryStorage();
    saveCachedRemoteConfig(
      {
        payload: {
          schemaVersion: 1,
          modules: { "youtube.channel.basic": { enabled: true } },
        },
        fetchedAt: "2026-09-07T00:00:00.000Z",
        revision: 1,
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

    const evalSpy = vi.spyOn(globalThis, "eval" as never).mockImplementation(() => {
      throw new Error("eval must not be called");
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(MIXED_SMUGGLE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      initialApplied: resolveBootstrapConfig(storage),
      logger: createLogger({ minLevel: "ERROR", sink: () => {} }),
    });

    const before = network.getAppliedConfig();
    expect(before.source).toBe("cached");
    expect(before.config.modules["youtube.channel.basic"]?.enabled).toBe(true);

    const after = await network.refreshConfig();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(after.source).toBe("cached");
    expect(after.lastRefresh?.ok).toBe(false);
    expect(after.config.modules["youtube.channel.basic"]?.enabled).toBe(true);
    expect(evalSpy).not.toHaveBeenCalled();

    const gated = withRemoteConfigGate(
      availableModule(),
      () => network.getAppliedConfig(),
      "0.1.0",
    );
    const avail = await gated.detect({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
      logger: createLogger({ minLevel: "ERROR", sink: () => {} }),
    });
    expect(avail.available).toBe(true);

    // Sync must remain human-triggered; malicious config must not auto-sync.
    await network.sendCollection({
      collectionId: "c-compromise",
      installationId: "i1",
      collector: "youtube.channel.basic",
      collectorVersion: 1,
      schemaVersion: 1,
      capturedAt: "2026-09-08T00:00:00.000Z",
      status: "COMPLETE",
      data: {},
    });
    // One fetch for refresh + one for explicit sendCollection (MANUAL allows
    // human sync). Malicious config must not have injected extra fetches.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls as unknown as unknown[][]) {
      const url = String(call[0] ?? "");
      expect(url).not.toContain("evil.example");
    }
  });

  it("defaults remain usable when validate rejects and no cache exists", async () => {
    const storage = memoryStorage();
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
        new Response(JSON.stringify(MALICIOUS_CONFIG), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const network = createNetworkService({
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      initialApplied: resolveBootstrapConfig(storage),
    });
    expect(network.getAppliedConfig().source).toBe("defaults");
    const next = await network.refreshConfig();
    expect(next.source).toBe("defaults");
    expect(next.lastRefresh?.ok).toBe(false);

    const gated = withRemoteConfigGate(
      availableModule(),
      () => network.getAppliedConfig(),
      "0.1.0",
    );
    const avail = await gated.detect({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
      logger: createLogger({ minLevel: "ERROR", sink: () => {} }),
    });
    expect(avail.available).toBe(true);
  });
});
