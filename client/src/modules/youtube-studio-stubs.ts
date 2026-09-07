import type { Capability } from "../runtime/capability.js";
import type {
  DetectContext,
  LuftballonsModule,
  ModuleAvailability,
  TaskContext,
  TaskResult,
} from "../runtime/types.js";
import type { Collection } from "../schemas/collection.js";
import type { ChannelBasicData } from "../schemas/channel-basic.js";
import { getOrCreateInstallation } from "../schemas/installation.js";
import {
  createMockChannelBasicData,
  LUFTBALLONS_SCHEMA_VERSION,
} from "../services/collection-service.js";
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

export interface ChannelBasicStubOptions extends StubModuleOptions {
  /** Injected / mock channel payload (simulates page read). */
  mockData?: ChannelBasicData;
  /** Collection completeness — drives TaskResult status. */
  collectionStatus?: "COMPLETE" | "PARTIAL";
  installationId?: string;
  collectionId?: string;
  collectorVersion?: number;
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

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function runSimulatedSteps(
  ctx: TaskContext,
  steps: string[],
  options: StubModuleOptions,
): Promise<"OK" | "CANCELLED"> {
  const wait = options.wait ?? immediateWait;
  const delay = options.stepDelayMs ?? 0;

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

const CHANNEL_CAPS: Capability[] = ["READ", "NAVIGATE", "LOCAL_EXPORT"];

export function createChannelBasicStub(
  options: ChannelBasicStubOptions = {},
): LuftballonsModule {
  return {
    id: "youtube.channel.basic",
    name: "YouTube Basic Channel Collector (stub)",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: CHANNEL_CAPS,
    detect: async (ctx) => detectStudioSite(ctx),
    run: async (ctx): Promise<TaskResult> => {
      try {
        const stepResult = await runSimulatedSteps(
          ctx,
          [
            "Detect Studio",
            "Verify channel",
            "Read channel summary (simulated)",
            "Read recent videos (simulated)",
            "Normalize (simulated)",
          ],
          options,
        );
        if (stepResult === "CANCELLED") {
          return { status: "CANCELLED", summary: "Cancelled by user" };
        }

        const installationId =
          options.installationId ??
          getOrCreateInstallation().installationId;
        const data = options.mockData ?? createMockChannelBasicData();
        const status = options.collectionStatus ?? "COMPLETE";
        const collection: Collection<ChannelBasicData> = {
          collectionId: options.collectionId ?? newId("col"),
          installationId,
          collector: "youtube.channel.basic",
          collectorVersion: options.collectorVersion ?? 1,
          schemaVersion: LUFTBALLONS_SCHEMA_VERSION,
          capturedAt: new Date().toISOString(),
          status,
          data,
        };

        await ctx.collections.save(collection);

        return {
          status: status === "PARTIAL" ? "PARTIAL" : "COMPLETED",
          summary: `Saved channel collection (${data.recentVideos.length} videos)`,
          collectionIds: [collection.collectionId],
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
