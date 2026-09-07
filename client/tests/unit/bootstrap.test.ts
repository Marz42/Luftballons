import { describe, expect, it } from "vitest";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import { createSubtitleMultilangStub } from "../../src/modules/youtube-studio-stubs.js";
import { immediateWait } from "../../src/modules/step-control.js";

describe("bootstrap", () => {
  it("initializes runtime with bundled defaults and registered modules", async () => {
    const { runtime, panel } = await bootstrap({
      modules: [createSubtitleMultilangStub({ wait: immediateWait })],
      mount: false,
    });
    expect(runtime.version).toBe("0.1.0");
    expect(runtime.config.networkMode).toBe("OFF");
    expect(runtime.registry.list()).toHaveLength(1);
    panel.destroy();
  });

  it("default modules include real channel.basic + subtitle stub", async () => {
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
    panel.destroy();
  });
});
