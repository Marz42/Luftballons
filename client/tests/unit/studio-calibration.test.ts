import { afterEach, describe, expect, it } from "vitest";
import { createDomService } from "../../src/services/dom-service.js";
import { getTarget } from "../../src/sites/youtube-studio/selectors.js";
import { runChannelBasicCollector } from "../../src/sites/youtube-studio/modules/channel-basic/collector.js";
import type { TaskContext } from "../../src/runtime/types.js";
import type { Collection } from "../../src/schemas/collection.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import type { StudioTarget } from "../../src/sites/youtube-studio/selectors.js";

// Minimal sanitized structures from the 2026-09-07 user-supplied DOM.
// Values/variants beyond the observed zero/dash/single row are synthetic tests.
const dashboard = `<ytcp-app><h1 class="page-title" theme="DASHBOARD">频道信息中心</h1></ytcp-app>
<ytcp-navigation-drawer><div id="entity-name">Demo Channel<ytcp-tooltip hidden>Ignore tooltip</ytcp-tooltip></div></ytcp-navigation-drawer>
<ytcd-channel-facts-item>
<div class="section-title"><div class="section-title-text">热门内容</div><span class="section-subtitle-text">过去 48 小时 · 观看次数</span></div>
<div class="section-title"><div class="section-title-text">摘要</div><div class="section-subtitle-text">过去 28 天</div></div>
<div class="metric-value-big">0</div><div class="subscribers-trend"></div>
<div id="metrics-table"><div class="metric-row"><div class="metric-title">观看次数</div><div id="metric-0-value">0</div><div>— 无法比较</div></div></div>
</ytcd-channel-facts-item>`;

function analytics(views = "—", delta = "—", dates = "2026/8/10 – 2026/9/6") {
  return `<yta-time-picker><ytcp-text-dropdown-trigger id="picker-trigger"><div class="label-text">${dates}</div><span class="dropdown-trigger-text">过去 28 天</span></ytcp-text-dropdown-trigger></yta-time-picker>
  <yta-latest-activity-card><div class="metric-value">999</div></yta-latest-activity-card>
  <div id="key-metric-blocks"><div id="EXTERNAL_VIEWS-tab"><div id="metric-total">${views}</div></div><div id="SUBSCRIBERS_NET_CHANGE-tab"><div id="metric-total">${delta}</div></div></div>`;
}

function content(more = false, dateType = "发布日期", sort = "descending") {
  return `<ytcp-content-section id="video-list"><ytcp-video-section-content id="video-list">
  <ytcp-table-header><div class="tablecell-date" aria-sort="${sort}"></div></ytcp-table-header>
  <ytcp-video-row role="row"><a id="video-title" href="/video/demo_video/edit">Demo video</a><div class="tablecell-views">2</div><div class="tablecell-date">2026年9月7日<div class="cell-description">${dateType}</div></div></ytcp-video-row>
  <ytcp-table-footer id="footer"><span class="page-description">第 1 - 1 条，共 ${more ? 2 : 1} 条</span><ytcp-icon-button id="navigate-before" disabled aria-disabled="true"></ytcp-icon-button><ytcp-icon-button id="navigate-after" ${more ? 'aria-disabled="false"' : 'disabled aria-disabled="true"'}></ytcp-icon-button></ytcp-table-footer>
  </ytcp-video-section-content></ytcp-content-section>`;
}

async function collect(options: { views?: string; delta?: string; dates?: string; more?: boolean; dateType?: string; sort?: string } = {}) {
  document.body.innerHTML = dashboard;
  const saved: Collection<ChannelBasicData>[] = [];
  const ctx = {
    signal: new AbortController().signal,
    logger: { info() {} },
    collections: { async save(value: Collection<ChannelBasicData>) { saved.push(value); } },
  } as unknown as TaskContext;
  let page: StudioTarget = "DASHBOARD";
  const dom = createDomService();
  const result = await runChannelBasicCollector(ctx, {
    dom, installationId: "demo-installation", collectionId: "demo-collection",
    getHref: () => "https://studio.youtube.com/channel/demo_channel",
    navigation: {
      currentPage: () => page,
      async navigate(target) {
        page = target;
        document.body.innerHTML = target === "ANALYTICS"
          ? analytics(options.views, options.delta, options.dates)
          : content(options.more, options.dateType, options.sort);
      },
      async waitReady(target) {
        if (target === "DASHBOARD") expect(await dom.find(getTarget("page.dashboard.title"))).not.toBeNull();
        if (target === "ANALYTICS") expect(await dom.find(getTarget("page.analytics.title"))).not.toBeNull();
      },
      async back() {},
    },
  });
  return { result, data: saved[0]!.data };
}

afterEach(() => document.body.replaceChildren());
describe("real DOM calibration", () => {
  it("retains zero, omits missing net change, ignores tooltip and 48-hour period", async () => {
    const { result, data } = await collect();
    expect(result.status).toBe("PARTIAL");
    expect(data.channel.channelName).toBe("Demo Channel");
    expect(data.period).toEqual({ label: "过去 28 天" });
    expect(data.summary).toEqual({ views: 0 });
    expect(data.recentVideos[0]).toMatchObject({ videoId: "demo_video", title: "Demo video", views: 2, publishedAt: "2026年9月7日" });
    expect(result.warnings?.some(w => w.code === "VIDEO_SCOPE_PARTIAL")).toBe(false);
  });

  it("uses Analytics as a single source, including its exact dates", async () => {
    const { data, result } = await collect({ views: "12", delta: "-2" });
    expect(data.summary).toEqual({ views: 12, subscriberDelta: -2 });
    expect(data.period).toEqual({ label: "过去 28 天", start: "2026-08-10", end: "2026-09-06" });
    expect(result.status).toBe("COMPLETED");
  });

  it("never pairs Dashboard views with Analytics subscriber growth", async () => {
    const { data, result } = await collect({ delta: "+3" });
    expect(data.summary).toEqual({ subscriberDelta: 3 });
    expect(result.status).toBe("PARTIAL");
  });

  it("rejects invalid Analytics dates", async () => {
    const { data, result } = await collect({ views: "12", delta: "3", dates: "2026/2/30 – 2026/9/6" });
    expect(data.summary).toEqual({ views: 0 });
    expect(result.warnings?.some(w => w.code === "ANALYTICS_PERIOD_UNKNOWN")).toBe(true);
  });

  it("reports partial scope and does not treat an upload date as publication", async () => {
    const { data, result } = await collect({ views: "12", delta: "3", more: true, dateType: "上传日期", sort: "ascending" });
    expect(data.recentVideos[0]?.publishedAt).toBeUndefined();
    expect(result.status).toBe("PARTIAL");
    expect(result.warnings?.map(w => w.code)).toEqual(expect.arrayContaining(["VIDEO_SCOPE_PARTIAL", "VIDEO_ORDER_UNKNOWN"]));
  });

  it("ignores hidden retained pages and rejects duplicate live metrics", async () => {
    document.body.innerHTML = `<div hidden>${analytics("999", "999")}</div>${analytics("12", "3")}`;
    const dom = createDomService();
    expect(await dom.readText(getTarget("analytics.views"))).toBe("12");
    document.body.insertAdjacentHTML("beforeend", analytics("8", "1"));
    expect(await dom.find(getTarget("analytics.views"))).toBeNull();
  });
});
