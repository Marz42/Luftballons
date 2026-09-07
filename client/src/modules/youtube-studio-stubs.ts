import type { Capability } from "../runtime/capability.js";
import type {
  DetectContext,
  LuftballonsModule,
  ModuleAvailability,
  TaskContext,
  TaskResult,
} from "../runtime/types.js";
import {
  immediateWait,
  waitForAbortableStep,
} from "./step-control.js";

const STUDIO_HOST = "studio.youtube.com";

export interface StubModuleOptions {
  /** Injected wait; tests should pass immediateWait to avoid real sleeps. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  stepDelayMs?: number;
  onStep?: (step: string, ctx: TaskContext) => void;
}

function detectStudioSite(ctx: DetectContext): ModuleAvailability {
  if (ctx.hostname !== STUDIO_HOST) {
    return {
      available: false,
      reason: "WRONG_SITE",
      metadata: { hostname: ctx.hostname },
    };
  }
  return { available: true };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function runSimulatedSteps(
  ctx: TaskContext,
  steps: string[],
  options: StubModuleOptions,
): Promise<TaskResult> {
  const wait = options.wait ?? immediateWait;
  const delay = options.stepDelayMs ?? 0;

  try {
    for (const step of steps) {
      if (ctx.signal.aborted) {
        return { status: "CANCELLED", summary: "Cancelled by user" };
      }
      options.onStep?.(step, ctx);
      ctx.logger.info(step);
      await waitForAbortableStep(ctx.signal, delay, wait);
    }
    return {
      status: "COMPLETED",
      summary: "Simulated task completed",
    };
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) {
      return { status: "CANCELLED", summary: "Cancelled by user" };
    }
    throw error;
  }
}

const CHANNEL_CAPS: Capability[] = ["READ", "NAVIGATE", "LOCAL_EXPORT"];

export function createChannelBasicStub(
  options: StubModuleOptions = {},
): LuftballonsModule {
  return {
    id: "youtube.channel.basic",
    name: "YouTube Basic Channel Collector (stub)",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: CHANNEL_CAPS,
    detect: async (ctx) => detectStudioSite(ctx),
    run: async (ctx) =>
      runSimulatedSteps(
        ctx,
        [
          "Detect Studio",
          "Verify channel",
          "Read channel summary (simulated)",
          "Read recent videos (simulated)",
          "Normalize (simulated)",
        ],
        options,
      ),
  };
}

const SUBTITLE_CAPS: Capability[] = [
  "READ",
  "NAVIGATE",
  "WRITE_REVERSIBLE",
  "WRITE_COMMIT",
];

export function createSubtitleMultilangStub(
  options: StubModuleOptions = {},
): LuftballonsModule {
  return {
    id: "youtube.subtitle.multilang",
    name: "YouTube Multilingual Subtitle (stub)",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: SUBTITLE_CAPS,
    detect: async (ctx) => detectStudioSite(ctx),
    run: async (ctx) =>
      runSimulatedSteps(
        ctx,
        [
          "Detect current video (simulated)",
          "Open subtitles (simulated)",
          "Check existing languages (simulated)",
          "Prepare languages (simulated)",
        ],
        options,
      ),
  };
}
