import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import {
  ModuleUnavailableError,
  TaskBusyError,
} from "../../src/runtime/errors.js";
import { createLogger } from "../../src/services/logger.js";
import type { LuftballonsModule, TaskContext } from "../../src/runtime/types.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";
import {
  createAutoApproveGate,
  createFixtureSubtitleModule,
} from "./subtitle-multilang-test-utils.js";
import { studioModuleAvailability } from "../../src/sites/youtube-studio/page-detector.js";


function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

/** Lightweight stand-in when tests need controllable run() without DOM collection. */
function fakeChannelModule(
  run: LuftballonsModule["run"],
  detectDocument?: Document,
): LuftballonsModule {
  return {
    id: "youtube.channel.basic",
    name: "YouTube Basic Channel Collector",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: ["READ", "NAVIGATE", "LOCAL_EXPORT"],
    detect: async (ctx) =>
      studioModuleAvailability({
        hostname: ctx.hostname,
        href: ctx.href,
        ...(detectDocument !== undefined ? { document: detectDocument } : {}),
      }),
    run,
  };
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
    const { runner } = (() => {
      const module = createFixtureChannelModule(fixture!);
      const registry = new ModuleRegistry();
      registry.register(module);
      return {
        runner: new TaskRunner({
          registry,
          logger: silentLogger(),
          getLocation: () => ({
            hostname: "studio.youtube.com",
            href: fixture!.href,
          }),
        }),
      };
    })();

    const states: string[] = [];
    runner.subscribe((s) => states.push(s.state));

    const taskId = await runner.start("youtube.channel.basic");
    expect(runner.getState(taskId)).toBe("RUNNING");

    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });

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

    const blocking = fakeChannelModule(async (ctx: TaskContext) => {
      await gate;
      if (ctx.signal.aborted) {
        return { status: "CANCELLED", summary: "Cancelled" };
      }
      return { status: "COMPLETED", summary: "done" };
    }, document);

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

  it("rejects concurrent start during detect with TaskBusyError; only one run()", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    let releaseDetect!: () => void;
    const detectGate = new Promise<void>((resolve) => {
      releaseDetect = resolve;
    });
    let detectEntered = 0;
    const runCalls: string[] = [];

    const module: LuftballonsModule = {
      id: "youtube.channel.basic",
      name: "YouTube Basic Channel Collector",
      version: "0.1.0",
      site: "youtube-studio",
      capabilities: ["READ", "NAVIGATE", "LOCAL_EXPORT"],
      detect: async (ctx) => {
        detectEntered += 1;
        await detectGate;
        return studioModuleAvailability({
          hostname: ctx.hostname,
          href: ctx.href,
          document,
        });
      },
      run: async () => {
        runCalls.push("run");
        return { status: "COMPLETED", summary: "done" };
      },
    };

    const runner = makeRunner(module);
    const firstStart = runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(detectEntered).toBe(1);
    });

    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      TaskBusyError,
    );

    releaseDetect();
    await expect(firstStart).resolves.toMatch(/^task-/);
    await vi.waitFor(() => {
      expect(runCalls).toEqual(["run"]);
    });
    expect(detectEntered).toBe(1);
  });

  it("keeps execution lock after cancel until run settles", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });

    const module = fakeChannelModule(async (ctx: TaskContext) => {
      await runGate;
      if (ctx.signal.aborted) {
        return { status: "CANCELLED", summary: "Cancelled" };
      }
      return { status: "COMPLETED", summary: "done" };
    }, document);

    const runner = makeRunner(module);
    const taskA = await runner.start("youtube.channel.basic");
    await runner.cancel(taskA);
    expect(runner.getState(taskA)).toBe("CANCELLED");
    expect(runner.getActiveTaskId()).toBe(taskA);

    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      TaskBusyError,
    );

    releaseRun();
    await vi.waitFor(() => {
      expect(runner.getActiveTaskId()).toBeNull();
    });

    const taskB = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskB)).toBe("COMPLETED");
    });
  });

  it("cancel aborts signal and ends CANCELLED without further steps", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const seen: string[] = [];
    let proceed!: () => void;
    const firstStep = new Promise<void>((resolve) => {
      proceed = resolve;
    });

    const module = fakeChannelModule(async (ctx) => {
      seen.push("step-1");
      await firstStep;
      if (ctx.signal.aborted) {
        seen.push("noticed-abort");
        return { status: "CANCELLED", summary: "Cancelled by user" };
      }
      seen.push("step-2-should-not-run");
      return { status: "COMPLETED", summary: "done" };
    }, document);

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
    const module = fakeChannelModule(async (ctx) => {
      signalRef = ctx.signal;
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
      return { status: "COMPLETED", summary: "unreachable" };
    }, document);

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
    const runner = makeRunner(
      fakeChannelModule(async () => ({
        status: "COMPLETED",
        summary: "nope",
      })),
      "www.youtube.com",
    );
    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      ModuleUnavailableError,
    );
  });

  it("refuses modules when layout is UNKNOWN", async () => {
    fixture = mountStudioFixture({ layout: "NONE" });
    const runner = makeRunner(
      createFixtureChannelModule(fixture),
    );
    await expect(runner.start("youtube.channel.basic")).rejects.toBeInstanceOf(
      ModuleUnavailableError,
    );
  });

  it("transitions to FAILED when run throws", async () => {
    fixture = mountStudioFixture({ layout: "2026_V1" });
    const module = fakeChannelModule(async () => {
      throw new Error("boom");
    }, document);
    const runner = makeRunner(module);
    const taskId = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });
  });

  it("subtitle.multilang registers and completes with Human Gate approval", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        pickerLanguages: [{ code: "en", label: "English" }],
      },
    });
    const registry = new ModuleRegistry();
    registry.register(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "en", label: "English" }],
      }),
    );
    const subRunner = new TaskRunner({
      registry,
      logger: silentLogger(),
      humanGate: createAutoApproveGate(),
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });
    const taskId = await subRunner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(subRunner.getState(taskId)).toBe("COMPLETED");
    });
  });
});
