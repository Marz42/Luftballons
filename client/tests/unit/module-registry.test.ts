import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
} from "../../src/runtime/errors.js";
import {
  createChannelBasicStub,
  createSubtitleMultilangStub,
} from "../../src/modules/youtube-studio-stubs.js";
import { createLogger } from "../../src/services/logger.js";

describe("ModuleRegistry", () => {
  it("registers and looks up modules by id", () => {
    const registry = new ModuleRegistry();
    const channel = createChannelBasicStub();
    registry.register(channel);
    expect(registry.get("youtube.channel.basic")?.id).toBe(
      "youtube.channel.basic",
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate registration", () => {
    const registry = new ModuleRegistry();
    registry.register(createChannelBasicStub());
    expect(() => registry.register(createChannelBasicStub())).toThrow(
      ModuleAlreadyRegisteredError,
    );
  });

  it("unregisters and require throws when missing", () => {
    const registry = new ModuleRegistry();
    registry.register(createChannelBasicStub());
    registry.unregister("youtube.channel.basic");
    expect(registry.get("youtube.channel.basic")).toBeUndefined();
    expect(() => registry.require("youtube.channel.basic")).toThrow(
      ModuleNotFoundError,
    );
  });

  it("aggregates availability: studio available, www WRONG_SITE", async () => {
    const registry = new ModuleRegistry();
    registry.register(createChannelBasicStub());
    registry.register(createSubtitleMultilangStub());
    const logger = createLogger({ minLevel: "ERROR", sink: () => {} });

    const studio = await registry.detectAll({
      hostname: "studio.youtube.com",
      href: "https://studio.youtube.com/",
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
});
