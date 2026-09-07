import { afterEach, describe, expect, it } from "vitest";
import { createDomService, resolveDomTarget } from "../../src/services/dom-service.js";
import {
  detectLayout,
  detectPageFromDom,
  detectPageFromUrl,
  detectStudio,
  mergePageSignals,
  studioModuleAvailability,
} from "../../src/sites/youtube-studio/page-detector.js";
import {
  dashboardNavTarget,
  navTargetFor,
  STUDIO_TARGETS,
} from "../../src/sites/youtube-studio/selectors.js";
import {
  createNavigationService,
} from "../../src/sites/youtube-studio/navigation.js";
import {
  mountConflictingLayoutFixture,
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";

describe("page detector (FT-007)", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  describe("URL mapping", () => {
    it("maps known Studio paths", () => {
      expect(
        detectPageFromUrl("https://studio.youtube.com/channel/UC_demo_channel"),
      ).toBe("DASHBOARD");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/analytics",
        ),
      ).toBe("ANALYTICS");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/videos",
        ),
      ).toBe("CONTENT");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/content",
        ),
      ).toBe("CONTENT");
      expect(
        detectPageFromUrl("https://studio.youtube.com/video/vid_demo_001/edit"),
      ).toBe("VIDEO_DETAILS");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/video/vid_demo_001/translations",
        ),
      ).toBe("SUBTITLES");
    });

    it("strips query (?theme=dark) via pathname", () => {
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel?theme=dark",
        ),
      ).toBe("DASHBOARD");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/content?theme=dark",
        ),
      ).toBe("CONTENT");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/analytics/tab-overview/period-default?theme=dark",
        ),
      ).toBe("ANALYTICS");
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/videos/upload",
        ),
      ).toBe("CONTENT");
    });

    it("returns UNKNOWN for unrecognized paths", () => {
      expect(
        detectPageFromUrl(
          "https://studio.youtube.com/channel/UC_demo_channel/blogging",
        ),
      ).toBe("UNKNOWN");
      expect(
        detectPageFromUrl("https://studio.youtube.com/unknown/surface"),
      ).toBe("UNKNOWN");
    });
  });

  describe("DOM + merge", () => {
    it("reads DOM page from aria-current href (no data-page / aria-label)", () => {
      fixture = mountStudioFixture({ page: "ANALYTICS" });
      expect(detectPageFromDom(document)).toBe("ANALYTICS");
      const current = document.querySelector(
        "ytcp-navigation-drawer a[aria-current='page']",
      );
      expect(current?.getAttribute("aria-label")).toBeNull();
      expect(document.querySelector("main")?.getAttribute("aria-label")).toBeNull();
    });

    it("conflicts when URL and DOM disagree → UNKNOWN", () => {
      fixture = mountStudioFixture({
        page: "ANALYTICS",
        conflictDomPage: "DASHBOARD",
      });
      const merged = mergePageSignals("ANALYTICS", "DASHBOARD");
      expect(merged.page).toBe("UNKNOWN");
      expect(merged.reason).toBe("CONFLICT");

      const detection = detectStudio({
        href: fixture.href,
        document,
      });
      expect(detection.page).toBe("UNKNOWN");
      expect(detection.reason).toBe("CONFLICT");
      expect(detection.domPage).toBe("DASHBOARD");
      expect(detection.urlPage).toBe("ANALYTICS");
    });
  });

  describe("layout signatures", () => {
    it("matches 2026_V1 via ytcp-app + ytcp-navigation-drawer", () => {
      fixture = mountStudioFixture({ layout: "2026_V1" });
      expect(document.querySelector("ytcp-app")).toBeTruthy();
      expect(document.querySelector("ytcp-navigation-drawer")).toBeTruthy();
      expect(
        document.querySelector("ytcp-app[data-luftballons-layout]"),
      ).toBeNull();
      const layout = detectLayout({
        href: fixture.href,
        pathname: new URL(fixture.href).pathname,
        document,
      });
      expect(layout).toBe("2026_V1");
    });

    it("2026_V2 signature never matches (pending real-device evidence)", () => {
      fixture = mountStudioFixture({ layout: "2026_V2", page: "CONTENT" });
      expect(
        detectStudio({ href: fixture.href, document }).layout,
      ).toBe("UNKNOWN");
    });

    it("returns UNKNOWN when layout shell is missing", () => {
      fixture = mountStudioFixture({ layout: "NONE" });
      expect(
        detectStudio({ href: fixture.href, document }).layout,
      ).toBe("UNKNOWN");
      expect(
        detectStudio({ href: fixture.href, document }).reason,
      ).toBe("UNSUPPORTED_LAYOUT");
    });

    it("returns UNKNOWN when no signature matches", () => {
      fixture = mountConflictingLayoutFixture();
      expect(
        detectStudio({ href: fixture.href, document }).layout,
      ).toBe("UNKNOWN");
    });
  });

  describe("P2 calibration — dual content variants", () => {
    it("variant A (/videos/upload + ytcp-video-section) → layout V1, page CONTENT", () => {
      fixture = mountStudioFixture({
        layout: "2026_V1",
        page: "CONTENT",
        contentVariant: "A",
      });
      const detection = detectStudio({ href: fixture.href, document });
      expect(detection.layout).toBe("2026_V1");
      expect(detection.page).toBe("CONTENT");
      expect(detection.urlPage).toBe("CONTENT");
      expect(detection.domPage).toBe("CONTENT");
      expect(document.querySelector("main ytcp-video-section")).toBeTruthy();
      expect(fixture.href).toContain("/videos/upload");
    });

    it("variant B (/content?theme=dark) → layout V1, page CONTENT", () => {
      fixture = mountStudioFixture({
        layout: "2026_V1",
        page: "CONTENT",
        contentVariant: "B",
        collector: false,
      });
      const detection = detectStudio({ href: fixture.href, document });
      expect(detection.layout).toBe("2026_V1");
      expect(detection.page).toBe("CONTENT");
      expect(detection.urlPage).toBe("CONTENT");
      expect(detection.domPage).toBe("CONTENT");
      expect(fixture.href).toContain("/content?theme=dark");
      expect(document.querySelector("main ytcp-video-section")).toBeNull();
    });
  });

  describe("module availability", () => {
    it("is available on studio host with known layout", () => {
      fixture = mountStudioFixture({ layout: "2026_V1" });
      const avail = studioModuleAvailability({
        hostname: "studio.youtube.com",
        href: fixture.href,
        document,
      });
      expect(avail.available).toBe(true);
      expect(avail.metadata?.layout).toBe("2026_V1");
    });

    it("returns UNSUPPORTED_LAYOUT when layout is UNKNOWN", () => {
      fixture = mountStudioFixture({ layout: "NONE" });
      const avail = studioModuleAvailability({
        hostname: "studio.youtube.com",
        href: fixture.href,
        document,
      });
      expect(avail.available).toBe(false);
      expect(avail.reason).toBe("UNSUPPORTED_LAYOUT");
    });

    it("returns WRONG_SITE off Studio", () => {
      const avail = studioModuleAvailability({
        hostname: "www.youtube.com",
        href: "https://www.youtube.com/",
      });
      expect(avail.available).toBe(false);
      expect(avail.reason).toBe("WRONG_SITE");
    });
  });
});

describe("P2 calibration — nav targets + dashboard", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  it("content nav hits variant A /videos/upload selector", () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      contentVariant: "A",
    });
    const target = navTargetFor("CONTENT");
    const el = resolveDomTarget(target, document);
    expect(el?.getAttribute("href")).toContain("/videos/upload");
  });

  it("content nav hits variant B /content selector", () => {
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      contentVariant: "B",
    });
    const target = navTargetFor("CONTENT");
    const el = resolveDomTarget(target, document);
    expect(el?.getAttribute("href")).toMatch(/\/content(\?|$)/);
  });

  it("dashboard exact href hits A and B without matching outbound home", () => {
    for (const variant of ["A", "B"] as const) {
      fixture?.destroy();
      fixture = mountStudioFixture({
        page: "CONTENT",
        contentVariant: variant,
      });
      const channelId = "UC_demo_channel";
      const target = dashboardNavTarget(channelId);
      const el = resolveDomTarget(target, document);
      expect(el).toBeTruthy();
      const href = el!.getAttribute("href")!;
      expect(href.startsWith("https://")).toBe(false);
      if (variant === "A") {
        expect(href).toBe(`/channel/${channelId}`);
      } else {
        expect(href).toBe(`/channel/${channelId}?theme=dark`);
      }
      const home = document.querySelector(
        `a[href="https://www.youtube.com/channel/${channelId}/"]`,
      );
      expect(home).toBeTruthy();
      expect(el).not.toBe(home);
    }
  });

  it("navigate(CONTENT) works on both variants", async () => {
    for (const variant of ["A", "B"] as const) {
      fixture?.destroy();
      fixture = mountStudioFixture({
        page: "DASHBOARD",
        layout: "2026_V1",
        contentVariant: variant,
        collector: false,
      });
      const local = fixture;
      const dom = createDomService();
      const nav = createNavigationService({
        dom,
        getHref: () => local.href,
        setHref: (href) => {
          const path = new URL(href, "https://studio.youtube.com").pathname;
          const next =
            path.includes("/analytics")
              ? "ANALYTICS"
              : path.includes("/videos") || path.includes("/content")
                ? "CONTENT"
                : path.includes("/translations")
                  ? "SUBTITLES"
                  : "DASHBOARD";
          local.setPage(next);
        },
        defaultTimeoutMs: 500,
      });
      await nav.navigate("CONTENT");
      await nav.waitReady("CONTENT");
      expect(nav.currentPage()).toBe("CONTENT");
    }
  });

  it("analytics nav uses tab-overview href pattern", () => {
    fixture = mountStudioFixture({ page: "DASHBOARD" });
    const el = resolveDomTarget(STUDIO_TARGETS["nav.analytics"], document);
    expect(el?.getAttribute("href")).toContain("/analytics/tab-overview");
  });
});
