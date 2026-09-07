import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createChannelBasicStub } from "../../src/modules/youtube-studio-stubs.js";
import { createLogger } from "../../src/services/logger.js";
import {
  IndexedDbCollectionService,
  NoopCollectionService,
} from "../../src/services/collection-service.js";
import type { LuftballonsModule, TaskContext } from "../../src/runtime/types.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("TaskContext.collections injection", () => {
  it("defaults to NoopCollectionService when not injected", async () => {
    let seen: TaskContext["collections"] | undefined;
    const module: LuftballonsModule = {
      ...createChannelBasicStub({ wait: async () => {} }),
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
        href: "https://studio.youtube.com/",
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
    const dbName = `luftballons-ctx-${Math.random().toString(16).slice(2)}`;
    const collections = new IndexedDbCollectionService({ dbName });
    const module = createChannelBasicStub({
      wait: async () => {},
      collectionId: "from-stub",
      installationId: "inst-injected",
      mockData: {
        channel: { channelName: "Injected" },
        period: {},
        summary: { views: 1 },
        recentVideos: [
          {
            title: "One",
            views: 1,
            capturedAt: "2026-09-07T00:00:00.000Z",
          },
        ],
      },
    });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      collectionService: collections,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: "https://studio.youtube.com/",
      }),
    });

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });

    const snapshot = runner.getSnapshot(taskId);
    expect(snapshot.result?.collectionIds).toEqual(["from-stub"]);
    const stored = await collections.get("from-stub");
    expect(stored?.data).toMatchObject({
      channel: { channelName: "Injected" },
    });

    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("maps PARTIAL collection status to TaskResult PARTIAL", async () => {
    const module = createChannelBasicStub({
      wait: async () => {},
      collectionStatus: "PARTIAL",
    });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: "https://studio.youtube.com/",
      }),
    });
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("PARTIAL");
    });
  });
});
