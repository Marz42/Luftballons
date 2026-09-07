/**
 * Phase 6 / FT-018 — Network OFF / MANUAL semantic regression (§54–§55 / §60).
 *
 * ENABLED is reserved (not exposed in current UI); documented in SECURITY.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import {
  clearCachedRemoteConfig,
  resolveBootstrapConfig,
} from "../../src/services/config-service.js";
import {
  clearServerSettings,
  saveServerSettings,
} from "../../src/services/network-settings.js";
import { clearInstallation } from "../../src/schemas/installation.js";
import { createNetworkService } from "../../src/services/network-service.js";
import { createLogger } from "../../src/services/logger.js";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";
import {
  createAutoApproveGate,
  createFixtureSubtitleModule,
} from "./subtitle-multilang-test-utils.js";

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

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("Network OFF / MANUAL semantics (P6)", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
    clearCachedRemoteConfig();
    document.documentElement
      .querySelectorAll("[data-luftballons-root]")
      .forEach((el) => el.remove());
    document.body.replaceChildren();
  });

  it("OFF: refreshConfig/sendCollection/sendError make zero fetch calls", async () => {
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
      initialApplied: resolveBootstrapConfig(storage),
    });

    await network.refreshConfig();
    await network.sendCollection({
      collectionId: "c-off",
      installationId: "i1",
      collector: "youtube.channel.basic",
      collectorVersion: 1,
      schemaVersion: 1,
      capturedAt: "2026-09-08T00:00:00.000Z",
      status: "COMPLETE",
      data: {},
    });
    await network.sendError({ message: "boom" });

    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("MANUAL: bootstrap background refresh once; sync not automatic", async () => {
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ schemaVersion: 1, modules: {} }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const { runtime, panel } = await bootstrap({
      mount: false,
      backgroundConfigRefresh: true,
      modules: [],
    });

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    const calls = fetchImpl.mock.calls as unknown as unknown[][];
    const url = String(calls[0]?.[0] ?? "");
    expect(url).toContain("/api/v1/config");

    // No automatic collection sync on bootstrap.
    for (const call of calls) {
      const calledUrl = String(call[0] ?? "");
      expect(calledUrl).not.toContain("/api/v1/collections");
      expect(calledUrl).not.toContain("/api/v1/errors");
    }

    expect(runtime.network?.getNetworkMode()).toBe("MANUAL");
    panel.destroy();
    vi.unstubAllGlobals();
  });

  it("OFF: bootstrap background refresh does not fetch", async () => {
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "OFF",
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const { panel } = await bootstrap({
      mount: false,
      backgroundConfigRefresh: true,
      modules: [],
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    panel.destroy();
    vi.unstubAllGlobals();
  });
});

describe("Collector / subtitle tasks under OFF and MANUAL — zero network", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    clearServerSettings();
    clearInstallation();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("channel.basic COMPLETE under OFF → zero fetch", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "OFF",
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const registry = new ModuleRegistry();
    registry.register(
      createFixtureChannelModule(fixture, {
        collectionId: "col-off-channel",
        installationId: "inst-off",
      }),
    );
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("subtitle.multilang COMPLETE under MANUAL → zero fetch (no auto-sync)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [
          { code: "en", label: "English" },
          { code: "ja", label: "日本語" },
        ],
      },
    });
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const registry = new ModuleRegistry();
    registry.register(mod);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      humanGate: createAutoApproveGate(),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("subtitle.multilang COMPLETE under OFF → zero fetch", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "en", label: "English" }],
      },
    });
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "OFF",
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "en", label: "English" }],
    });
    const registry = new ModuleRegistry();
    registry.register(mod);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      humanGate: createAutoApproveGate(),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});
