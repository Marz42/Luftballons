import { afterEach, describe, expect, it } from "vitest";
import {
  detectLayout,
  detectPageFromDom,
  detectPageFromUrl,
  detectStudio,
  mergePageSignals,
  studioModuleAvailability,
} from "../../src/sites/youtube-studio/page-detector.js";
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
    it("reads DOM page features from fixture", () => {
      fixture = mountStudioFixture({ page: "ANALYTICS" });
      expect(detectPageFromDom(document)).toBe("ANALYTICS");
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
    });
  });

  describe("layout signatures", () => {
    it("matches 2026_V1 fixture uniquely", () => {
      fixture = mountStudioFixture({ layout: "2026_V1" });
      const layout = detectLayout({
        href: fixture.href,
        pathname: new URL(fixture.href).pathname,
        document,
      });
      expect(layout).toBe("2026_V1");
    });

    it("matches 2026_V2 fixture uniquely", () => {
      fixture = mountStudioFixture({ layout: "2026_V2", page: "CONTENT" });
      expect(
        detectStudio({ href: fixture.href, document }).layout,
      ).toBe("2026_V2");
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

    it("returns UNKNOWN on conflicting layout markers", () => {
      fixture = mountConflictingLayoutFixture();
      expect(
        detectStudio({ href: fixture.href, document }).layout,
      ).toBe("UNKNOWN");
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
