/**
 * Simulated YouTube Studio DOM fixtures.
 * Calibrated shell/nav structure mirrors real-device evidence (P2 batch).
 * Collector metric nodes remain fixture helpers (uncalibrated assumptions).
 * No real channel / account / video identifiers (demo placeholders only).
 */

import type { StudioTarget } from "../../src/sites/youtube-studio/selectors.js";

export type FixtureLayout = "2026_V1" | "2026_V2" | "NONE";

export type FixturePage = StudioTarget;

/**
 * Content URL / sidebar href variants observed on real devices.
 * A: /videos/upload + ytcp-video-section
 * B: /content?theme=dark (container unreported)
 */
export type ContentUrlVariant = "A" | "B";

const CHANNEL = "UC_demo_channel";
const VIDEO = "vid_demo_001";

function pageHref(
  page: FixturePage,
  contentVariant: ContentUrlVariant,
): string {
  const theme = contentVariant === "B" ? "?theme=dark" : "";
  switch (page) {
    case "DASHBOARD":
      return `https://studio.youtube.com/channel/${CHANNEL}${theme}`;
    case "ANALYTICS":
      return `https://studio.youtube.com/channel/${CHANNEL}/analytics/tab-overview/period-default${theme}`;
    case "CONTENT":
      return contentVariant === "B"
        ? `https://studio.youtube.com/channel/${CHANNEL}/content?theme=dark`
        : `https://studio.youtube.com/channel/${CHANNEL}/videos/upload`;
    case "VIDEO_DETAILS":
      return `https://studio.youtube.com/video/${VIDEO}/edit`;
    case "SUBTITLES":
      return `https://studio.youtube.com/video/${VIDEO}/translations`;
  }
}

/** Sidebar items mirroring real Studio (no aria-label). */
function navItems(contentVariant: ContentUrlVariant): Array<{
  page: FixturePage;
  href: string;
  label: string;
}> {
  const theme = contentVariant === "B" ? "?theme=dark" : "";
  const contentHref =
    contentVariant === "B"
      ? `/channel/${CHANNEL}/content${theme}`
      : `/channel/${CHANNEL}/videos/upload`;
  return [
    {
      page: "DASHBOARD",
      href: `/channel/${CHANNEL}${theme}`,
      label: "Dashboard",
    },
    {
      page: "CONTENT",
      href: contentHref,
      label: "Content",
    },
    {
      page: "ANALYTICS",
      href: `/channel/${CHANNEL}/analytics/tab-overview/period-default${theme}`,
      label: "Analytics",
    },
    {
      page: "SUBTITLES",
      href: `/channel/${CHANNEL}/translations${theme}`,
      label: "Translations",
    },
  ];
}

export interface FixtureRecentVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  /** Visible views text (may be abbreviated, e.g. 12.3K). */
  viewsText: string;
}

export interface CollectorFixtureData {
  channelName: string;
  periodLabel: string;
  /** Dashboard views card text; omit to force Analytics fall-through. */
  dashboardViews?: string;
  dashboardSubscriberDelta?: string;
  analyticsViews?: string;
  analyticsSubscriberDelta?: string;
  recentVideos: FixtureRecentVideo[];
  /** When true, omit content.videos.list (P3-T3 partial). */
  omitVideoList?: boolean;
}

export const DEFAULT_COLLECTOR_DATA: CollectorFixtureData = {
  channelName: "Demo Channel",
  periodLabel: "Last 28 days",
  dashboardViews: "12.3K",
  dashboardSubscriberDelta: "+120",
  analyticsViews: "12,345",
  analyticsSubscriberDelta: "+120",
  recentVideos: [
    {
      videoId: "vid_demo_1",
      title: "Welcome to the channel",
      publishedAt: "2026-09-01",
      viewsText: "10,000",
    },
    {
      videoId: "vid_demo_2",
      title: "Studio tips",
      publishedAt: "2026-08-20",
      viewsText: "5.5K",
    },
    {
      videoId: "vid_demo_3",
      title: "Behind the scenes",
      publishedAt: "2026-08-01",
      viewsText: "900",
    },
  ],
};

export interface MountStudioFixtureOptions {
  layout?: FixtureLayout;
  page?: FixturePage;
  /**
   * Content URL variant (A=/videos/upload, B=/content?theme=dark).
   * Also controls whether dashboard/analytics hrefs carry ?theme=dark.
   */
  contentVariant?: ContentUrlVariant;
  /**
   * Put aria-current on this nav page while URL follows `page`
   * (DOM/URL conflict → UNKNOWN).
   */
  conflictDomPage?: FixturePage;
  /** Extra broken markup for unknown-layout tests. */
  corruptLayout?: boolean;
  /** Collector metric/content payload (Phase 3). */
  collector?: CollectorFixtureData | false;
}

export interface StudioFixtureHandle {
  href: string;
  contentVariant: ContentUrlVariant;
  setPage(page: FixturePage): void;
  /** Replace collector payload and re-render current page. */
  setCollectorData(data: CollectorFixtureData | false): void;
  destroy(): void;
}

function setLocationHref(href: string): void {
  Object.defineProperty(window, "location", {
    value: {
      hostname: new URL(href).hostname,
      href,
      pathname: new URL(href).pathname,
      search: new URL(href).search,
      assign: (url: string) => setLocationHref(String(url)),
      replace: (url: string) => setLocationHref(String(url)),
    },
    writable: true,
    configurable: true,
  });
}

function metricEl(
  targetId: string,
  ariaLabel: string,
  value: string,
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-luftballons-target", targetId);
  el.setAttribute("aria-label", ariaLabel);
  el.setAttribute("data-metric-value", value);
  el.textContent = value;
  return el;
}

function appendDashboardBody(
  main: HTMLElement,
  data: CollectorFixtureData,
): void {
  main.append(
    metricEl("dashboard.period", "Reporting period", data.periodLabel),
  );
  if (data.dashboardViews !== undefined) {
    main.append(metricEl("dashboard.views", "Views", data.dashboardViews));
  }
  if (data.dashboardSubscriberDelta !== undefined) {
    main.append(
      metricEl(
        "dashboard.subscriberDelta",
        "Subscribers",
        data.dashboardSubscriberDelta,
      ),
    );
  }
}

function appendAnalyticsBody(
  main: HTMLElement,
  data: CollectorFixtureData,
): void {
  if (data.analyticsViews !== undefined) {
    main.append(metricEl("analytics.views", "Views", data.analyticsViews));
  }
  if (data.analyticsSubscriberDelta !== undefined) {
    main.append(
      metricEl(
        "analytics.subscriberDelta",
        "Subscribers",
        data.analyticsSubscriberDelta,
      ),
    );
  }
}

function appendContentBody(
  main: HTMLElement,
  data: CollectorFixtureData,
  contentVariant: ContentUrlVariant,
): void {
  // Variant A evidence: ytcp-video-section inside main.
  // Variant B: container unreported — do not invent; mount list under main.
  const host =
    contentVariant === "A"
      ? document.createElement("ytcp-video-section")
      : main;

  if (data.omitVideoList) {
    const empty = document.createElement("div");
    empty.textContent = "Simulated CONTENT (list selector broken)";
    host.append(empty);
    if (contentVariant === "A") {
      main.append(host);
    }
    return;
  }

  const list = document.createElement("div");
  list.setAttribute("data-luftballons-target", "content.videos.list");
  list.setAttribute("aria-label", "Channel content list");
  for (const video of data.recentVideos) {
    const row = document.createElement("div");
    row.setAttribute("data-luftballons-video-row", "true");
    row.setAttribute("data-video-id", video.videoId);

    const title = document.createElement("span");
    title.setAttribute("data-luftballons-field", "title");
    title.textContent = video.title;

    const published = document.createElement("span");
    published.setAttribute("data-luftballons-field", "publishedAt");
    published.textContent = video.publishedAt;

    const views = document.createElement("span");
    views.setAttribute("data-luftballons-field", "views");
    views.textContent = video.viewsText;

    const link = document.createElement("a");
    link.setAttribute("href", `/video/${video.videoId}/edit`);
    link.textContent = "Edit";

    row.append(title, published, views, link);
    list.append(row);
  }
  host.append(list);
  if (contentVariant === "A") {
    main.append(host);
  }
}

/**
 * Mount a simulated Studio shell into document.body.
 * Call destroy() in afterEach.
 */
export function mountStudioFixture(
  options: MountStudioFixtureOptions = {},
): StudioFixtureHandle {
  const layout = options.layout ?? "2026_V1";
  const page = options.page ?? "DASHBOARD";
  const contentVariant: ContentUrlVariant = options.contentVariant ?? "A";
  let collectorData: CollectorFixtureData | false =
    options.collector === false
      ? false
      : (options.collector ?? DEFAULT_COLLECTOR_DATA);

  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio");
  root.setAttribute(
    "data-note",
    "simulated structure calibrated to real Studio shell evidence",
  );

  let currentPage: FixturePage = page;

  const render = (current: FixturePage): void => {
    currentPage = current;
    root.replaceChildren();

    if (layout === "NONE" || options.corruptLayout) {
      const junk = document.createElement("div");
      junk.textContent = "unrecognized shell";
      root.append(junk);
      const href = pageHref(current, contentVariant);
      handle.href = href;
      setLocationHref(href);
      return;
    }

    // 2026_V2: signature is pending real evidence (matches always false).
    // Mount a non-V1 shell so tests do not accidentally claim V1.
    if (layout === "2026_V2") {
      const app = document.createElement("ytcp-app");
      // No ytcp-navigation-drawer → V1 signature does not match.
      const main = document.createElement("main");
      main.id = "main";
      main.textContent = "V2 shell placeholder — awaiting real-device evidence";
      app.append(main);
      root.append(app);
      const href = pageHref(current, contentVariant);
      handle.href = href;
      setLocationHref(href);
      return;
    }

    // 2026_V1: real structure — ytcp-app + ytcp-navigation-drawer
    // (no data-luftballons-layout attribute; real device has none)
    const app = document.createElement("ytcp-entity-page");
    const ytcpApp = document.createElement("ytcp-app");

    const drawer = document.createElement("ytcp-navigation-drawer");

    // Outbound channel home (absolute URL) — must NOT match dashboard selector.
    const home = document.createElement("a");
    home.setAttribute("href", `https://www.youtube.com/channel/${CHANNEL}/`);
    home.textContent = "Channel home";
    drawer.append(home);

    const ariaCurrentPage = options.conflictDomPage ?? current;

    for (const item of navItems(contentVariant)) {
      const a = document.createElement("a");
      a.setAttribute("href", item.href);
      // Real device: no aria-label / aria-selected on sidebar items.
      a.textContent = item.label;
      if (item.page === ariaCurrentPage) {
        a.setAttribute("aria-current", "page");
      }
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        handle.setPage(item.page);
      });
      drawer.append(a);
    }

    if (current === "VIDEO_DETAILS") {
      const deep = document.createElement("a");
      deep.setAttribute("href", `/video/${VIDEO}/edit`);
      deep.setAttribute("aria-current", "page");
      deep.textContent = "Video details";
      drawer.append(deep);
    }

    if (collectorData) {
      const channelName = document.createElement("div");
      channelName.setAttribute("data-luftballons-target", "channel.name");
      channelName.setAttribute("aria-label", "Channel name");
      channelName.textContent = collectorData.channelName;
      drawer.append(channelName);
    }

    const main = document.createElement("main");
    main.id = "main";
    // Fixture helper only: uncalibrated page-ready / analytics collector
    // selectors still key off data-page. Real Studio main has no data-page.
    const markerPage = options.conflictDomPage ?? current;
    main.setAttribute("data-page", markerPage);

    if (collectorData && markerPage === current) {
      if (current === "DASHBOARD") {
        appendDashboardBody(main, collectorData);
      } else if (current === "ANALYTICS") {
        appendAnalyticsBody(main, collectorData);
      } else if (current === "CONTENT") {
        appendContentBody(main, collectorData, contentVariant);
      } else {
        main.textContent = `Simulated ${markerPage}`;
      }
    } else if (!collectorData) {
      if (current === "CONTENT" && contentVariant === "A") {
        const section = document.createElement("ytcp-video-section");
        section.textContent = "Simulated CONTENT";
        main.append(section);
      } else {
        main.textContent = `Simulated ${markerPage}`;
      }
    } else {
      main.textContent = `Simulated ${markerPage}`;
    }

    ytcpApp.append(drawer, main);
    app.append(ytcpApp);
    root.append(app);

    const href = pageHref(current, contentVariant);
    handle.href = href;
    setLocationHref(href);
  };

  const handle: StudioFixtureHandle = {
    href: pageHref(page, contentVariant),
    contentVariant,
    setPage(next: FixturePage) {
      handle.href = pageHref(next, contentVariant);
      render(next);
    },
    setCollectorData(data) {
      collectorData = data;
      render(currentPage);
    },
    destroy() {
      root.remove();
    },
  };

  document.body.append(root);
  render(page);
  return handle;
}

/**
 * Dual incomplete shells — neither claims a unique calibrated layout.
 * (2026_V2 signature is always false; V1 requires navigation-drawer.)
 */
export function mountConflictingLayoutFixture(): StudioFixtureHandle {
  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio-conflict");

  // Two apps without drawers → V1 false, V2 false → UNKNOWN
  const a = document.createElement("ytcp-app");
  const b = document.createElement("ytcp-app");
  root.append(a, b);
  document.body.append(root);

  const href = pageHref("DASHBOARD", "A");
  setLocationHref(href);

  return {
    href,
    contentVariant: "A",
    setPage() {},
    setCollectorData() {},
    destroy() {
      root.remove();
    },
  };
}
