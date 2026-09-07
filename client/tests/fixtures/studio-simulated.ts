/**
 * Simulated YouTube Studio DOM fixtures.
 * Structure is constructed for detector/nav/collector tests — NOT a real Studio snapshot.
 * No real channel / account / video identifiers (demo placeholders only).
 */

import type { StudioTarget } from "../../src/sites/youtube-studio/selectors.js";

export type FixtureLayout = "2026_V1" | "2026_V2" | "NONE";

export type FixturePage = StudioTarget;

const CHANNEL = "UC_demo_channel";
const VIDEO = "vid_demo_001";

const PAGE_HREF: Record<FixturePage, string> = {
  DASHBOARD: `https://studio.youtube.com/channel/${CHANNEL}`,
  ANALYTICS: `https://studio.youtube.com/channel/${CHANNEL}/analytics`,
  CONTENT: `https://studio.youtube.com/channel/${CHANNEL}/videos`,
  VIDEO_DETAILS: `https://studio.youtube.com/video/${VIDEO}/edit`,
  SUBTITLES: `https://studio.youtube.com/video/${VIDEO}/translations`,
};

const PAGE_ARIA: Record<FixturePage, string> = {
  DASHBOARD: "Channel dashboard",
  ANALYTICS: "Channel analytics",
  CONTENT: "Channel content",
  VIDEO_DETAILS: "Video details",
  SUBTITLES: "Subtitles",
};

const NAV: Array<{ page: FixturePage; label: string; href: string; dataNav: string }> =
  [
    {
      page: "DASHBOARD",
      label: "Dashboard",
      href: `/channel/${CHANNEL}`,
      dataNav: "dashboard",
    },
    {
      page: "ANALYTICS",
      label: "Analytics",
      href: `/channel/${CHANNEL}/analytics`,
      dataNav: "analytics",
    },
    {
      page: "CONTENT",
      label: "Content",
      href: `/channel/${CHANNEL}/videos`,
      dataNav: "content",
    },
  ];

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
  /** When true, DOM page marker disagrees with URL (conflict → UNKNOWN). */
  conflictDomPage?: FixturePage;
  /** Extra broken markup for unknown-layout tests. */
  corruptLayout?: boolean;
  /** Collector metric/content payload (Phase 3). */
  collector?: CollectorFixtureData | false;
}

export interface StudioFixtureHandle {
  href: string;
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
): void {
  if (data.omitVideoList) {
    const empty = document.createElement("div");
    empty.textContent = "Simulated CONTENT (list selector broken)";
    main.append(empty);
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
  main.append(list);
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
  let collectorData: CollectorFixtureData | false =
    options.collector === false
      ? false
      : (options.collector ?? DEFAULT_COLLECTOR_DATA);

  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio");
  root.setAttribute(
    "data-note",
    "simulated structure, not a real Studio snapshot",
  );

  let currentPage: FixturePage = page;

  const render = (current: FixturePage): void => {
    currentPage = current;
    root.replaceChildren();

    if (layout === "NONE" || options.corruptLayout) {
      const junk = document.createElement("div");
      junk.textContent = "unrecognized shell";
      root.append(junk);
      setLocationHref(PAGE_HREF[current]);
      return;
    }

    const app = document.createElement("ytcp-app");
    app.setAttribute("data-luftballons-layout", layout);

    const drawer = document.createElement("ytcp-navigation-drawer");
    for (const item of NAV) {
      const a = document.createElement("a");
      a.setAttribute("href", item.href);
      a.setAttribute("aria-label", item.label);
      a.setAttribute("role", "link");
      a.setAttribute("data-nav", item.dataNav);
      a.textContent = item.label;
      if (item.page === current) {
        a.setAttribute("aria-current", "page");
      }
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        handle.setPage(item.page);
      });
      drawer.append(a);
    }

    if (current === "VIDEO_DETAILS" || current === "SUBTITLES") {
      const deep = document.createElement("a");
      deep.setAttribute(
        "href",
        current === "SUBTITLES"
          ? `/video/${VIDEO}/translations`
          : `/video/${VIDEO}/edit`,
      );
      deep.setAttribute(
        "aria-label",
        current === "SUBTITLES" ? "Subtitles" : "Video details",
      );
      deep.setAttribute("role", "link");
      deep.setAttribute("aria-current", "page");
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
    const domPage = options.conflictDomPage ?? current;
    main.setAttribute("data-page", domPage);
    main.setAttribute("aria-label", PAGE_ARIA[domPage]);

    if (collectorData && domPage === current) {
      if (current === "DASHBOARD") {
        appendDashboardBody(main, collectorData);
      } else if (current === "ANALYTICS") {
        appendAnalyticsBody(main, collectorData);
      } else if (current === "CONTENT") {
        appendContentBody(main, collectorData);
      } else {
        main.textContent = `Simulated ${domPage}`;
      }
    } else {
      main.textContent = `Simulated ${domPage}`;
    }

    app.append(drawer, main);
    root.append(app);
    setLocationHref(PAGE_HREF[current]);
  };

  const handle: StudioFixtureHandle = {
    href: PAGE_HREF[page],
    setPage(next: FixturePage) {
      handle.href = PAGE_HREF[next];
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

/** Dual layout markers to force signature conflict → UNKNOWN. */
export function mountConflictingLayoutFixture(): StudioFixtureHandle {
  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio-conflict");

  const a = document.createElement("ytcp-app");
  a.setAttribute("data-luftballons-layout", "2026_V1");
  const b = document.createElement("ytcp-app");
  b.setAttribute("data-luftballons-layout", "2026_V2");
  root.append(a, b);
  document.body.append(root);

  const href = PAGE_HREF.DASHBOARD;
  setLocationHref(href);

  return {
    href,
    setPage() {},
    setCollectorData() {},
    destroy() {
      root.remove();
    },
  };
}
