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
    /**
     * Layout A captions cell #status-info (overrides state when omitDataStateAttrs).
     * dash = –; published = 已发布; draft = other text.
     */
    captionsStatus?: "dash" | "published" | "draft";
    /** Metadata cell may show 已发布 independently of captions. */
    metadataPublished?: boolean;
    /** Omit data-subtitle-state / data-subtitle-published (live-shaped). */
    omitDataStateAttrs?: boolean;
  }>;
  /**
   * Available options in the Add-language picker.
   * Defaults to a small MVP set when omitted.
   */
  pickerLanguages?: Array<{ code: string; label: string }>;
  /** When true, omit the languages list container (P4-T4 UI mismatch). */
  omitLanguagesList?: boolean;
  /** Empty container without a confirmed empty-state signal. */
  omitEmptyState?: boolean;
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
  /**
   * After 自动翻译: delay before captions body is marked ready.
   * Publish may enable immediately (Studio race → 无法发布空白字幕).
   */
  autoTranslateContentDelayMs?: number;
  /**
   * Inject a hidden leftover ready marker for another language (must not
   * make the active language READY).
   */
  leftoverReadyLanguageCode?: string;
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

  const captionsReady = document.createElement("div");
  captionsReady.setAttribute("data-luftballons-captions-editor", "true");
  captionsReady.hidden = true;

  let activeCaptionsLang: string | null = null;

  const blankError = document.createElement("div");
  blankError.setAttribute(
    "data-luftballons-target",
    "subtitle.publish.blank_error",
  );
  blankError.setAttribute("role", "alert");
  blankError.hidden = true;
  blankError.textContent = "无法发布空白字幕。字幕空白。无法发布空白字幕。";

  const markCaptionsReady = (ready: boolean, langCode?: string): void => {
    const code = langCode ?? activeCaptionsLang ?? "";
    if (ready) {
      captionsReady.setAttribute("data-luftballons-captions-ready", "true");
      if (code) {
        captionsReady.setAttribute("data-language-code", code);
        captionsReady.setAttribute("data-luftballons-subtitle-lang", code);
      }
      captionsReady.textContent = `Fixture cue (${code || "?"}): Hallo Welt`;
      captionsReady.hidden = false;
      blankError.hidden = true;
    } else {
      captionsReady.removeAttribute("data-luftballons-captions-ready");
      captionsReady.removeAttribute("data-language-code");
      captionsReady.removeAttribute("data-luftballons-subtitle-lang");
      captionsReady.textContent = "";
      captionsReady.hidden = true;
    }
  };

  if (data.leftoverReadyLanguageCode) {
    const leftover = document.createElement("div");
    leftover.setAttribute("data-luftballons-captions-editor", "true");
    leftover.setAttribute("data-luftballons-captions-ready", "true");
    leftover.setAttribute("data-language-code", data.leftoverReadyLanguageCode);
    leftover.setAttribute(
      "data-luftballons-subtitle-lang",
      data.leftoverReadyLanguageCode,
    );
    leftover.hidden = true;
    leftover.style.display = "none";
    leftover.textContent = "Leftover cue from prior language";
    editor.append(leftover);
  }

  const appendCaptionsCell = (
    item: HTMLElement,
    langCode: string,
    captionsStatus: "dash" | "published" | "draft",
  ): void => {
    const captionsCell = document.createElement("div");
    captionsCell.className = "tablecell-captions";
    captionsCell.setAttribute("data-luftballons-captions-cell", "true");
    const hoverCell = document.createElement("div");
    hoverCell.className = "ytgn-video-translation-hover-cell";
    const cellContainer = document.createElement("div");
    cellContainer.id = "cell-container";
    cellContainer.tabIndex = 0;
    const status = document.createElement("div");
    status.id = "status-info";
    status.setAttribute("data-luftballons-captions-status", "true");
    status.textContent =
      captionsStatus === "published"
        ? "已发布"
        : captionsStatus === "draft"
          ? "草稿"
          : "–";
    cellContainer.append(status);
    hoverCell.append(cellContainer);
    captionsCell.append(hoverCell);

    if (captionsStatus === "dash" || captionsStatus === "draft") {
      const stampCaptionsAdd = (): void => {
        if (cellContainer.querySelector("#captions-add")) {
          return;
        }
        const captionsAdd = document.createElement("button");
        captionsAdd.type = "button";
        captionsAdd.id = "captions-add";
        captionsAdd.className = "hover-button";
        captionsAdd.setAttribute(
          "data-luftballons-target",
          "subtitle.captions_add",
        );
        captionsAdd.setAttribute("aria-label", "添加");
        captionsAdd.setAttribute("role", "button");
        captionsAdd.textContent = "添加";
        captionsAdd.style.visibility = "hidden";
        captionsAdd.addEventListener("click", () => {
          activeCaptionsLang = langCode;
          autoTranslateBtn.hidden = false;
        });
        cellContainer.append(captionsAdd);
      };
      for (const host of [captionsCell, hoverCell, cellContainer]) {
        host.addEventListener("mouseenter", stampCaptionsAdd);
        host.addEventListener("pointerenter", stampCaptionsAdd);
      }
    }
    item.append(captionsCell);
  };

  const appendMetadataCell = (
    item: HTMLElement,
    metadataPublished: boolean,
  ): void => {
    const meta = document.createElement("div");
    meta.className = "tablecell-metadata";
    meta.setAttribute("data-luftballons-metadata-cell", "true");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = metadataPublished ? "已发布" : "–";
    meta.append(status);
    item.append(meta);
  };

  const autoTranslateBtn = document.createElement("button");
  autoTranslateBtn.type = "button";
  autoTranslateBtn.id = "choose-auto-translate";
  autoTranslateBtn.setAttribute(
    "data-luftballons-target",
    "subtitle.auto_translate",
  );
  autoTranslateBtn.textContent = "自动翻译";
  autoTranslateBtn.hidden = true;

  const publishBtn = document.createElement("button");
  publishBtn.type = "button";
  publishBtn.setAttribute("data-luftballons-target", "subtitle.publish");
  publishBtn.setAttribute("aria-label", "Publish");
  publishBtn.setAttribute("role", "button");
  publishBtn.textContent = "Publish";
  publishBtn.disabled = true;
  publishBtn.setAttribute("aria-disabled", "true");

  const setPublishEnabled = (enabled: boolean): void => {
    publishBtn.disabled = !enabled;
    publishBtn.setAttribute("aria-disabled", enabled ? "false" : "true");
  };

  const renderItems = (): void => {
    if (!data.omitEmptyState) {
      list.setAttribute("data-subtitle-list-state", data.existingLanguages.length === 0 && !data.injectUnparseableRow ? "EMPTY" : "READY");
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    for (const lang of data.existingLanguages) {
      const state = lang.state ?? "PUBLISHED";
      const item = document.createElement("div");
      item.setAttribute("data-luftballons-subtitle-row", "true");
      const omitCodeAttrs =
        data.labelOnlyExistingRows && state !== "PENDING_PUBLISH";
      if (!omitCodeAttrs) {
        item.setAttribute("data-luftballons-subtitle-lang", lang.code);
        item.setAttribute("data-language-code", lang.code);
      }
      if (!lang.omitDataStateAttrs) {
        item.setAttribute("data-subtitle-state", state);
        if (state === "PUBLISHED") {
          item.setAttribute("data-subtitle-published", "true");
        } else {
          item.removeAttribute("data-subtitle-published");
        }
      } else {
        item.removeAttribute("data-subtitle-state");
        item.removeAttribute("data-subtitle-published");
      }
      const labelEl = document.createElement("span");
      labelEl.className = "tablecell-language language-text";
      labelEl.textContent =
        state === "PENDING_PUBLISH"
          ? `${lang.label} (pending)`
          : lang.label;
      item.append(labelEl);

      const captionsStatus =
        lang.captionsStatus ??
        (state === "PUBLISHED" ? "published" : "dash");
      appendCaptionsCell(item, lang.code, captionsStatus);
      appendMetadataCell(
        item,
        lang.metadataPublished ?? state === "PUBLISHED",
      );
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
        lang.captionsStatus = "published";
      }
    }
    autoTranslateBtn.hidden = true;
    markCaptionsReady(false);
    blankError.hidden = true;
    activeCaptionsLang = null;
    setPublishEnabled(false);
    renderItems();
    onLanguagesChanged();
  };

  autoTranslateBtn.addEventListener("click", () => {
    // Studio enables 发布 before cues finish loading.
    setPublishEnabled(true);
    markCaptionsReady(false, activeCaptionsLang ?? undefined);
    blankError.hidden = true;
    const delay = data.autoTranslateContentDelayMs ?? 0;
    const langAtClick = activeCaptionsLang;
    if (delay <= 0) {
      markCaptionsReady(true, langAtClick ?? undefined);
      return;
    }
    window.setTimeout(() => {
      markCaptionsReady(true, langAtClick ?? undefined);
    }, delay);
  });

  publishBtn.addEventListener("click", () => {
    clickCounts.publish += 1;
    const mode = data.publishMode ?? "commit";
    if (mode === "noop") {
      return;
    }
    if (
      captionsReady.getAttribute("data-luftballons-captions-ready") !== "true"
    ) {
      blankError.hidden = false;
      publishBtn.setAttribute("data-publish-error", "true");
      return;
    }
    blankError.hidden = true;
    publishBtn.removeAttribute("data-publish-error");
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
    commitPending();
    if (data.omitLanguagesListAfterPublish) {
      list.remove();
    }
  });
  editor.append(autoTranslateBtn, publishBtn, captionsReady, blankError);

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
