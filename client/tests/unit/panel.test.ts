import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import {
  createChannelBasicStub,
  createSubtitleMultilangStub,
} from "../../src/modules/youtube-studio-stubs.js";
import type { PanelHandle } from "../../src/ui/panel.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";

describe("Luftballons panel UI", () => {
  let panel: PanelHandle | undefined;
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    panel?.destroy();
    panel = undefined;
    fixture?.destroy();
    fixture = undefined;
    document.documentElement
      .querySelectorAll("[data-luftballons-root]")
      .forEach((el) => el.remove());
    document.body.replaceChildren();
  });

  it("injects floating control without innerHTML and lists modules", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });

    const result = await bootstrap({
      modules: [createChannelBasicStub(), createSubtitleMultilangStub()],
    });
    panel = result.panel;

    const host = document.documentElement.querySelector(
      "[data-luftballons-root]",
    );
    expect(host).toBeTruthy();
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.innerHTML.includes("<script")).toBe(false);

    const toggle = shadow?.querySelector(".lb-toggle");
    expect(toggle?.textContent).toContain("Luftballons");

    panel.open();
    const meta = [...(shadow?.querySelectorAll(".lb-module-meta") ?? [])].map(
      (el) => el.textContent ?? "",
    );
    expect(meta.some((t) => t.includes("available"))).toBe(true);
    expect(meta.some((t) => t.includes("youtube.channel.basic"))).toBe(true);
  });

  it("shows unavailable on www.youtube.com", async () => {
    Object.defineProperty(window, "location", {
      value: {
        hostname: "www.youtube.com",
        href: "https://www.youtube.com/",
      },
      writable: true,
      configurable: true,
    });

    const result = await bootstrap({
      modules: [createChannelBasicStub()],
    });
    panel = result.panel;
    panel.open();

    const host = document.documentElement.querySelector(
      "[data-luftballons-root]",
    );
    const meta = host?.shadowRoot?.querySelector(".lb-module-meta");
    expect(meta?.textContent).toContain("WRONG_SITE");
  });

  it("shows UNSUPPORTED_LAYOUT when Studio shell is unknown", async () => {
    fixture = mountStudioFixture({ layout: "NONE" });

    const result = await bootstrap({
      modules: [createChannelBasicStub()],
    });
    panel = result.panel;
    panel.open();

    const host = document.documentElement.querySelector(
      "[data-luftballons-root]",
    );
    const meta = host?.shadowRoot?.querySelector(".lb-module-meta");
    expect(meta?.textContent).toContain("UNSUPPORTED_LAYOUT");
  });
});
