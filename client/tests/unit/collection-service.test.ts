import { afterEach, describe, expect, it } from "vitest";
import type { Collection } from "../../src/schemas/collection.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import {
  IndexedDbCollectionService,
  NoopCollectionService,
  LUFTBALLONS_DB_VERSION,
  LUFTBALLONS_SCHEMA_VERSION,
} from "../../src/services/collection-service.js";

function sampleChannelData(): ChannelBasicData {
  return {
    channel: { channelName: "测试频道", channelId: "UC_test" },
    period: { label: "Last 28 days", start: "2026-08-01", end: "2026-08-28" },
    summary: { views: 1200, subscriberDelta: 15 },
    recentVideos: [
      {
        videoId: "vid1",
        title: "你好世界",
        views: 100,
        capturedAt: "2026-09-07T10:00:00.000Z",
        publishedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
}

function sampleCollection(
  overrides: Partial<Collection<ChannelBasicData>> = {},
): Collection<ChannelBasicData> {
  return {
    collectionId: "col-1",
    installationId: "inst-1",
    collector: "youtube.channel.basic",
    collectorVersion: 1,
    schemaVersion: LUFTBALLONS_SCHEMA_VERSION,
    capturedAt: "2026-09-07T12:00:00.000Z",
    status: "COMPLETE",
    data: sampleChannelData(),
    ...overrides,
  };
}

const openDbs: string[] = [];

function uniqueDbName(suffix: string): string {
  const name = `luftballons-test-${suffix}-${Math.random().toString(16).slice(2)}`;
  openDbs.push(name);
  return name;
}

async function deleteDb(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("NoopCollectionService", () => {
  it("accepts save and returns empty list / null get", async () => {
    const noop = new NoopCollectionService();
    await noop.save(sampleCollection());
    expect(await noop.get("col-1")).toBeNull();
    expect(await noop.list()).toEqual([]);
    await noop.delete("col-1");
  });
});

describe("IndexedDbCollectionService (P1-T1)", () => {
  afterEach(async () => {
    while (openDbs.length > 0) {
      const name = openDbs.pop();
      if (name) {
        await deleteDb(name);
      }
    }
  });

  it("persists across service instance rebuild (save → new instance → get)", async () => {
    const dbName = uniqueDbName("persist");
    const first = new IndexedDbCollectionService({ dbName });
    const collection = sampleCollection({ collectionId: "persist-1" });
    await first.save(collection);

    const second = new IndexedDbCollectionService({ dbName });
    const loaded = await second.get("persist-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.collectionId).toBe("persist-1");
    expect(loaded?.installationId).toBe("inst-1");
    expect(loaded?.collector).toBe("youtube.channel.basic");
    expect(loaded?.schemaVersion).toBe(LUFTBALLONS_SCHEMA_VERSION);
    expect(loaded?.capturedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(loaded?.status).toBe("COMPLETE");
    expect(loaded?.data).toEqual(collection.data);
  });

  it("lists summaries with itemCount and supports filter", async () => {
    const svc = new IndexedDbCollectionService({
      dbName: uniqueDbName("list"),
    });
    await svc.save(sampleCollection({ collectionId: "a", status: "COMPLETE" }));
    await svc.save(
      sampleCollection({
        collectionId: "b",
        status: "PARTIAL",
        collector: "other.collector",
        data: {
          ...sampleChannelData(),
          recentVideos: [
            ...sampleChannelData().recentVideos,
            {
              title: "二",
              views: 2,
              capturedAt: "2026-09-07T11:00:00.000Z",
            },
          ],
        },
      }),
    );

    const all = await svc.list();
    expect(all).toHaveLength(2);
    const a = all.find((s) => s.collectionId === "a");
    expect(a?.itemCount).toBe(1);

    const partial = await svc.list({ status: "PARTIAL" });
    expect(partial).toHaveLength(1);
    expect(partial[0]?.collectionId).toBe("b");
    expect(partial[0]?.itemCount).toBe(2);

    const byCollector = await svc.list({ collector: "youtube.channel.basic" });
    expect(byCollector).toHaveLength(1);
  });

  it("deletes by id", async () => {
    const svc = new IndexedDbCollectionService({
      dbName: uniqueDbName("del"),
    });
    await svc.save(sampleCollection({ collectionId: "gone" }));
    await svc.delete("gone");
    expect(await svc.get("gone")).toBeNull();
  });

  it("stores db_version and schema_version metadata", async () => {
    const svc = new IndexedDbCollectionService({
      dbName: uniqueDbName("meta"),
    });
    await svc.save(sampleCollection({ collectionId: "meta-check" }));
    const meta = await svc.getMeta();
    expect(meta.db_version).toBe(LUFTBALLONS_DB_VERSION);
    expect(meta.schema_version).toBe(LUFTBALLONS_SCHEMA_VERSION);
  });

  it("does not persist Date objects in capturedAt (ISO string only)", async () => {
    const svc = new IndexedDbCollectionService({
      dbName: uniqueDbName("iso"),
    });
    await svc.save(sampleCollection({ collectionId: "iso-1" }));
    const loaded = await svc.get("iso-1");
    expect(typeof loaded?.capturedAt).toBe("string");
    expect(loaded?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
