import { afterEach, describe, expect, it } from "vitest";
import { createDomService } from "../../src/services/dom-service.js";
import {
  createNavigationService,
  NavigationError,
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
        const page =
          href.includes("/analytics")
            ? "ANALYTICS"
            : href.includes("/videos")
              ? "CONTENT"
              : href.includes("/translations")
                ? "SUBTITLES"
                : href.includes("/edit")
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
});
