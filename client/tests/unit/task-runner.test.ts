import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import {
  ModuleUnavailableError,
  TaskBusyError,
} from "../../src/runtime/errors.js";
import { createChannelBasicStub } from "../../src/modules/youtube-studio-stubs.js";
import { createLogger } from "../../src/services/logger.js";
import type { LuftballonsModule, TaskContext } from "../../src/runtime/types.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

function makeRunner(module: LuftballonsModule, hostname = "studio.youtube.com") {
  const registry = new ModuleRegistry();
  registry.register(module);
  return new TaskRunner({
    registry,
    logger: silentLogger(),
    createTaskId: (() => {
      let n = 0;
      return () => `task-${++n}`;
    })(),
    getLocation: () => ({
      hostname,
      href:
        hostname === "studio.youtube.com"
          ? "https://studio.youtube.com/channel/UC_demo_channel"
          : `https://${hostname}/`,
    }),
  });
}

describe("TaskRunner", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  it("transitions IDLE→RUNNING→COMPLETED", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const steps: string[] = [];
    const runner = makeRunner(
      createChannelBasicStub({
        wait: async () => {},
        onStep: (step) => steps.push(step),
      }),
    );

    const states: string[] = [];
    runner.subscribe((s) => states.push(s.state));

    const taskId = await runner.start("youtube.channel.basic");
    expect(runner.getState(taskId)).toBe("RUNNING");

    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });

    expect(steps.length).toBeGreaterThan(0);
    expect(states).toContain("RUNNING");
    expect(states.at(-1)).toBe("COMPLETED");
    expect(runner.getActiveTaskId()).toBeNull();
  });

  it("enforces one-task rule with TaskBusyError", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const blocking: LuftballonsModule = {
      ...createChannelBasicStub(),
      run: async (ctx: TaskContext) => {
        await gate;
        if (ctx.signal.aborted) {
          return { status: "CANCELLED", summary: "Cancelled" };
        }
        return { status: "COMPLETED", summary: "done" };
      },
    };

    const runner = makeRunner(blocking);
    const first = await runner.start("youtube.channel.basic");
    expect(runner.getState(first)).toBe("RUNNING");

    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      TaskBusyError,
    );

    release();
    await vi.waitFor(() => {
      expect(runner.getState(first)).toBe("COMPLETED");
    });

    const second = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(second)).toBe("COMPLETED");
    });
  });

  it("cancel aborts signal and ends CANCELLED without further steps", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const seen: string[] = [];
    let proceed!: () => void;
    const firstStep = new Promise<void>((resolve) => {
      proceed = resolve;
    });

    const module: LuftballonsModule = {
      ...createChannelBasicStub(),
      run: async (ctx) => {
        seen.push("step-1");
        await firstStep;
        if (ctx.signal.aborted) {
          seen.push("noticed-abort");
          return { status: "CANCELLED", summary: "Cancelled by user" };
        }
        seen.push("step-2-should-not-run");
        return { status: "COMPLETED", summary: "done" };
      },
    };

    const runner = makeRunner(module);
    const taskId = await runner.start("youtube.channel.basic");

    await vi.waitFor(() => {
      expect(seen).toContain("step-1");
    });

    await runner.cancel(taskId);
    expect(runner.getState(taskId)).toBe("CANCELLED");

    proceed();
    await vi.waitFor(() => {
      expect(seen).toContain("noticed-abort");
    });
    expect(seen).not.toContain("step-2-should-not-run");
    expect(runner.getSnapshot(taskId).result?.status).toBe("CANCELLED");
  });

  it("maps module abort wait to CANCELLED via AbortSignal", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    let signalRef: AbortSignal | undefined;
    const module = createChannelBasicStub({
      wait: (_ms, signal) => {
        signalRef = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
      stepDelayMs: 1,
    });

    const runner = makeRunner(module);
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(signalRef).toBeDefined();
    });

    await runner.cancel(taskId);
    expect(signalRef?.aborted).toBe(true);
    expect(runner.getState(taskId)).toBe("CANCELLED");
  });

  it("refuses unavailable modules on wrong site", async () => {
    const runner = makeRunner(createChannelBasicStub(), "www.youtube.com");
    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      ModuleUnavailableError,
    );
  });

  it("refuses modules when layout is UNKNOWN", async () => {
    fixture = mountStudioFixture({ layout: "NONE" });
    const runner = makeRunner(createChannelBasicStub());
    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      ModuleUnavailableError,
    );
  });

  it("transitions to FAILED when run throws", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const module: LuftballonsModule = {
      ...createChannelBasicStub(),
      run: async () => {
        throw new Error("boom");
      },
    };
    const runner = makeRunner(module);
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });
  });
});
