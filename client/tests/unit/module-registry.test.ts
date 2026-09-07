import { afterEach, describe, expect, it } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
} from "../../src/runtime/errors.js";
import { createSubtitleMultilangStub } from "../../src/modules/youtube-studio-stubs.js";
import { immediateWait } from "../../src/modules/step-control.js";
import { createLogger } from "../../src/services/logger.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";

const fastSubtitleStub = () =>
  createSubtitleMultilangStub({ wait: immediateWait });

describe("ModuleRegistry", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  it("registers and looks up modules by id", () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const registry = new ModuleRegistry();
    const channel = createFixtureChannelModule(fixture);
    registry.register(channel);
    expect(registry.get("youtube.channel.basic")?.id).toBe(
      "youtube.channel.basic",
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate registration", () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture));
    expect(() =>
      registry.register(createFixtureChannelModule(fixture!)),
    ).toThrow(ModuleAlreadyRegisteredError);
  });

  it("unregisters and require throws when missing", () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture));
    registry.unregister("youtube.channel.basic");
    expect(registry.get("youtube.channel.basic")).toBeUndefined();
    expect(() => registry.require("youtube.channel.basic")).toThrow(
      ModuleNotFoundError,
    );
  });

  it("aggregates availability: studio available, www WRONG_SITE", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture));
    registry.register(fastSubtitleStub());
    const logger = createLogger({ minLevel: "ERROR", sink: () => {} });

    const studio = await registry.detectAll({
      hostname: "studio.youtube.com",
      href: fixture.href,
      logger,
    });
    expect(studio.every((e) => e.availability.available)).toBe(true);

    const www = await registry.detectAll({
      hostname: "www.youtube.com",
      href: "https://www.youtube.com/",
      logger,
    });
    expect(www).toHaveLength(2);
    for (const entry of www) {
      expect(entry.availability.available).toBe(false);
      expect(entry.availability.reason).toBe("WRONG_SITE");
    }
  });

  it("marks studio modules unavailable on UNKNOWN layout", async () => {
    fixture = mountStudioFixture({ layout: "NONE" });
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture));
    const logger = createLogger({ minLevel: "ERROR", sink: () => {} });
    const entries = await registry.detectAll({
      hostname: "studio.youtube.com",
      href: fixture.href,
      logger,
    });
    expect(entries[0]?.availability.available).toBe(false);
    expect(entries[0]?.availability.reason).toBe("UNSUPPORTED_LAYOUT");
  });
});
