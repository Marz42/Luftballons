/**
 * Centralized DomTargets + layout signatures for YouTube Studio.
 * IMPLEMENTATION §45: selectors centralized; §11 layout versions.
 *
 * DOM selectors that claim Studio structure are assumptions until
 * calibrated on a real logged-in device. See docs/manual-acceptance-p2.md.
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

/**
 * DomTargets keyed by logical id. `id` is the registry key, not an HTML id.
 */
export const STUDIO_TARGETS = {
  "nav.dashboard": {
    id: "nav.dashboard",
    // assumption, calibrate on real device: Studio sidebar Dashboard item
    ariaLabel: "Dashboard",
    role: "link",
    selectorFallback:
      'ytcp-navigation-drawer a[href*="/channel/"][data-nav="dashboard"]',
  },
  "nav.analytics": {
    id: "nav.analytics",
    // assumption, calibrate on real device
    ariaLabel: "Analytics",
    role: "link",
    selectorFallback: 'ytcp-navigation-drawer a[href*="/analytics"]',
  },
  "nav.content": {
    id: "nav.content",
    // assumption, calibrate on real device: Content tab often labeled "Content"
    ariaLabel: "Content",
    role: "link",
    selectorFallback: 'ytcp-navigation-drawer a[href*="/videos"]',
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
    // assumption, calibrate on real device
    ariaLabel: "Channel content",
    selectorFallback: 'main[data-page="CONTENT"]',
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
    // assumption, calibrate on real device: ytcp-app + navigation drawer
    // Fixtures set data-luftballons-layout="2026_V1" for deterministic tests.
    selectorFallback: 'ytcp-app[data-luftballons-layout="2026_V1"]',
  },
  "layout.2026_v2.root": {
    id: "layout.2026_v2.root",
    // assumption, calibrate on real device: alternate A/B shell marker
    selectorFallback: 'ytcp-app[data-luftballons-layout="2026_V2"]',
  },

  // --- Channel basic collector anchors (FT-009) ---
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

export function navTargetFor(page: StudioTarget): DomTarget {
  switch (page) {
    case "DASHBOARD":
      return STUDIO_TARGETS["nav.dashboard"];
    case "ANALYTICS":
      return STUDIO_TARGETS["nav.analytics"];
    case "CONTENT":
      return STUDIO_TARGETS["nav.content"];
    case "VIDEO_DETAILS":
      // assumption, calibrate on real device: details usually from content list
      return {
        id: "nav.video_details",
        ariaLabel: "Video details",
        role: "link",
        selectorFallback: 'a[href*="/video/"][href*="/edit"]',
      };
    case "SUBTITLES":
      return {
        id: "nav.subtitles",
        ariaLabel: "Subtitles",
        role: "link",
        selectorFallback: 'a[href*="/translations"]',
      };
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
      const v1 = ctx.document.querySelector(
        'ytcp-app[data-luftballons-layout="2026_V1"]',
      );
      const v2 = ctx.document.querySelector(
        'ytcp-app[data-luftballons-layout="2026_V2"]',
      );
      // Dual markers → neither claims a unique match (detector → UNKNOWN).
      if (v1 && v2) {
        return false;
      }
      if (v1) {
        return true;
      }
      if (v2) {
        return false;
      }
      // assumption, calibrate on real device: classic Studio shell
      // (ytcp-app + ytcp-navigation-drawer) without A/B marker.
      const app = ctx.document.querySelector("ytcp-app");
      const drawer = ctx.document.querySelector("ytcp-navigation-drawer");
      return Boolean(app && drawer);
    },
  },
  {
    layout: "2026_V2",
    matches(ctx) {
      const v1 = ctx.document.querySelector(
        'ytcp-app[data-luftballons-layout="2026_V1"]',
      );
      const v2 = ctx.document.querySelector(
        'ytcp-app[data-luftballons-layout="2026_V2"]',
      );
      if (v1 && v2) {
        return false;
      }
      // Only explicit V2 marker for now — no speculative public structure.
      // assumption, calibrate on real device once A/B shell is observed.
      return Boolean(v2);
    },
  },
];
