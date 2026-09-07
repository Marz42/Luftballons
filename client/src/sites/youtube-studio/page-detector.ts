/**
 * YouTube Studio page / layout detector (IMPLEMENTATION §11, §38).
 * Fail-closed: unknown or conflicting signals → UNKNOWN.
 */

import {
  LAYOUT_SIGNATURES,
  type LayoutFeatureContext,
} from "./selectors.js";

export type StudioPage =
  | "DASHBOARD"
  | "ANALYTICS"
  | "CONTENT"
  | "VIDEO_DETAILS"
  | "SUBTITLES"
  | "UNKNOWN";

export type StudioLayout = "2026_V1" | "2026_V2" | "UNKNOWN";

export type DetectRejectReason =
  | "UNSUPPORTED_LAYOUT"
  | "WRONG_PAGE"
  | "CONFLICT"
  | "NO_MATCH";

export interface PageDetection {
  page: StudioPage;
  layout: StudioLayout;
  /** Set when page or layout is not safely actionable. */
  reason?: DetectRejectReason;
  /** URL-derived page signal (may be UNKNOWN). */
  urlPage: StudioPage;
  /** DOM-derived page signal (may be UNKNOWN). */
  domPage: StudioPage;
}

export interface DetectStudioOptions {
  href?: string;
  document?: Document;
}

function pathnameOf(href: string): string {
  try {
    return new URL(href, "https://studio.youtube.com").pathname;
  } catch {
    return "";
  }
}

/**
 * Strong URL signal (logic-determined paths).
 * Unknown paths → UNKNOWN (never guess).
 */
export function detectPageFromUrl(href: string): StudioPage {
  const pathname = pathnameOf(href).toLowerCase();

  // Subtitles / translations under a video
  if (
    pathname.includes("/translations") ||
    pathname.includes("/subtitles")
  ) {
    return "SUBTITLES";
  }

  // Video details / editor
  if (
    pathname.includes("/video/") &&
    (pathname.includes("/edit") ||
      pathname.includes("/details") ||
      pathname.endsWith("/edit") ||
      /\/video\/[^/]+\/?$/.test(pathname))
  ) {
    return "VIDEO_DETAILS";
  }
  if (pathname.includes("/details")) {
    return "VIDEO_DETAILS";
  }

  if (pathname.includes("/analytics")) {
    return "ANALYTICS";
  }

  // Content library: /videos or /content
  if (pathname.includes("/videos") || pathname.includes("/content")) {
    return "CONTENT";
  }

  // Dashboard: /channel/UC… with no further product segment
  // e.g. /channel/UC_demo_channel or /channel/UC_demo_channel/
  const channelOnly = /^\/channel\/[^/]+\/?$/i.test(pathname);
  if (channelOnly || pathname === "/" || pathname === "") {
    return "DASHBOARD";
  }

  // /channel/UC…/blogging etc. — unknown product surfaces
  return "UNKNOWN";
}

/**
 * DOM corroboration (sidebar selected state / page title).
 * assumption, calibrate on real device for aria-current / selected patterns.
 */
export function detectPageFromDom(doc: Document): StudioPage {
  const main = doc.querySelector("main[data-page]");
  const dataPage = main?.getAttribute("data-page");
  if (
    dataPage === "DASHBOARD" ||
    dataPage === "ANALYTICS" ||
    dataPage === "CONTENT" ||
    dataPage === "VIDEO_DETAILS" ||
    dataPage === "SUBTITLES"
  ) {
    return dataPage;
  }

  // assumption, calibrate on real device: aria-current on sidebar
  const current = doc.querySelector(
    "ytcp-navigation-drawer a[aria-current='page'], ytcp-navigation-drawer [aria-current='page']",
  );
  if (current) {
    const label = (current.getAttribute("aria-label") ?? "").toLowerCase();
    const href = (current.getAttribute("href") ?? "").toLowerCase();
    if (label.includes("analytics") || href.includes("/analytics")) {
      return "ANALYTICS";
    }
    if (
      label.includes("content") ||
      href.includes("/videos") ||
      href.includes("/content")
    ) {
      return "CONTENT";
    }
    if (label.includes("dashboard") || label.includes("channel")) {
      return "DASHBOARD";
    }
    if (label.includes("subtitle") || href.includes("/translations")) {
      return "SUBTITLES";
    }
  }

  // assumption, calibrate on real device: main landmark aria-label
  const mainLabel = (
    doc.querySelector("main[aria-label]")?.getAttribute("aria-label") ?? ""
  ).toLowerCase();
  if (mainLabel.includes("analytics")) return "ANALYTICS";
  if (mainLabel.includes("content")) return "CONTENT";
  if (mainLabel.includes("dashboard")) return "DASHBOARD";
  if (mainLabel.includes("subtitle")) return "SUBTITLES";
  if (mainLabel.includes("video details") || mainLabel.includes("details")) {
    return "VIDEO_DETAILS";
  }

  return "UNKNOWN";
}

export function detectLayout(ctx: LayoutFeatureContext): StudioLayout {
  const matched = LAYOUT_SIGNATURES.filter((sig) => sig.matches(ctx)).map(
    (sig) => sig.layout,
  );
  if (matched.length === 1) {
    return matched[0]!;
  }
  // zero matches or conflict → UNKNOWN
  return "UNKNOWN";
}

/**
 * Merge URL (strong) + DOM (corroboration). Conflict → UNKNOWN.
 */
export function mergePageSignals(
  urlPage: StudioPage,
  domPage: StudioPage,
): { page: StudioPage; reason?: DetectRejectReason } {
  if (urlPage === "UNKNOWN" && domPage === "UNKNOWN") {
    return { page: "UNKNOWN", reason: "NO_MATCH" };
  }
  if (urlPage === "UNKNOWN") {
    // URL unknown: do not trust DOM alone for navigation safety
    return { page: "UNKNOWN", reason: "NO_MATCH" };
  }
  if (domPage === "UNKNOWN") {
    // URL strong signal with no DOM yet (SPA settling) — still report URL page
    // but callers that need postcondition should waitReady.
    return { page: urlPage };
  }
  if (urlPage !== domPage) {
    return { page: "UNKNOWN", reason: "CONFLICT" };
  }
  return { page: urlPage };
}

/**
 * Full Studio detection. Side-effecting ops must refuse when layout is UNKNOWN
 * (reason UNSUPPORTED_LAYOUT) or page is UNKNOWN where a specific page is required.
 */
export function detectStudio(
  options: DetectStudioOptions = {},
): PageDetection {
  const doc = options.document ?? document;
  const href =
    options.href ??
    (typeof location !== "undefined" ? location.href : "https://studio.youtube.com/");
  const pathname = pathnameOf(href);

  const layout = detectLayout({ href, pathname, document: doc });
  const urlPage = detectPageFromUrl(href);
  const domPage = detectPageFromDom(doc);
  const merged = mergePageSignals(urlPage, domPage);

  let reason: DetectRejectReason | undefined = merged.reason;
  if (layout === "UNKNOWN") {
    reason = "UNSUPPORTED_LAYOUT";
  } else if (merged.page === "UNKNOWN" && reason === undefined) {
    reason = "WRONG_PAGE";
  }

  const result: PageDetection = {
    page: layout === "UNKNOWN" ? merged.page : merged.page,
    layout,
    urlPage,
    domPage,
  };
  if (reason !== undefined) {
    result.reason = reason;
  }
  return result;
}

/**
 * Module detect helper: studio host + known layout → available.
 */
export function studioModuleAvailability(input: {
  hostname: string;
  href: string;
  document?: Document;
}): {
  available: boolean;
  reason?:
    | "WRONG_SITE"
    | "UNSUPPORTED_LAYOUT"
    | "WRONG_PAGE"
    | "DISABLED"
    | "MISSING_REQUIREMENT";
  metadata?: Record<string, unknown>;
} {
  if (input.hostname !== "studio.youtube.com") {
    return {
      available: false,
      reason: "WRONG_SITE",
      metadata: { hostname: input.hostname },
    };
  }

  const detection = detectStudio({
    href: input.href,
    ...(input.document !== undefined ? { document: input.document } : {}),
  });

  if (detection.layout === "UNKNOWN") {
    return {
      available: false,
      reason: "UNSUPPORTED_LAYOUT",
      metadata: {
        layout: detection.layout,
        page: detection.page,
        urlPage: detection.urlPage,
        domPage: detection.domPage,
      },
    };
  }

  return {
    available: true,
    metadata: {
      layout: detection.layout,
      page: detection.page,
    },
  };
}
