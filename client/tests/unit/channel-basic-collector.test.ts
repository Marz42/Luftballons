import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import {
  IndexedDbCollectionService,
} from "../../src/services/collection-service.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("youtube.channel.basic collector (FT-009)", () => {
  let fixture: StudioFixtureHandle | undefined;
  const dbs: string[] = [];

  afterEach(async () => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
    for (const dbName of dbs.splice(0)) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  function makeRunner(
    module: ReturnType<typeof createFixtureChannelModule>,
  ) {
    const dbName = `luftballons-p3-${Math.random().toString(16).slice(2)}`;
    dbs.push(dbName);
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
    return { runner, collections };
  }

  it("P3-T1: produces a single COMPLETE Collection from fixture DOM", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const { runner, collections } = makeRunner(
      createFixtureChannelModule(fixture, {
        collectionId: "col-p3-complete",
        installationId: "inst-p3",
      }),
    );

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });

    const result = runner.getSnapshot(taskId).result;
    expect(result?.collectionIds).toEqual(["col-p3-complete"]);
    const stored = await collections.get("col-p3-complete");
    expect(stored?.status).toBe("COMPLETE");
    const data = stored?.data as ChannelBasicData;
    expect(data.channel.channelName).toBe("Demo Channel");
    expect(data.channel.channelId).toBe("UC_demo_channel");
    expect(data.summary.views).toBe(12_300);
    expect(data.summary.subscriberDelta).toBe(120);
    expect(data.recentVideos).toHaveLength(3);
    expect(data.recentVideos[0]?.title).toBe("Welcome to the channel");
    expect(data.recentVideos[1]?.views).toBe(5_500);
    expect(
      result?.warnings?.some((w) => w.code === "METRIC_DISPLAY_ROUNDED"),
    ).toBe(true);
  });

  it("navigates Analytics only when dashboard metrics are missing", async () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: {
        channelName: "Sparse Channel",
        periodLabel: "Last 7 days",
        analyticsViews: "9,999",
        analyticsSubscriberDelta: "+42",
        recentVideos: [
          {
            videoId: "v1",
            title: "Only one",
            publishedAt: "2026-09-01",
            viewsText: "100",
          },
        ],
      },
    });
    const { runner, collections } = makeRunner(
      createFixtureChannelModule(fixture, { collectionId: "col-analytics" }),
    );

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(["COMPLETED", "PARTIAL"]).toContain(runner.getState(taskId));
    });

    const stored = await collections.get("col-analytics");
    const data = stored?.data as ChannelBasicData;
    expect(data.summary.views).toBe(9_999);
    expect(data.summary.subscriberDelta).toBe(42);
    expect(fixture.href).toContain("/videos");
  });

  it("P3-T3: broken recent-video selector → PARTIAL + warning", async () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: {
        channelName: "Partial Channel",
        periodLabel: "Last 28 days",
        dashboardViews: "1000",
        dashboardSubscriberDelta: "10",
        recentVideos: [],
        omitVideoList: true,
      },
    });
    const { runner, collections } = makeRunner(
      createFixtureChannelModule(fixture, { collectionId: "col-partial" }),
    );

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("PARTIAL");
    });

    const result = runner.getSnapshot(taskId).result;
    expect(
      result?.warnings?.some((w) => w.code === "RECENT_VIDEOS_MISSING"),
    ).toBe(true);
    const stored = await collections.get("col-partial");
    expect(stored?.status).toBe("PARTIAL");
    const data = stored?.data as ChannelBasicData;
    expect(data.summary.views).toBe(1000);
    expect(data.recentVideos).toEqual([]);
  });

  it("P3-T5: cancel during Analytics→Content stops further nav; partial may remain", async () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: {
        channelName: "Cancel Channel",
        periodLabel: "Last 28 days",
        analyticsViews: "500",
        analyticsSubscriberDelta: "5",
        recentVideos: [
          {
            videoId: "v-cancel",
            title: "Should not be read",
            publishedAt: "2026-09-01",
            viewsText: "1",
          },
        ],
      },
    });

    const { runner, collections } = makeRunner(
      createFixtureChannelModule(fixture, {
        collectionId: "col-cancel",
        installationId: "inst-cancel",
      }),
    );

    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => fixture!.href.includes("/analytics"), {
      timeout: 2000,
    });
    await runner.cancel(taskId);

    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("CANCELLED");
    });

    expect(fixture.href.includes("/videos")).toBe(false);

    const list = await collections.list();
    if (list.length > 0) {
      const stored = await collections.get(list[0]!.collectionId);
      expect(stored?.status).toBe("PARTIAL");
      const data = stored?.data as ChannelBasicData;
      expect(
        data.recentVideos.every((v) => v.title !== "Should not be read"),
      ).toBe(true);
    }
  });

  it("unparseable placeholder metrics stay undefined (no fake zero)", async () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: {
        channelName: "Dash Channel",
        periodLabel: "Last 28 days",
        dashboardViews: "—",
        dashboardSubscriberDelta: "N/A",
        analyticsViews: "—",
        analyticsSubscriberDelta: "—",
        recentVideos: [
          {
            videoId: "v1",
            title: "Ok video",
            publishedAt: "2026-09-01",
            viewsText: "10",
          },
        ],
      },
    });
    const { runner, collections } = makeRunner(
      createFixtureChannelModule(fixture, { collectionId: "col-undef" }),
    );
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("PARTIAL");
    });
    const stored = await collections.get("col-undef");
    const data = stored?.data as ChannelBasicData;
    expect(data.summary.views).toBeUndefined();
    expect(data.summary.subscriberDelta).toBeUndefined();
  });
});
