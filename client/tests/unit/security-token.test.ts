/**
 * Phase 6 / FT-018 — Token handling audit (IMPLEMENTATION §59).
 *
 * Client logs must never contain token plaintext (sync success + failure).
 * Server JSON responses must not echo token except register (shown once).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../src/runtime/types.js";
import { clearInstallation } from "../../src/schemas/installation.js";
import {
  clearServerSettings,
  STORAGE_KEYS,
  saveServerSettings,
  getServerSettings,
  getTokenStorage,
  createMemorySecretStorage,
  setTokenStorage,
} from "../../src/services/network-settings.js";
import { createNetworkService } from "../../src/services/network-service.js";
import { createLogger } from "../../src/services/logger.js";
import type { Collection } from "../../src/schemas/collection.js";

const SAMPLE_TOKEN = "p6-token-audit-secret-do-not-leak";

function sampleCollection(): Collection<{ n: number }> {
  return {
    collectionId: "col-token-audit",
    installationId: "inst-token-audit",
    collector: "youtube.channel.basic",
    collectorVersion: 2,
    schemaVersion: 1,
    capturedAt: "2026-09-08T00:00:00.000Z",
    status: "COMPLETE",
    data: { n: 1 },
  };
}

function captureLogger(): { logger: ReturnType<typeof createLogger>; blob: () => string } {
  const entries: LogEntry[] = [];
  const logger = createLogger({
    minLevel: "DEBUG",
    sink: (entry) => {
      entries.push(entry);
    },
  });
  return {
    logger,
    blob: () => JSON.stringify(entries),
  };
}

describe("Token handling (§59)", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
    setTokenStorage(createMemorySecretStorage());
  });

  it("stores token in private storage, not page localStorage", () => {
    expect(STORAGE_KEYS.token).toBe("luftballons.server.token");
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(getTokenStorage().get(STORAGE_KEYS.token)).toBe(SAMPLE_TOKEN);
    expect(getServerSettings().token).toBe(SAMPLE_TOKEN);
  });

  it("migrates legacy localStorage token into private storage once", () => {
    localStorage.setItem(STORAGE_KEYS.token, SAMPLE_TOKEN);
    const settings = getServerSettings();
    expect(settings.token).toBe(SAMPLE_TOKEN);
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(getTokenStorage().get(STORAGE_KEYS.token)).toBe(SAMPLE_TOKEN);
  });

  it("sync success path logs never contain token plaintext", async () => {
    const { logger, blob } = captureLogger();
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ already_ingested: false }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const network = createNetworkService({
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    network.saveSettings({ token: SAMPLE_TOKEN });
    const result = await network.sendCollection(sampleCollection());
    expect(result.status).toBe("OK");
    expect(blob()).not.toContain(SAMPLE_TOKEN);
  });

  it("sync failure path logs never contain token plaintext", async () => {
    const { logger, blob } = captureLogger();
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const network = createNetworkService({
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    network.saveSettings({ token: SAMPLE_TOKEN, baseUrl: "http://127.0.0.1:8000" });
    const result = await network.sendCollection(sampleCollection());
    expect(result.status).toBe("FAILED");
    expect(blob()).not.toContain(SAMPLE_TOKEN);
  });

  it("config refresh failure logs never contain token plaintext", async () => {
    const { logger, blob } = captureLogger();
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(async () => new Response("err", { status: 401 }));
    const network = createNetworkService({
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await network.refreshConfig();
    expect(blob()).not.toContain(SAMPLE_TOKEN);
  });
});
