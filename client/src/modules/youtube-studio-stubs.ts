import type { Capability } from "../runtime/capability.js";
import type {
  DetectContext,
  LuftballonsModule,
  ModuleAvailability,
  TaskContext,
  TaskResult,
} from "../runtime/types.js";
import {
  abortableDelay,
  waitForAbortableStep,
} from "./step-control.js";
import { studioModuleAvailability } from "../sites/youtube-studio/page-detector.js";

/** Default per-step delay for real-device demos (~5 steps ≈ 3s). */
export const DEFAULT_STUB_STEP_DELAY_MS = 600;

export interface StubModuleOptions {
  /** Injected wait; tests must pass immediateWait (or async () => {}) to avoid real sleeps. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Per-step delay; default 600ms for visible RUNNING / Cancel on device. */
  stepDelayMs?: number;
  onStep?: (step: string, ctx: TaskContext) => void;
  /** Override document for layout detect (tests). Defaults to global document. */
  detectDocument?: Document;
}

function detectStudioSite(
  ctx: DetectContext,
  detectDocument?: Document,
): ModuleAvailability {
  return studioModuleAvailability({
    hostname: ctx.hostname,
    href: ctx.href,
    ...(detectDocument !== undefined ? { document: detectDocument } : {}),
  });
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
): Promise<"OK" | "CANCELLED"> {
  const wait = options.wait ?? abortableDelay;
  const delay = options.stepDelayMs ?? DEFAULT_STUB_STEP_DELAY_MS;

  for (const step of steps) {
    if (ctx.signal.aborted) {
      return "CANCELLED";
    }
    options.onStep?.(step, ctx);
    ctx.logger.info(step);
    await waitForAbortableStep(ctx.signal, delay, wait);
  }
  return "OK";
}

const SUBTITLE_CAPS: Capability[] = [
  "READ",
  "NAVIGATE",
  "WRITE_REVERSIBLE",
  "WRITE_COMMIT",
];

/** Phase 4 placeholder — channel.basic stub removed in Phase 3 (FT-009). */
export function createSubtitleMultilangStub(
  options: StubModuleOptions = {},
): LuftballonsModule {
  return {
    id: "youtube.subtitle.multilang",
    name: "YouTube Multilingual Subtitle (stub)",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: SUBTITLE_CAPS,
    detect: async (ctx) => detectStudioSite(ctx, options.detectDocument),
    run: async (ctx) => {
      try {
        const stepResult = await runSimulatedSteps(
          ctx,
          [
            "Detect current video (simulated)",
            "Open subtitles (simulated)",
            "Check existing languages (simulated)",
            "Prepare languages (simulated)",
          ],
          options,
        );
        if (stepResult === "CANCELLED") {
          return { status: "CANCELLED", summary: "Cancelled by user" };
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
    },
  };
}
