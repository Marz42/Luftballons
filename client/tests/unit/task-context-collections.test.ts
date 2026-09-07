import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import {
  IndexedDbCollectionService,
  NoopCollectionService,
  createMockChannelBasicData,
} from "../../src/services/collection-service.js";
import type { LuftballonsModule, TaskContext } from "../../src/runtime/types.js";
import type { Collection } from "../../src/schemas/collection.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import { LUFTBALLONS_SCHEMA_VERSION } from "../../src/services/collection-service.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";
import { studioModuleAvailability } from "../../src/sites/youtube-studio/page-detector.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("TaskContext.collections injection", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  it("defaults to NoopCollectionService when not injected", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    let seen: TaskContext["collections"] | undefined;
    const module: LuftballonsModule = {
      ...createFixtureChannelModule(fixture),
      run: async (ctx) => {
        seen = ctx.collections;
        return { status: "COMPLETED", summary: "ok" };
      },
    };
    const registry = new ModuleRegistry();
    registry.register(module);
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
    expect(seen).toBeInstanceOf(NoopCollectionService);
    expect(runner.getCollections()).toBeInstanceOf(NoopCollectionService);
  });

  it("injects IndexedDbCollectionService into TaskContext", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const dbName = `luftballons-ctx-${Math.random().toString(16).slice(2)}`;
    const collections = new IndexedDbCollectionService({ dbName });
    const module = createFixtureChannelModule(fixture, {
      collectionId: "from-module",
      installationId: "inst-injected",
    });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      collectionService: collections,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(["COMPLETED", "PARTIAL"]).toContain(runner.getState(taskId));
    });

    const snapshot = runner.getSnapshot(taskId);
    expect(snapshot.result?.collectionIds).toEqual(["from-module"]);
    const stored = await collections.get("from-module");
    expect(stored?.data).toMatchObject({
      channel: { channelName: "Demo Channel" },
    });

    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("maps PARTIAL collection status to TaskResult PARTIAL", async () => {
    // Collector v2: Dashboard views readable + Analytics metrics missing (em dash)
    // → preserve Dashboard summary, missing subscriberDelta → PARTIAL (fast path).
    // (omitVideoList no longer works as a quick PARTIAL: content waitFor is ~5s.)
    fixture = mountStudioFixture({
      layout: "2026_V1",
      collector: {
        channelName: "Partial Via Fixture",
        periodLabel: "Last 28 days",
        dashboardViews: "100",
        analyticsViews: "—",
        analyticsSubscriberDelta: "—",
        recentVideos: [
          {
            videoId: "vid_partial_map",
            title: "Partial mapping video",
            publishedAt: "2026-09-01",
            viewsText: "10",
          },
        ],
      },
    });
    const module = createFixtureChannelModule(fixture);
    const registry = new ModuleRegistry();
    registry.register(module);
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
      expect(runner.getState(taskId)).toBe("PARTIAL");
    });
  });

  it("createMockChannelBasicData helper remains available for tests", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const mock = createMockChannelBasicData({
      channel: { channelName: "Mocked" },
    });
    const module: LuftballonsModule = {
      id: "youtube.channel.basic",
      name: "save-mock",
      version: "0.1.0",
      site: "youtube-studio",
      capabilities: ["READ", "NAVIGATE", "LOCAL_EXPORT"],
      detect: async (ctx) =>
        studioModuleAvailability({
          hostname: ctx.hostname,
          href: ctx.href,
          document,
        }),
      run: async (ctx) => {
        const collection: Collection<ChannelBasicData> = {
          collectionId: "mock-col",
          installationId: "inst",
          collector: "youtube.channel.basic",
          collectorVersion: 1,
          schemaVersion: LUFTBALLONS_SCHEMA_VERSION,
          capturedAt: new Date().toISOString(),
          status: "COMPLETE",
          data: mock,
        };
        await ctx.collections.save(collection);
        return {
          status: "COMPLETED",
          summary: "saved mock",
          collectionIds: ["mock-col"],
        };
      },
    };
    const dbName = `luftballons-mock-${Math.random().toString(16).slice(2)}`;
    const collections = new IndexedDbCollectionService({ dbName });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      collectionService: collections,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    const stored = await collections.get("mock-col");
    expect((stored?.data as ChannelBasicData).channel.channelName).toBe(
      "Mocked",
    );
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
});
