/**
 * Centralized DomTargets + layout signatures for YouTube Studio.
 * IMPLEMENTATION §45: selectors centralized; §11 layout versions.
 *
 * Calibrated entries cite real-device DOM evidence (P2 calibration batch).
 * Uncalibrated collection / page-ready fields remain assumption-marked.
 */

import type { DomTarget } from "../../services/dom-service.js";

/** Ignore retained SPA pages and explicitly hidden UI without geometry polling. */
export function isActiveElement(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
    if (node.matches("ytcp-animatable.page:not(.selected)")) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

function calibrated(id: string, selectorFallback: string, matches = isActiveElement): DomTarget {
  return { id, selectorFallback, matches, unique: true };
}

export const CONTENT_FIELDS = {
  title: "a#video-title",
  views: ".tablecell-views",
  publishedAt: ".tablecell-date",
  dateType: ".tablecell-date .cell-description",
  dateSort: "ytcp-table-header .tablecell-date",
  footer: "ytcp-table-footer#footer",
  range: ".page-description",
  next: "#navigate-after",
  previous: "#navigate-before",
} as const;

/** Navigable pages (excludes UNKNOWN). Matches NavigationService StudioTarget. */
export type StudioTarget =
  | "DASHBOARD"
  | "ANALYTICS"
  | "CONTENT"
  | "VIDEO_DETAILS"
  | "SUBTITLES";

export interface LayoutFeatureContext {
  href: string;
  pathname: string;
  document: Document;
}

export interface LayoutSignature {
  layout: "2026_V1" | "2026_V2";
  /**
   * True when this layout version is a credible match.
   * Fail-closed: ambiguous / partial matches must return false.
   */
  matches(ctx: LayoutFeatureContext): boolean;
}

function cssEscapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Extract channel id from a Studio href (/channel/{id}/…).
 */
export function extractChannelIdFromHref(href: string): string | null {
  try {
    const pathname = new URL(href, "https://studio.youtube.com").pathname;
    const m = pathname.match(/^\/channel\/([^/]+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract video id from Studio URL …/video/{id}/…
 * Fail-closed: return null when absent (do not guess).
 */
export function extractVideoIdFromHref(href: string): string | null {
  try {
    const pathname = new URL(href, "https://studio.youtube.com").pathname;
    const m = pathname.match(/\/video\/([^/]+)/i);
    const id = m?.[1]?.trim();
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Video-scoped Subtitles / Translations nav target.
 * assumption, calibrate on real device: prefer /video/{id}/translations
 * (editor tab) over channel-level /channel/.../translations sidebar entry.
 */
export function subtitlesNavTarget(videoId: string): DomTarget {
  const id = cssEscapeAttr(videoId);
  return {
    id: "nav.subtitles.video",
    // assumption, calibrate on real device
    selectorFallback: [
      `a[href="/video/${id}/translations"]`,
      `a[href*="/video/${id}/translations"]`,
      `[data-luftballons-target="nav.subtitles.video"][href*="/video/${id}/"]`,
    ],
    matches: isActiveElement,
    unique: true,
  };
}

/**
 * Dashboard sidebar anchor — href path exact `/channel/{channelId}`
 * (variant A) or `/channel/{channelId}?theme=dark` (variant B).
 * Does not match the absolute www.youtube.com channel home outbound link.
 */
export function dashboardNavTarget(channelId: string): DomTarget {
  const id = cssEscapeAttr(channelId);
  return {
    id: "nav.dashboard",
    // future fallback (real Studio sidebar items have no aria-label):
    // ariaLabel: "Dashboard",
    selectorFallback: [
      `ytcp-navigation-drawer a[href="/channel/${id}"]`,
      `ytcp-navigation-drawer a[href="/channel/${id}?theme=dark"]`,
    ],
  };
}

/**
 * DomTargets keyed by logical id. `id` is the registry key, not an HTML id.
 */
export const STUDIO_TARGETS = {
  "nav.dashboard": {
    id: "nav.dashboard",
    // Prefer dashboardNavTarget(channelId) at runtime (exact href path).
    // future fallback (real device has no aria-label): ariaLabel: "Dashboard"
    selectorFallback: [
      'ytcp-navigation-drawer a[href="/channel/__runtime_channel_id__"]',
    ],
  },
  "nav.analytics": {
    id: "nav.analytics",
    // calibrated: both variants use …/analytics/tab-overview…
    // future fallback (no aria-label on real device): ariaLabel: "Analytics"
    selectorFallback:
      'ytcp-navigation-drawer a[href*="/analytics/tab-overview"]',
  },
  "nav.content": {
    id: "nav.content",
    // calibrated dual variant: /videos/upload (A) or /content (B)
    // future fallback (no aria-label on real device): ariaLabel: "Content"
    selectorFallback: [
      'ytcp-navigation-drawer a[href*="/videos/upload"]',
      'ytcp-navigation-drawer a[href*="/content"]',
    ],
  },
  "nav.subtitles": {
    id: "nav.subtitles",
    // calibrated (P4 prep): channel-level translations entry in sidebar.
    // WRITE paths must use subtitlesNavTarget(videoId) / navTargetFor("SUBTITLES")
    // instead — channel-level must not bind publish to a video (P1-1).
    // future fallback (no aria-label on real device): ariaLabel: "Subtitles"
    selectorFallback: 'ytcp-navigation-drawer a[href*="/translations"]',
  },
  "page.dashboard.title": calibrated("page.dashboard.title",
    'ytcp-app h1.page-title[theme="DASHBOARD"], main[data-page="DASHBOARD"]'),
  // DEFAULT theme alone is not an Analytics signature. Require its data surface.
  "page.analytics.title": calibrated("page.analytics.title",
    'yta-time-picker #picker-trigger, main[data-page="ANALYTICS"]'),
  "page.content.title": {
    id: "page.content.title",
    // calibrated: variant A has ytcp-video-section in main; variant B
    // container unreported — fall through to main#main / main (optional).
    selectorFallback: ["main ytcp-video-section", "main#main", "main"],
    optional: true,
  },
  "page.video_details.title": {
    id: "page.video_details.title",
    // assumption, calibrate on real device (edit surface)
    ariaLabel: "Video details",
    selectorFallback: 'main[data-page="VIDEO_DETAILS"]',
  },
  "page.subtitles.title": {
    id: "page.subtitles.title",
    // calibrated 2026-09-08 zh-Hans-CN: translations list table + h1「视频字幕」
    // (no English aria-label "Subtitles"; main has no data-page on real Studio)
    text: "视频字幕",
    selectorFallback: [
      "#ytgn-video-translations-list-table",
      'main[data-page="SUBTITLES"]', // fixture-only helper
    ],
    matches: isActiveElement,
    unique: true,
  },
  "layout.2026_v1.root": {
    id: "layout.2026_v1.root",
    // calibrated: real shell is ytcp-app + ytcp-navigation-drawer
    // (tp-yt-app-drawer does not exist on observed devices)
    selectorFallback: "ytcp-app",
  },
  "layout.2026_v2.root": {
    id: "layout.2026_v2.root",
    // 待真机证据 — signature matches() is always false until then
    selectorFallback: "ytcp-app-v2-pending-evidence",
  },

  // --- Channel basic collector anchors (FT-009) ---
  // 2026-09-07 zh-Hans-CN evidence: docs/studio-dom-calibration.md.
  "channel.name": calibrated("channel.name", "ytcp-navigation-drawer #entity-name"),
  "dashboard.period": calibrated("dashboard.period",
    "ytcd-channel-facts-item .section-title > .section-subtitle-text",
    el => isActiveElement(el) && el.parentElement?.querySelector(".section-title-text")?.textContent?.trim() === "摘要"),
  "dashboard.views": calibrated("dashboard.views",
    "ytcd-channel-facts-item #metrics-table #metric-0-value",
    el => isActiveElement(el) && el.closest(".metric-row")?.querySelector(".metric-title")?.textContent?.trim() === "观看次数"),
  // Only the empty trend is evidenced; do not parse future prose as net growth.
  "dashboard.subscriberDelta": calibrated("dashboard.subscriberDelta", "ytcd-channel-facts-item .subscribers-trend", el => isActiveElement(el) && !el.textContent?.trim()),
  "analytics.views": calibrated("analytics.views", "#key-metric-blocks #EXTERNAL_VIEWS-tab #metric-total"),
  "analytics.subscriberDelta": calibrated("analytics.subscriberDelta", "#key-metric-blocks #SUBSCRIBERS_NET_CHANGE-tab #metric-total"),
  "analytics.period": calibrated("analytics.period", "yta-time-picker #picker-trigger .dropdown-trigger-text"),
  "analytics.dates": calibrated("analytics.dates", "yta-time-picker #picker-trigger .label-text"),
  "content.videos.list": calibrated("content.videos.list", "ytcp-video-section-content#video-list"),
} as const satisfies Record<string, DomTarget>;

/**
 * Subtitle editor DomTargets (FT-011).
 * Partially calibrated 2026-09-08 (page ready + languages list table).
 * Remaining write-path entries stay assumptions until add/picker/publish evidence.
 */
export const SUBTITLE_TARGETS = {
  "subtitle.editor": {
    id: "subtitle.editor",
    // assumption, calibrate on real device — unique active editor surface
    // 2026-09-08: translations page is a table surface; keep fixture markers.
    selectorFallback: [
      '[data-luftballons-target="subtitle.editor"]',
      "#ytgn-video-translations-list-table",
      "ytcp-uploads-dialog",
      'main[data-page="SUBTITLES"]',
    ],
    matches: isActiveElement,
    unique: true,
  },
  "subtitle.languages.list": {
    id: "subtitle.languages.list",
    // Layout A/B: ytgn-video-translations-list (+ table). Fixture: data-luftballons-target.
    ariaLabel: "翻译",
    selectorFallback: [
      "#ytgn-video-translations-list-table",
      "ytgn-video-translations-list",
      '[data-luftballons-target="subtitle.languages.list"]',
      "ytcp-uploads-dialog #language-list",
      "#translations-list",
      '[aria-label="可滚动的翻译"]',
    ],
    matches: isActiveElement,
    unique: true,
  },
  "subtitle.language.item": {
    id: "subtitle.language.item",
    // assumption, calibrate on real device — relative rows under languages.list
    selectorFallback:
      '[data-luftballons-subtitle-lang], [data-language-code], ytcp-language-item',
  },
  "subtitle.add_language": {
    id: "subtitle.add_language",
    // calibrated 2026-09-08: black control labeled 添加语言 below translations table
    // (not inside #ytgn-video-translations-list-table). Fixture: "Add language".
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      const aria = (el.getAttribute("aria-label") ?? "").trim();
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return (
        aria === "Add language" ||
        aria === "添加语言" ||
        text === "Add language" ||
        text === "添加语言"
      );
    },
    selectorFallback: [
      '[data-luftballons-target="subtitle.add_language"]',
      "#add-language-button",
      'button[aria-label*="Add language"]',
      'button[aria-label*="添加语言"]',
      "ytcp-button",
      "button",
    ],
    unique: true,
  },
  "subtitle.language.picker": {
    id: "subtitle.language.picker",
    // Live 2026-09-08: must NOT match video sidebar [role=menuitem] drawer.
    // Positive: fixture marker, listbox, or host whose text looks like a language catalog.
    selectorFallback: [
      '[data-luftballons-target="subtitle.language.picker"]',
      "#language-picker",
      "tp-yt-paper-listbox",
      '[role="listbox"]',
      "tp-yt-iron-dropdown #contentWrapper",
      "iron-dropdown #contentWrapper",
      '[role="menu"]',
    ],
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (el.closest("ytcp-navigation-drawer")) {
        return false;
      }
      if (el.getAttribute("data-luftballons-target") === "subtitle.language.picker") {
        return true;
      }
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      // Sidebar chrome only — reject (seen in live probe).
      if (
        /详细信息|数据分析|编辑器|版权声明/.test(text) &&
        !/(阿布哈兹|日语|日本語|英语|English|Japanese|Arabic|阿拉伯)/i.test(text)
      ) {
        return false;
      }
      if (el.getAttribute("role") === "listbox") {
        return true;
      }
      if (el.tagName.toLowerCase() === "tp-yt-paper-listbox") {
        return true;
      }
      // Language catalog signal (zh list uses …语 names).
      return /(阿布哈兹|日语|日本語|语|English|Japanese)/i.test(text);
    },
    unique: true,
  },
  "subtitle.language.option": {
    id: "subtitle.language.option",
    // assumption, calibrate on real device — option row; code via data-language-code
    // Prefer explicit option markers — never bare language rows.
    selectorFallback:
      '[data-luftballons-subtitle-option], [data-language-code][data-luftballons-subtitle-option], tp-yt-paper-item',
    matches: isActiveElement,
    unique: true,
  },
  "subtitle.publish": {
    id: "subtitle.publish",
    // Layout A/B: language-editor 发布 after 自动翻译 (2026-09-08/09).
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
        return false;
      }
      const aria = (el.getAttribute("aria-label") ?? "").trim();
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return (
        aria === "Publish" ||
        aria === "发布" ||
        text === "Publish" ||
        text === "发布"
      );
    },
    role: "button",
    selectorFallback: [
      '[data-luftballons-target="subtitle.publish"]',
      '#publish-button',
      'button[aria-label="发布"]',
      'button[aria-label="Publish"]',
      'button[aria-label*="Publish"]',
      "button",
    ],
    unique: true,
  },
  "subtitle.captions_add": {
    id: "subtitle.captions_add",
    // Layout A: hover stamps ytcp-icon-button#captions-add[aria-label=添加]
    // (may stay CSS-hidden without real :hover — ignoreVisibility).
    ignoreVisibility: true,
    matches: (el) => {
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
        return false;
      }
      if (el.id === "captions-add") {
        return true;
      }
      // Prefer id; bare aria-label=添加 is too common for document-wide unique.
      return false;
    },
    selectorFallback: [
      '[data-luftballons-target="subtitle.captions_add"]',
      "ytcp-icon-button#captions-add",
      "#captions-add",
    ],
    unique: true,
  },
  "subtitle.manual_captions_add": {
    id: "subtitle.manual_captions_add",
    // Layout B: 手动字幕 row → #language-details-text-button-subtitles
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
        return false;
      }
      if (el.id === "language-details-text-button-subtitles") {
        return true;
      }
      const host =
        el.closest("#language-details-text-button-subtitles") ??
        el.closest(".manual-subtitles-row");
      if (!host) {
        return false;
      }
      const aria = (el.getAttribute("aria-label") ?? "").trim();
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return aria === "添加" || text === "添加" || aria === "Add" || text === "Add";
    },
    selectorFallback: [
      '[data-luftballons-target="subtitle.manual_captions_add"]',
      "#language-details-text-button-subtitles button",
      "#language-details-text-button-subtitles",
      "tr.manual-subtitles-row button[aria-label='添加']",
      "tr.manual-subtitles-row button",
    ],
    unique: true,
  },
  "subtitle.auto_translate": {
    id: "subtitle.auto_translate",
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (el.id === "choose-auto-translate") {
        return true;
      }
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return text.includes("自动翻译") || /auto[\s-]?translate/i.test(text);
    },
    selectorFallback: [
      '[data-luftballons-target="subtitle.auto_translate"]',
      "#choose-auto-translate",
      "button#choose-auto-translate",
      "ytve-captions-editor-options-panel #choose-auto-translate",
    ],
    unique: true,
  },
  /**
   * Captions body ready after 自动翻译 (publish can enable before cues load —
   * live 2026-09-08: 无法发布空白字幕 when clicking too early).
   */
  "subtitle.captions.ready": {
    id: "subtitle.captions.ready",
    ignoreVisibility: true,
    matches: (el) => {
      if (el.getAttribute("data-luftballons-captions-ready") === "true") {
        return true;
      }
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 1) {
        return false;
      }
      // Reject empty-state / blank warnings as "ready".
      if (/字幕空白|无法发布空白|blank caption/i.test(text) && text.length < 80) {
        return false;
      }
      return true;
    },
    selectorFallback: [
      '[data-luftballons-captions-ready="true"]',
      "ytve-timedtext-segment",
      ".cue-text",
      ".timedtext-text",
      "ytve-captions-editor [contenteditable='true']",
      "ytve-timedtext-editor [contenteditable='true']",
      "ytve-captions-editor textarea",
      "ytve-timedtext-editor textarea",
    ],
    unique: false,
  },
  "subtitle.publish.blank_error": {
    id: "subtitle.publish.blank_error",
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return (
        text.includes("无法发布空白字幕") ||
        text.includes("字幕空白") ||
        /cannot publish blank/i.test(text) ||
        /blank subtitle/i.test(text)
      );
    },
    selectorFallback: [
      '[data-luftballons-target="subtitle.publish.blank_error"]',
      '[role="alert"]',
      "tp-yt-paper-toast",
      "ytcp-paper-toast",
      "[aria-live='assertive']",
      "[aria-live='polite']",
    ],
    unique: false,
  },
} as const satisfies Record<string, DomTarget>;

export type SubtitleTargetId = keyof typeof SUBTITLE_TARGETS;

export function getSubtitleTarget(id: SubtitleTargetId): DomTarget {
  return SUBTITLE_TARGETS[id];
}

/**
 * Relative selector for recent-video rows under content.videos.list.
 * Real row host is ytcp-video-row; data-* alternatives support simulated fixtures.
 */
export const CONTENT_VIDEO_ROW_SELECTOR =
  '[data-luftballons-video-row], ytcp-video-row, tr[data-video-id]';

export type StudioTargetId = keyof typeof STUDIO_TARGETS;

export function getTarget(id: StudioTargetId): DomTarget {
  return STUDIO_TARGETS[id];
}

export interface NavTargetOptions {
  /** Prefer explicit channel id when constructing dashboard href selectors. */
  channelId?: string;
  /** Prefer explicit video id when constructing subtitles href selectors. */
  videoId?: string;
  /** Fallback source for channel / video id extraction. */
  href?: string;
}

export function navTargetFor(
  page: StudioTarget,
  options: NavTargetOptions = {},
): DomTarget {
  switch (page) {
    case "DASHBOARD": {
      const channelId =
        options.channelId ??
        (options.href ? extractChannelIdFromHref(options.href) : null);
      if (channelId) {
        return dashboardNavTarget(channelId);
      }
      return STUDIO_TARGETS["nav.dashboard"];
    }
    case "ANALYTICS":
      return STUDIO_TARGETS["nav.analytics"];
    case "CONTENT":
      return STUDIO_TARGETS["nav.content"];
    case "VIDEO_DETAILS":
      // assumption, calibrate on real device: details usually from content list
      return {
        id: "nav.video_details",
        // future: ariaLabel when real device evidence exists
        selectorFallback: 'a[href*="/video/"][href*="/edit"]',
      };
    case "SUBTITLES": {
      // Video-scoped only — channel-level /translations must not be used for
      // WRITE paths (P1-1). Fail closed when video id is unknown.
      const videoId =
        options.videoId ??
        (options.href ? extractVideoIdFromHref(options.href) : null);
      if (videoId) {
        return subtitlesNavTarget(videoId);
      }
      // No video id → return a never-matching target (NO_ANCHOR), not channel nav.
      return {
        id: "nav.subtitles.video",
        selectorFallback: "a[data-luftballons-missing-video-subtitles-nav]",
        unique: true,
      };
    }
  }
}

export function pageReadyTarget(page: StudioTarget): DomTarget {
  switch (page) {
    case "DASHBOARD":
      return STUDIO_TARGETS["page.dashboard.title"];
    case "ANALYTICS":
      return STUDIO_TARGETS["page.analytics.title"];
    case "CONTENT":
      return STUDIO_TARGETS["page.content.title"];
    case "VIDEO_DETAILS":
      return STUDIO_TARGETS["page.video_details.title"];
    case "SUBTITLES":
      return STUDIO_TARGETS["page.subtitles.title"];
  }
}

/**
 * Layout signatures. Unique match → that layout; zero or >1 → UNKNOWN.
 */
export const LAYOUT_SIGNATURES: LayoutSignature[] = [
  {
    layout: "2026_V1",
    matches(ctx) {
      // calibrated: real device has ytcp-app + ytcp-navigation-drawer.
      // tp-yt-app-drawer is absent and must not participate in matching.
      // data-luftballons-layout is fixture-only and must not be required.
      const app = ctx.document.querySelector("ytcp-app");
      const drawer = ctx.document.querySelector("ytcp-navigation-drawer");
      return Boolean(app && drawer);
    },
  },
  {
    layout: "2026_V2",
    matches(_ctx) {
      // 待真机证据 — structural placeholder; never claim a match yet.
      return false;
    },
  },
];
