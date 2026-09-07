import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelHumanGate } from "../../src/ui/human-gate.js";
import { bootstrap } from "../../src/bootstrap/bootstrap.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureSubtitleModule } from "./subtitle-multilang-test-utils.js";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("Human Gate UI (FT-012)", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.documentElement
      .querySelectorAll("[data-luftballons-root]")
      .forEach((el) => el.remove());
    document.body.replaceChildren();
  });

  it("shows modal with consequences; confirm → APPROVED", async () => {
    const gate = createPanelHumanGate();
    const host = document.createElement("div");
    document.body.append(host);
    gate.attach(host);

    const pending = gate.request({
      capability: "WRITE_COMMIT",
      title: "Publish subtitle languages",
      description: "About to publish",
      consequences: ["English (en)", "不可撤销 / irreversible WRITE_COMMIT"],
      reversible: false,
    });

    expect(gate.isOpen()).toBe(true);
    const overlay = host.querySelector("[data-luftballons-human-gate]");
    expect(overlay?.textContent).toContain("Publish subtitle languages");
    expect(overlay?.textContent).toContain("English (en)");
    expect(overlay?.textContent).toMatch(/不可撤销/);

    const confirm = host.querySelector(".lb-gate-confirm") as HTMLButtonElement;
    confirm.click();
    await expect(pending).resolves.toBe("APPROVED");
    expect(gate.isOpen()).toBe(false);
  });

  it("cancel → REJECTED; abort closes modal as REJECTED", async () => {
    const gate = createPanelHumanGate();
    const host = document.createElement("div");
    document.body.append(host);
    gate.attach(host);

    const controller = new AbortController();
    const pending = gate.request(
      {
        capability: "WRITE_COMMIT",
        title: "Publish",
        description: "desc",
        consequences: ["x"],
        reversible: false,
      },
      controller.signal,
    );
    expect(gate.isOpen()).toBe(true);
    controller.abort();
    await expect(pending).resolves.toBe("REJECTED");
    expect(gate.isOpen()).toBe(false);
  });

  it("no default approval when unattached", async () => {
    const gate = createPanelHumanGate();
    const decision = await gate.request({
      capability: "WRITE_COMMIT",
      title: "t",
      description: "d",
      consequences: [],
      reversible: false,
    });
    expect(decision).toBe("REJECTED");
  });

  it("task cancel while WAITING_HUMAN closes gate (integration)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const gate = createPanelHumanGate();
    const host = document.createElement("div");
    document.body.append(host);
    gate.attach(host);

    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const registry = new ModuleRegistry();
    registry.register(mod);
    const runner = new TaskRunner({
      registry,
      logger: silentLogger(),
      humanGate: gate,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("WAITING_HUMAN");
    });
    expect(gate.isOpen()).toBe(true);

    await runner.cancel(taskId);
    await vi.waitFor(() => {
      expect(gate.isOpen()).toBe(false);
    });
    expect(runner.getState(taskId)).toBe("CANCELLED");
  });

  it("bootstrap wires PanelHumanGate into TaskRunner", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", layout: "2026_V1" });
    const { runtime, panel, humanGate } = await bootstrap({
      modules: [createFixtureSubtitleModule(fixture)],
      mount: true,
    });
    expect(humanGate).toBeDefined();
    expect(typeof (humanGate as { attach?: unknown }).attach).toBe("function");
    panel.destroy();
    void runtime;
  });
});
