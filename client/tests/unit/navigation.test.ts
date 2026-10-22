import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomService } from "../../src/services/dom-service.js";
import {
  createNavigationService,
  NavigationError,
  pagePostcondition,
} from "../../src/sites/youtube-studio/navigation.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";

describe("NavigationService (FT-008)", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  function makeNav() {
    const dom = createDomService();
    return createNavigationService({
      dom,
      getHref: () => fixture?.href ?? location.href,
      setHref: (href) => {
        // Fixture click handler already updates; setHref keeps detector in sync
        // when tests drive navigate without relying solely on click side effects.
        const u = new URL(href, "https://studio.youtube.com");
        const path = u.pathname;
        const page =
          path.includes("/analytics")
            ? "ANALYTICS"
            : path.includes("/videos") || path.includes("/content")
              ? "CONTENT"
              : path.includes("/translations")
                ? "SUBTITLES"
                : path.includes("/edit")
                  ? "VIDEO_DETAILS"
                  : "DASHBOARD";
        fixture?.setPage(page);
      },
      defaultTimeoutMs: 500,
    });
  }

  it("navigates Dashboard → Analytics → Content with waitReady", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const nav = makeNav();

    expect(nav.currentPage()).toBe("DASHBOARD");

    await nav.navigate("ANALYTICS");
    await nav.waitReady("ANALYTICS");
    expect(nav.currentPage()).toBe("ANALYTICS");

    await nav.navigate("CONTENT");
    await nav.waitReady("CONTENT");
    expect(nav.currentPage()).toBe("CONTENT");
  });

  it("waitReady times out when page never ready", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const nav = makeNav();
    await expect(nav.waitReady("ANALYTICS", 50)).rejects.toBeInstanceOf(
      NavigationError,
    );
  });

  it("refuses navigate when layout is UNKNOWN", async () => {
    fixture = mountStudioFixture({ layout: "NONE", page: "DASHBOARD" });
    const nav = makeNav();
    await expect(nav.navigate("ANALYTICS")).rejects.toMatchObject({
      code: "UNSUPPORTED_LAYOUT",
    });
  });

  it("cancel aborts mid-navigation so next step does not run (P2-T4)", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const nav = makeNav();
    const ac = new AbortController();

    await nav.navigate("ANALYTICS", ac.signal);
    await nav.waitReady("ANALYTICS", 500, ac.signal);

    ac.abort();
    let nextRan = false;
    await expect(
      (async () => {
        await nav.navigate("CONTENT", ac.signal);
        nextRan = true;
        await nav.waitReady("CONTENT", 500, ac.signal);
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(nextRan).toBe(false);
    expect(nav.currentPage()).toBe("ANALYTICS");
  });

  it("back() returns to previous page via stack", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const nav = makeNav();
    await nav.navigate("ANALYTICS");
    await nav.waitReady("ANALYTICS");
    await nav.back();
    await nav.waitReady("DASHBOARD");
    expect(nav.currentPage()).toBe("DASHBOARD");
  });

  it("pagePostcondition requires URL and DOM agreement (not URL-only)", () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    // URL advanced to CONTENT while DOM remains DASHBOARD.
    fixture.setHref("https://studio.youtube.com/channel/UC_demo_channel/videos");
    expect(
      pagePostcondition("CONTENT", {
        href: fixture.href,
        document,
      }),
    ).toBe(false);
    expect(
      pagePostcondition("DASHBOARD", {
        href: fixture.href,
        document,
      }),
    ).toBe(false);
  });

  it("navigate without setHref does not forge success via pushState", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const pushSpy = vi.spyOn(history, "pushState");
    const dom = createDomService();
    // Click is a no-op for SPA state; no setHref → must not pushState to fake nav.
    const nav = createNavigationService({
      dom: {
        ...dom,
        click: async () => {
          /* intentionally no URL/DOM update */
        },
      },
      getHref: () => fixture!.href,
      defaultTimeoutMs: 80,
    });

    await nav.navigate("CONTENT");
    expect(pushSpy).not.toHaveBeenCalled();
    await expect(nav.waitReady("CONTENT", 80)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    pushSpy.mockRestore();
  });

  function withHiddenDocument<T>(fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    return fn().finally(() => {
      if (original) {
        Object.defineProperty(document, "hidden", original);
      } else {
        delete (document as { hidden?: boolean }).hidden;
      }
    });
  }

  it("refuses to navigate while the tab is hidden (live 2026-10-22: throttled SPA activation)", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", layout: "2026_V1" });
    const nav = makeNav();
    await withHiddenDocument(async () => {
      await expect(nav.navigate("SUBTITLES")).rejects.toMatchObject({
        code: "WINDOW_HIDDEN",
      });
    });
    // Fail fast BEFORE clicking: no half-navigated URL left behind.
    expect(nav.currentPage()).toBe("VIDEO_DETAILS");
  });

  it("waitReady timeout names the hidden window as the cause (live 2026-10-22)", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const nav = makeNav();
    await withHiddenDocument(async () => {
      await expect(nav.waitReady("SUBTITLES", 80)).rejects.toThrow(
        /foreground/,
      );
    });
  });
});
