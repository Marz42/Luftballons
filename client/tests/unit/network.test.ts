/**
 * RemoteSink + NetworkService Phase 5a tests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Collection } from "../../src/schemas/collection.js";
import { clearInstallation } from "../../src/schemas/installation.js";
import {
  clearServerSettings,
  getServerSettings,
  saveServerSettings,
} from "../../src/services/network-settings.js";
import { createNetworkService } from "../../src/services/network-service.js";
import { createLogger } from "../../src/services/logger.js";
import {
  assertHttpBaseUrl,
  ENDPOINT_PATHS,
  RemoteSink,
  resolveEndpoint,
  sendCollection,
} from "../../src/sinks/remote-sink.js";
import { IndexedDbCollectionService } from "../../src/services/collection-service.js";

const SAMPLE_TOKEN = "test-token-placeholder-not-a-real-secret";
const HERE = dirname(fileURLToPath(import.meta.url));

function sampleCollection(
  overrides: Partial<Collection<{ n: number }>> = {},
): Collection<{ n: number }> {
  return {
    collectionId: "col-net-1",
    installationId: "inst-net-1",
    collector: "youtube.channel.basic",
    collectorVersion: 2,
    schemaVersion: 1,
    capturedAt: "2026-09-07T12:00:00.000Z",
    status: "COMPLETE",
    data: { n: 1 },
    ...overrides,
  };
}

describe("remote endpoint helpers", () => {
  it("rejects non-http(s) baseUrl", () => {
    expect(() => assertHttpBaseUrl("ftp://evil")).toThrow(/http/);
    expect(() => assertHttpBaseUrl("javascript:alert(1)")).toThrow();
    expect(() => assertHttpBaseUrl("")).toThrow();
  });

  it("joins baseUrl path prefix with fixed ingest path", () => {
    expect(resolveEndpoint("http://192.168.2.10:8000", "ingestV1")).toBe(
      `http://192.168.2.10:8000${ENDPOINT_PATHS.ingestV1}`,
    );
    expect(
      resolveEndpoint("https://proxy.example/luftballons/", "ingestV1"),
    ).toBe(`https://proxy.example/luftballons${ENDPOINT_PATHS.ingestV1}`);
    expect(ENDPOINT_PATHS.ingestV1).toBe("/api/v1/collections");
  });
});

describe("RemoteSink sendCollection", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
    vi.unstubAllGlobals();
  });

  it("FAILED on HTTP 500 and does not imply local deletion", async () => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: 500 }));
    const result = await sendCollection(sampleCollection(), {
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe("FAILED");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("FAILED on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await sendCollection(sampleCollection(), {
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/网络/);
  });

  it("sync success leaves local collection intact (retain decision)", async () => {
    const dbName = `luftballons-sync-keep-${Math.random().toString(16).slice(2)}`;
    const collections = new IndexedDbCollectionService({ dbName });
    const collection = sampleCollection();
    await collections.save(collection);

    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ already_ingested: false }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const network = createNetworkService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });

    const result = await network.sendCollection(collection);
    expect(result.status).toBe("OK");
    expect(await collections.get(collection.collectionId)).toEqual(collection);

    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
});

describe("NetworkMode", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
  });

  it("OFF blocks sendCollection without calling fetch", async () => {
    const fetchImpl = vi.fn();
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "OFF",
    });
    const network = createNetworkService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await network.sendCollection(sampleCollection());
    expect(result.status).toBe("FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("MANUAL does not auto-fetch — only explicit sendCollection triggers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ already_ingested: false }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const network = createNetworkService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // Constructing service / reading settings must not network.
    expect(network.getNetworkMode()).toBe("MANUAL");
    expect(fetchImpl).not.toHaveBeenCalled();
    await network.sendCollection(sampleCollection());
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("RemoteSink.write respects OFF without fetch", async () => {
    const fetchImpl = vi.fn();
    const sink = new RemoteSink({
      getBaseUrl: () => "http://127.0.0.1:8000",
      getToken: () => SAMPLE_TOKEN,
      isSendAllowed: () => false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await sink.write(sampleCollection());
    expect(result.status).toBe("FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("token never enters logs", () => {
  afterEach(() => {
    clearServerSettings();
    clearInstallation();
  });

  it("logger sink never receives token plaintext", async () => {
    const entries: string[] = [];
    const logger = createLogger({
      minLevel: "DEBUG",
      sink: (entry) => {
        entries.push(JSON.stringify(entry));
      },
    });
    saveServerSettings({
      baseUrl: "http://127.0.0.1:8000",
      token: SAMPLE_TOKEN,
      networkMode: "MANUAL",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            installation_id: "new-id",
            token: SAMPLE_TOKEN,
            api_version: "1",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    const network = createNetworkService({
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    network.saveSettings({ token: SAMPLE_TOKEN, baseUrl: "http://127.0.0.1:8000" });
    await network.registerInstallation({ displayName: "PC-A" });
    await network.sendCollection(sampleCollection());

    const blob = entries.join("\n");
    expect(blob).not.toContain(SAMPLE_TOKEN);
  });
});

describe("network settings defaults", () => {
  afterEach(() => {
    clearServerSettings();
  });

  it("defaults to MANUAL when unset", () => {
    clearServerSettings();
    expect(getServerSettings().networkMode).toBe("MANUAL");
  });
});

describe("fetch egress allowlist (static)", () => {
  it("fetch( only appears in remote-sink (sole network egress)", () => {
    const root = resolve(HERE, "../../src");
    const allowed = new Set([resolve(root, "sinks/remote-sink.ts")]);
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
