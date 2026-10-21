/**
 * Family A (Content Hub) + warning/status semantics + fail-partial tests.
 * DOM shapes mirror docs/layout-family-a.md (2026-10-21 live pack).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import {
  IndexedDbCollectionService,
} from "../../src/services/collection-service.js";
import { createDomService } from "../../src/services/dom-service.js";
import { createNavigationService } from "../../src/sites/youtube-studio/navigation.js";
import { createChannelBasicModule } from "../../src/sites/youtube-studio/modules/channel-basic/module.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import {
  detectContentFamily,
  parseFamilyAVideos,
  familyAContentReady,
} from "../../src/sites/youtube-studio/modules/channel-basic/content-adapter.js";
import { isDisplayPlaceholder } from "../../src/sites/youtube-studio/modules/channel-basic/metrics.js";

function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

interface FamilyAFixtureOptions {
  channelName?: string;
  deltaText?: string; // dashboard trend text (default: empty node)
  analyticsDeltaText?: string; // #SUBSCRIBERS_NET_CHANGE-tab #metric-total
  cards?: Array<{
    id: string;
    title: string;
    date: string;
    viewsLabel: string;
  }>;
  includePlaylistCard?: boolean;
}

/** Hand-built DOM equivalent to the live family A surfaces. */
function mountFamilyAFixture(opts: FamilyAFixtureOptions = {}): void {
  const {
    channelName = "Demo Channel",
    deltaText = "",
    analyticsDeltaText = "—",
    cards = [
      { id: "AbCdEf12345", title: "Kancolle 2015", date: "2026年9月7日", viewsLabel: "16次观看" },
      { id: "GhIjKl67890", title: "Default title", date: "2026年4月9日", viewsLabel: "无人观看" },
    ],
    includePlaylistCard = true,
  } = opts;

  const drawer = el("ytcp-navigation-drawer", {}, [
    el("a", { href: "https://www.youtube.com/channel/UC_test/" }, ["outlet"]),
    el("a", { href: "/channel/UC_test" }, ["信息中心"]),
    el("a", { href: "/channel/UC_test/content" }, ["内容"]),
    el("a", { href: "/channel/UC_test/analytics/tab-overview/period-default" }, ["数据分析"]),
    el("div", { id: "entity-name" }, channelName ? [channelName] : []),
  ]);

  const facts = el("ytcd-channel-facts-item", {}, [
    el("div", { class: "section-title" }, [
      el("div", { class: "section-title-text" }, ["摘要"]),
      el("div", { class: "section-subtitle-text" }, ["过去 28 天"]),
    ]),
    el("div", { id: "metrics-table" }, [
      el("div", { class: "metric-row" }, [
        el("div", { class: "metric-title" }, ["观看次数"]),
        el("div", { id: "metric-0-value", class: "metric-value" }, ["42"]),
      ]),
      el("div", { class: "metric-row" }, [
        el("div", { class: "metric-title" }, ["订阅人数"]),
        el("div", { class: "subscribers-trend" }, deltaText ? [deltaText] : []),
      ]),
    ]),
  ]);

  const analytics = el("div", {}, [
    el("yta-time-picker", {}, [
      el("div", { id: "picker-trigger" }, [
        el("div", { class: "label-text" }, ["2026/9/23 – 2026/10/20"]),
        el("div", { class: "dropdown-trigger-text" }, ["过去 28 天"]),
      ]),
    ]),
    el("div", { id: "key-metric-blocks" }, [
      el("div", { id: "EXTERNAL_VIEWS-tab" }, [
        el("div", { id: "metric-total" }, ["42"]),
      ]),
      el("div", { id: "SUBSCRIBERS_NET_CHANGE-tab" }, [
        el("div", { id: "metric-total" }, [analyticsDeltaText]),
      ]),
    ]),
  ]);

  const cardNodes = cards.map((c) =>
    el("yt-lockup-view-model", { class: "ytLockupViewModelWrapper" }, [
      el("div", { class: `ytLockupViewModelHost content-id-${c.id}` }, [
        el("a", { class: "ytLockupViewModelContentImage", href: `/video/${c.id}/edit` }),
        el("h3", {}, [
          el("a", { class: "ytLockupMetadataViewModelTitle", href: `/video/${c.id}/edit` }, [c.title]),
        ]),
        el("div", { class: "ytLockupMetadataViewModelMetadata" }, [
          el("div", { class: "ytContentMetadataViewModelMetadataRow" }, [c.date]),
          el("div", { class: "ytContentMetadataViewModelMetadataRow" }, [
            el("span", { "aria-label": c.viewsLabel }),
            el("span", {}, [c.viewsLabel === "无人观看" ? "0" : c.viewsLabel.replace("次观看", "")]),
            el("span", { "aria-label": "没有评论" }),
          ]),
        ]),
      ]),
    ]),
  );
  if (includePlaylistCard) {
    cardNodes.push(
      el("yt-lockup-view-model", {}, [
        el("div", { class: "ytLockupViewModelHost content-id-PL4fTtgtANPNHtg4ifcAjNHYXws4Np14st" }, [
          el("h3", {}, [
            el("a", { class: "ytLockupMetadataViewModelTitle", href: "/playlist?list=PL4fTtgtANPNHtg4ifcAjNHYXws4Np14st" }, ["TEST"]),
          ]),
          el("div", { class: "ytLockupMetadataViewModelMetadata" }, [
            el("div", { class: "ytContentMetadataViewModelMetadataRow" }, ["2026年5月1日"]),
          ]),
        ]),
      ]),
    );
  }

  const feed = el("ytcp-section-list-renderer", { "data-target-id": "browse-feedFEcontent_hub" }, [
    el("horizontal-shelf-view-model", { class: "ytwHorizontalShelfViewModelHost" }, [
      el("div", { class: "ytwHorizontalShelfViewModelHeader" }, [
        el("yt-section-header-view-model", {}, ["视频查看全部"]),
      ]),
      el("div", { class: "ytwHorizontalShelfViewModelOuterContainer" }, [
        el("div", { class: "ytwHorizontalShelfViewModelItems" }, cardNodes),
      ]),
    ]),
    el("horizontal-shelf-view-model", { class: "ytwHorizontalShelfViewModelHost" }, [
      el("div", { class: "ytwHorizontalShelfViewModelHeader" }, [
        el("yt-section-header-view-model", {}, ["短视频查看全部"]),
      ]),
      el("div", { class: "ytwHorizontalShelfViewModelOuterContainer" }, [
        el("div", { class: "ytwHorizontalShelfViewModelItems" }, [
          el("yt-lockup-view-model", {}, [
            el("div", { class: "ytLockupViewModelHost content-id-ShortS123456" }, [
              el("h3", {}, [
                el("a", { class: "ytLockupMetadataViewModelTitle", href: "/video/ShortS123456/edit" }, ["A Short"]),
              ]),
              el("div", { class: "ytLockupMetadataViewModelMetadata" }, [
                el("div", { class: "ytContentMetadataViewModelMetadataRow" }, ["2026年5月1日"]),
                el("div", { class: "ytContentMetadataViewModelMetadataRow" }, [
                  el("span", { "aria-label": "7次观看" }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
    el("horizontal-shelf-view-model", { class: "ytwHorizontalShelfViewModelHost" }, [
      el("div", { class: "ytwHorizontalShelfViewModelHeader" }, [
        el("yt-section-header-view-model", {}, ["播放列表查看全部"]),
      ]),
      el("div", { class: "ytwHorizontalShelfViewModelOuterContainer" }, []),
    ]),
  ]);

  const app = el("ytcp-app", {}, [drawer, facts, analytics, feed]);
  // Deterministic page identity (docs/layout-family-a.md §0.2).
  app.append(el("ytcp-animatable", { class: "page selected", name: "channel" }));
  document.body.append(app);
}

/** Simulate SPA href + selected-page switching for navigation postconditions. */
function attachSpaSimulation(): { setHref: (href: string) => void; getHref: () => string } {
  const state = { href: "https://studio.youtube.com/channel/UC_test" };
  const pageHost = document.querySelector("ytcp-animatable.page.selected");
  return {
    getHref: () => state.href,
    setHref: (href: string) => {
      state.href = href;
      if (!pageHost) return;
      const name = href.includes("/analytics")
        ? "channel.analytics"
        : href.includes("/content")
          ? "channel.content"
          : href.includes("/translations")
            ? "video.translations"
            : href.includes("/edit")
              ? "video.edit"
              : "channel";
      pageHost.setAttribute("name", name);
    },
  };
}

describe("family A content adapter (docs/layout-family-a.md)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("detects the hub family and parses shelf cards (playlist cards excluded)", () => {
    mountFamilyAFixture();
    expect(detectContentFamily(document)).toBe("A_HUB");
    expect(familyAContentReady(document)).toBe(true);
    const videos = parseFamilyAVideos(document);
    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({
      videoId: "AbCdEf12345",
      title: "Kancolle 2015",
      views: 16,
      publishedAt: "2026年9月7日",
    });
    expect(videos[1]).toMatchObject({
      videoId: "GhIjKl67890",
      title: "Default title",
      views: 0,
    });
    // Playlist AND shorts cards must not enter the recent-videos dataset.
    expect(videos.some((v) => (v.videoId ?? "").startsWith("PL"))).toBe(false);
    expect(videos.some((v) => v.videoId === "ShortS123456")).toBe(false);
  });
});

describe("placeholder semantics (H5)", () => {
  it("treats dash glyphs and dash+chrome as absent, numbers as values", () => {
    expect(isDisplayPlaceholder("—")).toBe(true);
    expect(isDisplayPlaceholder("–")).toBe(true);
    expect(isDisplayPlaceholder("— 无法比较")).toBe(true);
    expect(isDisplayPlaceholder("")).toBe(true);
    expect(isDisplayPlaceholder(null)).toBe(true);
    expect(isDisplayPlaceholder("0")).toBe(false);
    expect(isDisplayPlaceholder("12.3K")).toBe(false);
    expect(isDisplayPlaceholder("+5")).toBe(false);
  });
});

describe("youtube.channel.basic on family A surfaces", () => {
  let dbs: string[] = [];

  afterEach(async () => {
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

  function runCollector() {
    mountFamilyAFixture();
    const spa = attachSpaSimulation();
    const dbName = `luftballons-fa-${Math.random().toString(16).slice(2)}`;
    dbs.push(dbName);
    const collections = new IndexedDbCollectionService({ dbName });
    const dom = createDomService();
    const navigation = createNavigationService({
      dom,
      getHref: spa.getHref,
      setHref: spa.setHref,
      defaultTimeoutMs: 500,
    });
    const module = createChannelBasicModule({
      dom,
      navigation,
      getHref: spa.getHref,
      detectDocument: document,
      collectionId: "col-family-a",
      installationId: "inst-fa",
    });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      collectionService: collections,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: spa.getHref(),
      }),
    });
    return { runner, collections };
  }

  it("captures hub cards instead of reporting 0 items", async () => {
    const { runner, collections } = runCollector();
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(["COMPLETED", "PARTIAL"]).toContain(runner.getState(taskId));
    });
    const stored = await collections.get("col-family-a");
    const data = stored?.data as ChannelBasicData;
    expect(data.recentVideos).toHaveLength(2);
    expect(data.recentVideos[0]?.videoId).toBe("AbCdEf12345");
    expect(data.recentVideos[0]?.views).toBe(16);
    expect(data.recentVideos[1]?.views).toBe(0);
    // Hub shelf scope is a known limitation → honest VIDEO_SCOPE_PARTIAL.
    expect(stored?.warnings?.some((w) => w.code === "VIDEO_SCOPE_PARTIAL")).toBe(true);
    // …but never the misleading CONTENT_LOAD_TIMEOUT on family A.
    expect(stored?.warnings?.some((w) => w.code === "CONTENT_LOAD_TIMEOUT")).toBe(false);
  });

  it("placeholder subscriber delta does not poison status with METRIC_UNPARSED", async () => {
    const { runner, collections } = runCollector();
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(["COMPLETED", "PARTIAL"]).toContain(runner.getState(taskId));
    });
    const stored = await collections.get("col-family-a");
    expect(stored?.warnings?.some((w) => w.code === "METRIC_UNPARSED")).toBe(false);
    // subscriberDelta legitimately absent in the UI → not a core-field failure.
    const result = runner.getSnapshot(taskId).result;
    expect(result?.summary).toContain("Saved channel collection");
  });

  it("persists warnings into the Collection record (observability)", async () => {
    const { runner, collections } = runCollector();
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(["COMPLETED", "PARTIAL"]).toContain(runner.getState(taskId));
    });
    const stored = await collections.get("col-family-a");
    expect(Array.isArray(stored?.warnings)).toBe(true);
    expect(stored?.warnings?.length).toBeGreaterThan(0);
  });

  it("fail-partial: a mid-run failure keeps already-read data (H1)", async () => {
    mountFamilyAFixture();
    const spa = attachSpaSimulation();
    const dbName = `luftballons-fa-${Math.random().toString(16).slice(2)}`;
    dbs.push(dbName);
    const collections = new IndexedDbCollectionService({ dbName });
    const dom = createDomService();
    const navigation = createNavigationService({
      dom,
      getHref: spa.getHref,
      setHref: spa.setHref,
      defaultTimeoutMs: 500,
    });
    // Break the CONTENT step after Dashboard/Analytics reads succeeded.
    const broken = {
      ...navigation,
      navigate: vi.fn(async (target: string, signal?: AbortSignal) => {
        if (target === "CONTENT") throw new Error("simulated nav failure");
        return navigation.navigate(
          target as Parameters<typeof navigation.navigate>[0],
          signal,
        );
      }),
      currentPage: () => "DASHBOARD" as const,
    };
    const module = createChannelBasicModule({
      dom,
      navigation: broken,
      getHref: spa.getHref,
      detectDocument: document,
      collectionId: "col-fail-partial",
      installationId: "inst-fa",
    });
    const registry = new ModuleRegistry();
    registry.register(module);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      collectionService: collections,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: spa.getHref(),
      }),
    });
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("PARTIAL");
    });
    const stored = await collections.get("col-fail-partial");
    expect(stored?.status).toBe("PARTIAL");
    const data = stored?.data as ChannelBasicData;
    expect(data.summary.views).toBe(42);
    expect(stored?.warnings?.some((w) => w.code === "COLLECTOR_ERROR")).toBe(true);
    // setProgress must have surfaced status (H3).
    expect(
      runner.getSnapshot(taskId).progressMessage ?? "",
    ).toContain("partial data retained");
  });
});
