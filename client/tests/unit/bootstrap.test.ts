import { describe, expect, it } from "vitest";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import { createChannelBasicStub } from "../../src/modules/youtube-studio-stubs.js";
import { immediateWait } from "../../src/modules/step-control.js";

describe("bootstrap", () => {
  it("initializes runtime with bundled defaults and registered modules", async () => {
    const { runtime, panel } = await bootstrap({
      modules: [createChannelBasicStub({ wait: immediateWait })],
      mount: false,
    });
    expect(runtime.version).toBe("0.1.0");
    expect(runtime.config.networkMode).toBe("OFF");
    expect(runtime.registry.list()).toHaveLength(1);
    panel.destroy();
  });
});
