import { describe, expect, it } from "vitest";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";
import { createFixtureSubtitleModule } from "./subtitle-multilang-test-utils.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { afterEach } from "vitest";

describe("bootstrap", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  it("initializes runtime with bundled defaults and registered modules", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", layout: "2026_V1" });
    const { runtime, panel } = await bootstrap({
      modules: [createFixtureSubtitleModule(fixture)],
      mount: false,
    });
    expect(runtime.version).toBe("0.1.0");
    expect(runtime.config.networkMode).toBe("MANUAL");
    expect(runtime.network).toBeDefined();
    expect(runtime.remoteSink?.id).toBe("remote");
    expect(runtime.remoteSink?.capability).toBe("NETWORK_SEND");
    expect(runtime.registry.list()).toHaveLength(1);
    panel.destroy();
  });

  it("default modules include real channel.basic + subtitle.multilang", async () => {
    const { runtime, panel, studioAdapter } = await bootstrap({
      mount: false,
    });
    expect(studioAdapter).toBeDefined();
    const ids = runtime.registry.list().map((m) => m.id);
    expect(ids).toContain("youtube.channel.basic");
    expect(ids).toContain("youtube.subtitle.multilang");
    expect(
      runtime.registry.get("youtube.channel.basic")?.name,
    ).not.toMatch(/stub/i);
    expect(
      runtime.registry.get("youtube.subtitle.multilang")?.name,
    ).not.toMatch(/stub/i);
    panel.destroy();
  });
});
