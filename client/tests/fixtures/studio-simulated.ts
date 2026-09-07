/**
 * Simulated YouTube Studio DOM fixtures.
 * Structure is constructed for detector/nav tests — NOT a real Studio snapshot.
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

export interface MountStudioFixtureOptions {
  layout?: FixtureLayout;
  page?: FixturePage;
  /** When true, DOM page marker disagrees with URL (conflict → UNKNOWN). */
  conflictDomPage?: FixturePage;
  /** Extra broken markup for unknown-layout tests. */
  corruptLayout?: boolean;
}

export interface StudioFixtureHandle {
  href: string;
  setPage(page: FixturePage): void;
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

/**
 * Mount a simulated Studio shell into document.body.
 * Call destroy() in afterEach.
 */
export function mountStudioFixture(
  options: MountStudioFixtureOptions = {},
): StudioFixtureHandle {
  const layout = options.layout ?? "2026_V1";
  const page = options.page ?? "DASHBOARD";

  const root = document.createElement("div");
  root.setAttribute("data-luftballons-fixture", "simulated-studio");
  root.setAttribute(
    "data-note",
    "simulated structure, not a real Studio snapshot",
  );

  const render = (current: FixturePage): void => {
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

    // Video details / subtitles deep links (not always in primary nav)
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

    const main = document.createElement("main");
    const domPage = options.conflictDomPage ?? current;
    main.setAttribute("data-page", domPage);
    main.setAttribute("aria-label", PAGE_ARIA[domPage]);
    main.textContent = `Simulated ${domPage}`;

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
    destroy() {
      root.remove();
    },
  };
}
