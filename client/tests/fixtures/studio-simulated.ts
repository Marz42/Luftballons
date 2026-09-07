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

/**
 * Simulated subtitle editor surface (Phase 4).
 * ALL structure is assumption-marked — not live Studio evidence.
 */
export interface SubtitleFixtureData {
  /**
   * Languages already on the video.
   * Default state is PUBLISHED when omitted (already committed).
   */
  existingLanguages: Array<{
    code: string;
    label: string;
    /** assumption: PUBLISHED | PENDING_PUBLISH (default PUBLISHED) */
    state?: "PUBLISHED" | "PENDING_PUBLISH";
  }>;
  /**
   * Available options in the Add-language picker.
   * Defaults to a small MVP set when omitted.
   */
  pickerLanguages?: Array<{ code: string; label: string }>;
  /** When true, omit the languages list container (P4-T4 UI mismatch). */
  omitLanguagesList?: boolean;
  /** When true, omit add / publish controls. */
  omitControls?: boolean;
  /**
   * P1-2a: inject a hidden document-level Publish twin with the same aria-label.
   */
  injectHiddenGlobalPublish?: boolean;
  /**
   * P1-2b: Add-language click does not open the picker (async/menu failure).
   */
  addLanguageNoOp?: boolean;
  /**
   * P2-1: delay before picker becomes visible after Add language click.
   */
  pickerOpenDelayMs?: number;
  /**
   * P1-2c: inside the open picker, also mount an "existing language row"
   * decoy with data-language-code (must not be treated as a selectable option).
   */
  injectPickerExistingRowDecoy?: boolean;
  /**
   * P1-3: publish button behavior.
   * - commit (default): PENDING_PUBLISH → PUBLISHED
   * - noop: click increments counter but leaves pending (publish无效)
   * - fail: click shows error attribute, no state change
   * - delay: commit after publishDelayMs (async publish)
   */
  publishMode?: "commit" | "noop" | "fail" | "delay";
  /** Used when publishMode === "delay". */
  publishDelayMs?: number;
  /**
   * P1-3: after publish click, remove the languages list (postcondition unreadable).
   */
  omitLanguagesListAfterPublish?: boolean;
  /**
   * P2-2: render existing rows with label text only (no data-language-code).
   */
  labelOnlyExistingRows?: boolean;
  /**
   * P2-2: append an unparseable row (no code attr, unknown label).
   */
  injectUnparseableRow?: boolean;
  /**
   * P2-2: mount empty list first; append existing rows after this delay.
   */
  languagesListRowsDelayMs?: number;
}

export const DEFAULT_SUBTITLE_DATA: SubtitleFixtureData = {
  existingLanguages: [{ code: "en", label: "English" }],
  pickerLanguages: [
    { code: "en", label: "English" },
    { code: "ja", label: "日本語" },
    { code: "ko", label: "한국어" },
    { code: "es", label: "Español" },
  ],
};

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
  /**
   * Subtitle editor payload (Phase 4).
   * assumption: simulated structure only — calibrate on real device.
   */
  subtitles?: SubtitleFixtureData | false;
  /**
   * When true, VIDEO_DETAILS has no video-scoped /video/{id}/translations
   * tab — only the channel-level sidebar /translations entry remains (P1-1).
   */
  omitVideoSubtitlesTab?: boolean;
}

export interface StudioFixtureHandle {
  href: string;
  contentVariant: ContentUrlVariant;
  setPage(page: FixturePage): void;
  /**
   * Update href/location without remounting (P1-1 Human Gate video switch).
   * Does not rewrite SPA page body — intentionally leaves DOM of prior video.
   */
  setHref(href: string): void;
  /** Replace collector payload and re-render current page. */
  setCollectorData(data: CollectorFixtureData | false): void;
  /** Replace subtitle payload and re-render current page. */
  setSubtitleData(data: SubtitleFixtureData | false): void;
  /** Test helper: language codes currently shown in the list. */
  getSubtitleLanguageCodes(): string[];
  /** Click counters for fail-closed assertions (P4-T4 / P1-2). */
  clickCounts: {
    addLanguage: number;
    publish: number;
    option: number;
    hiddenPublish: number;
    pickerDecoy: number;
  };
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
  main.append(metricEl("analytics.period", "Period", data.periodLabel));
  main.append(metricEl("analytics.dates", "Dates", "2026/8/10 – 2026/9/6"));
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
 * assumption, calibrate on real device — minimal subtitle editor for unit tests.
 * Row states: PUBLISHED (committed) vs PENDING_PUBLISH (added, not published).
 */
function appendSubtitlesBody(
  main: HTMLElement,
  data: SubtitleFixtureData,
  clickCounts: StudioFixtureHandle["clickCounts"],
  onLanguagesChanged: () => void,
): void {
  // Normalize default state for existing rows.
  for (const lang of data.existingLanguages) {
    if (!lang.state) {
      lang.state = "PUBLISHED";
    }
  }

  // assumption, calibrate on real device: active subtitle editor surface
  const editor = document.createElement("div");
  editor.setAttribute("data-luftballons-target", "subtitle.editor");
  editor.setAttribute("aria-label", "Subtitle editor");

  const note = document.createElement("div");
  note.setAttribute("data-note", "assumption, calibrate on real device");
  note.textContent = "Simulated SUBTITLES (assumption fixture)";
  editor.append(note);

  if (data.omitLanguagesList) {
    main.append(editor);
    return;
  }

  const list = document.createElement("div");
  list.setAttribute("data-luftballons-target", "subtitle.languages.list");
  list.setAttribute("aria-label", "Subtitle languages");

  const renderItems = (): void => {
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    for (const lang of data.existingLanguages) {
      const state = lang.state ?? "PUBLISHED";
      const item = document.createElement("div");
      item.setAttribute("data-luftballons-subtitle-row", "true");
      // Label-only mode simulates Studio rows without code attrs (P2-2).
      // Newly added PENDING rows still expose codes so option→list binding works.
      const omitCodeAttrs =
        data.labelOnlyExistingRows && state !== "PENDING_PUBLISH";
      if (!omitCodeAttrs) {
        item.setAttribute("data-luftballons-subtitle-lang", lang.code);
        item.setAttribute("data-language-code", lang.code);
      }
      // assumption, calibrate on real device: published marker on the row
      item.setAttribute("data-subtitle-state", state);
      if (state === "PUBLISHED") {
        item.setAttribute("data-subtitle-published", "true");
      } else {
        item.removeAttribute("data-subtitle-published");
      }
      item.textContent =
        state === "PENDING_PUBLISH"
          ? `${lang.label} (pending)`
          : lang.label;
      list.append(item);
    }
    if (data.injectUnparseableRow) {
      const bad = document.createElement("div");
      bad.setAttribute("data-luftballons-subtitle-row", "true");
      bad.textContent = "未知语言结构XYZ";
      list.append(bad);
    }
  };

  if ((data.languagesListRowsDelayMs ?? 0) > 0) {
    // Container present first; rows arrive asynchronously (P2-2).
    window.setTimeout(() => {
      renderItems();
      onLanguagesChanged();
    }, data.languagesListRowsDelayMs);
  } else {
    renderItems();
  }
  editor.append(list);

  if (data.omitControls) {
    main.append(editor);
    return;
  }

  const picker = document.createElement("div");
  picker.setAttribute("data-luftballons-target", "subtitle.language.picker");
  picker.setAttribute("aria-label", "Language picker");
  picker.hidden = true;

  if (data.injectPickerExistingRowDecoy) {
    const decoy = document.createElement("div");
    // Looks like an existing language row (NOT an option) inside the picker.
    decoy.setAttribute("data-luftballons-subtitle-lang", "ja");
    decoy.setAttribute("data-language-code", "ja");
    decoy.setAttribute("data-subtitle-state", "PUBLISHED");
    decoy.textContent = "日本語 (already added row decoy)";
    decoy.addEventListener("click", () => {
      clickCounts.pickerDecoy += 1;
    });
    picker.append(decoy);
  }

  const pickerLangs =
    data.pickerLanguages ?? DEFAULT_SUBTITLE_DATA.pickerLanguages ?? [];
  for (const lang of pickerLangs) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.setAttribute("data-luftballons-subtitle-option", "true");
    opt.setAttribute("data-language-code", lang.code);
    opt.textContent = lang.label;
    opt.addEventListener("click", () => {
      clickCounts.option += 1;
      const existing = data.existingLanguages.find(
        (l) => l.code.toLowerCase() === lang.code.toLowerCase(),
      );
      if (!existing) {
        // Add as pending — publish must flip to PUBLISHED (P1-3).
        data.existingLanguages.push({
          ...lang,
          state: "PENDING_PUBLISH",
        });
        renderItems();
        onLanguagesChanged();
      }
      // Do not re-add if already pending or published (no stacking).
      picker.hidden = true;
    });
    picker.append(opt);
  }
  editor.append(picker);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.setAttribute("data-luftballons-target", "subtitle.add_language");
  addBtn.setAttribute("aria-label", "Add language");
  addBtn.setAttribute("role", "button");
  addBtn.textContent = "Add language";
  addBtn.addEventListener("click", () => {
    clickCounts.addLanguage += 1;
    if (data.addLanguageNoOp) {
      return;
    }
    const delay = data.pickerOpenDelayMs ?? 0;
    if (delay > 0) {
      window.setTimeout(() => {
        picker.hidden = false;
      }, delay);
    } else {
      picker.hidden = false;
    }
  });
  editor.append(addBtn);

  const commitPending = (): void => {
    for (const lang of data.existingLanguages) {
      if (lang.state === "PENDING_PUBLISH") {
        lang.state = "PUBLISHED";
      }
    }
    renderItems();
    onLanguagesChanged();
  };

  const publishBtn = document.createElement("button");
  publishBtn.type = "button";
  publishBtn.setAttribute("data-luftballons-target", "subtitle.publish");
  publishBtn.setAttribute("aria-label", "Publish");
  publishBtn.setAttribute("role", "button");
  publishBtn.textContent = "Publish";
  publishBtn.addEventListener("click", () => {
    clickCounts.publish += 1;
    const mode = data.publishMode ?? "commit";
    if (mode === "noop") {
      // Publish无效: counter bumps, pending stays pending.
      return;
    }
    if (mode === "fail") {
      publishBtn.setAttribute("data-publish-error", "true");
      publishBtn.setAttribute("aria-invalid", "true");
      return;
    }
    if (mode === "delay") {
      const delay = data.publishDelayMs ?? 40;
      window.setTimeout(() => {
        commitPending();
        if (data.omitLanguagesListAfterPublish) {
          list.remove();
        }
      }, delay);
      return;
    }
    // commit
    commitPending();
    if (data.omitLanguagesListAfterPublish) {
      list.remove();
    }
  });
  editor.append(publishBtn);

  main.append(editor);

  if (data.injectHiddenGlobalPublish) {
    const twin = document.createElement("button");
    twin.type = "button";
    twin.setAttribute("aria-label", "Publish");
    twin.setAttribute("role", "button");
    twin.setAttribute("data-luftballons-hidden-publish-twin", "true");
    twin.hidden = true;
    twin.textContent = "Hidden Publish twin";
    twin.addEventListener("click", () => {
      clickCounts.hiddenPublish += 1;
    });
    // Prepend so document-order semantic match hits the twin first (P1-2a).
    document.body.prepend(twin);
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
  let subtitleData: SubtitleFixtureData | false =
    options.subtitles === false
      ? false
      : (options.subtitles ??
        (page === "SUBTITLES" || page === "VIDEO_DETAILS"
          ? {
              existingLanguages: [
                ...(DEFAULT_SUBTITLE_DATA.existingLanguages ?? []),
              ],
              pickerLanguages: [
                ...(DEFAULT_SUBTITLE_DATA.pickerLanguages ?? []),
              ],
            }
          : DEFAULT_SUBTITLE_DATA));

  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio");
  root.setAttribute(
    "data-note",
    "simulated structure calibrated to real Studio shell evidence",
  );

  let currentPage: FixturePage = page;
  const clickCounts = {
    addLanguage: 0,
    publish: 0,
    option: 0,
    hiddenPublish: 0,
    pickerDecoy: 0,
  };

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

      // assumption, calibrate on real device: video editor Subtitles/Translations tab
      // (video-scoped — must not rely on channel-level /channel/.../translations).
      if (!options.omitVideoSubtitlesTab) {
        const subTab = document.createElement("a");
        subTab.setAttribute("href", `/video/${VIDEO}/translations`);
        subTab.setAttribute("data-luftballons-target", "nav.subtitles.video");
        subTab.textContent = "Subtitles";
        subTab.addEventListener("click", (ev) => {
          ev.preventDefault();
          handle.setPage("SUBTITLES");
        });
        drawer.append(subTab);
      }
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
      } else if (current === "SUBTITLES" && subtitleData) {
        appendSubtitlesBody(main, subtitleData, clickCounts, () => {});
      } else if (current === "VIDEO_DETAILS") {
        main.textContent = "Simulated VIDEO_DETAILS";
      } else {
        main.textContent = `Simulated ${markerPage}`;
      }
    } else if (current === "SUBTITLES" && subtitleData) {
      appendSubtitlesBody(main, subtitleData, clickCounts, () => {});
    } else if (!collectorData) {
      if (current === "CONTENT" && contentVariant === "A") {
        const section = document.createElement("ytcp-video-section");
        section.textContent = "Simulated CONTENT";
        main.append(section);
      } else if (current === "SUBTITLES" && subtitleData) {
        appendSubtitlesBody(main, subtitleData, clickCounts, () => {});
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
    clickCounts,
    setPage(next: FixturePage) {
      handle.href = pageHref(next, contentVariant);
      render(next);
    },
    setHref(nextHref: string) {
      handle.href = nextHref;
      setLocationHref(nextHref);
    },
    setCollectorData(data) {
      collectorData = data;
      render(currentPage);
    },
    setSubtitleData(data) {
      subtitleData = data;
      render(currentPage);
    },
    getSubtitleLanguageCodes() {
      if (!subtitleData) {
        return [];
      }
      return subtitleData.existingLanguages.map((l) => l.code);
    },
    destroy() {
      root.remove();
      document
        .querySelectorAll("[data-luftballons-hidden-publish-twin]")
        .forEach((el) => el.remove());
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
    clickCounts: {
      addLanguage: 0,
      publish: 0,
      option: 0,
      hiddenPublish: 0,
      pickerDecoy: 0,
    },
    setPage() {},
    setHref() {},
    setCollectorData() {},
    setSubtitleData() {},
    getSubtitleLanguageCodes() {
      return [];
    },
    destroy() {
      root.remove();
    },
  };
}
