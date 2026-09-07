/**
 * Centralized DomTargets + layout signatures for YouTube Studio.
 * IMPLEMENTATION §45: selectors centralized; §11 layout versions.
 *
 * Calibrated entries cite real-device DOM evidence (P2 calibration batch).
 * Uncalibrated collection / page-ready fields remain assumption-marked.
 */

import type { DomTarget } from "../../services/dom-service.js";

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
    // calibrated (P4 prep): translations entry in sidebar
    // future fallback (no aria-label on real device): ariaLabel: "Subtitles"
    selectorFallback: 'ytcp-navigation-drawer a[href*="/translations"]',
  },
  "page.dashboard.title": {
    id: "page.dashboard.title",
    // assumption, calibrate on real device
    ariaLabel: "Channel dashboard",
    selectorFallback: 'main[data-page="DASHBOARD"]',
  },
  "page.analytics.title": {
    id: "page.analytics.title",
    // assumption, calibrate on real device
    ariaLabel: "Channel analytics",
    selectorFallback: 'main[data-page="ANALYTICS"]',
  },
  "page.content.title": {
    id: "page.content.title",
    // calibrated: variant A has ytcp-video-section in main; variant B
    // container unreported — fall through to main#main / main (optional).
    selectorFallback: ["main ytcp-video-section", "main#main", "main"],
    optional: true,
  },
  "page.video_details.title": {
    id: "page.video_details.title",
    // assumption, calibrate on real device
    ariaLabel: "Video details",
    selectorFallback: 'main[data-page="VIDEO_DETAILS"]',
  },
  "page.subtitles.title": {
    id: "page.subtitles.title",
    // assumption, calibrate on real device
    ariaLabel: "Subtitles",
    selectorFallback: 'main[data-page="SUBTITLES"]',
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
  // Uncalibrated collection fields — keep assumption markers; do not invent.
  "channel.name": {
    id: "channel.name",
    // assumption, calibrate on real device: channel title in Studio chrome
    ariaLabel: "Channel name",
    selectorFallback:
      '[data-luftballons-target="channel.name"], ytcp-channel-name, #channel-name',
  },
  "dashboard.period": {
    id: "dashboard.period",
    // assumption, calibrate on real device: reporting period control label
    ariaLabel: "Reporting period",
    selectorFallback:
      '[data-luftballons-target="dashboard.period"], [data-metric="period"]',
  },
  "dashboard.views": {
    id: "dashboard.views",
    // assumption, calibrate on real device: Dashboard views summary card
    ariaLabel: "Views",
    selectorFallback:
      '[data-luftballons-target="dashboard.views"], [data-metric="views"]',
  },
  "dashboard.subscriberDelta": {
    id: "dashboard.subscriberDelta",
    // assumption, calibrate on real device: net subscribers card on Dashboard
    ariaLabel: "Subscribers",
    selectorFallback:
      '[data-luftballons-target="dashboard.subscriberDelta"], [data-metric="subscriber-delta"]',
  },
  "analytics.views": {
    id: "analytics.views",
    // assumption, calibrate on real device: Analytics overview views
    ariaLabel: "Views",
    selectorFallback:
      'main[data-page="ANALYTICS"] [data-luftballons-target="analytics.views"], main[data-page="ANALYTICS"] [data-metric="views"]',
  },
  "analytics.subscriberDelta": {
    id: "analytics.subscriberDelta",
    // assumption, calibrate on real device: Analytics subscriber growth
    ariaLabel: "Subscribers",
    selectorFallback:
      'main[data-page="ANALYTICS"] [data-luftballons-target="analytics.subscriberDelta"], main[data-page="ANALYTICS"] [data-metric="subscriber-delta"]',
  },
  "content.videos.list": {
    id: "content.videos.list",
    // assumption, calibrate on real device: Content library table/list root
    ariaLabel: "Channel content list",
    selectorFallback:
      '[data-luftballons-target="content.videos.list"], ytcp-video-section-content, table.video-table tbody',
  },
} as const satisfies Record<string, DomTarget>;

/**
 * Relative selector for recent-video rows under content.videos.list.
 * assumption, calibrate on real device: row carries video id + title/views cells.
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
  /** Fallback source for channel id extraction. */
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
    case "SUBTITLES":
      return STUDIO_TARGETS["nav.subtitles"];
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
