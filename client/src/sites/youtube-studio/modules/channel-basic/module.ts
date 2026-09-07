/**
 * youtube.channel.basic module (FT-009 / SPEC §38).
 * Dom + Navigation injected at bootstrap (site wiring) — not recreated here.
 */

import type { Capability } from "../../../../runtime/capability.js";
import type {
  DetectContext,
  LuftballonsModule,
  TaskContext,
  TaskResult,
} from "../../../../runtime/types.js";
import type { CancellableDomService } from "../../../../services/dom-service.js";
import type { CancellableNavigationService } from "../../navigation.js";
import { studioModuleAvailability } from "../../page-detector.js";
import {
  runChannelBasicCollector,
  type ChannelBasicCollectorDeps,
} from "./collector.js";

const CHANNEL_CAPS: Capability[] = ["READ", "NAVIGATE", "LOCAL_EXPORT"];

export interface ChannelBasicModuleOptions {
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
  getHref?: () => string;
  /** Override document for layout detect (tests). */
  detectDocument?: Document;
  collectionId?: string;
  installationId?: string;
  collectorVersion?: number;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function createChannelBasicModule(
  options: ChannelBasicModuleOptions,
): LuftballonsModule {
  const getHref =
    options.getHref ??
    (() => (typeof location !== "undefined" ? location.href : ""));

  return {
    id: "youtube.channel.basic",
    name: "YouTube Basic Channel Collector",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: CHANNEL_CAPS,
    detect: async (ctx: DetectContext) =>
      studioModuleAvailability({
        hostname: ctx.hostname,
        href: ctx.href,
        ...(options.detectDocument !== undefined
          ? { document: options.detectDocument }
          : {}),
      }),
    run: async (ctx: TaskContext): Promise<TaskResult> => {
      try {
        const deps: ChannelBasicCollectorDeps = {
          dom: options.dom,
          navigation: options.navigation,
          getHref,
          ...(options.collectionId !== undefined
            ? { collectionId: options.collectionId }
            : {}),
          ...(options.installationId !== undefined
            ? { installationId: options.installationId }
            : {}),
          ...(options.collectorVersion !== undefined
            ? { collectorVersion: options.collectorVersion }
            : {}),
        };
        return await runChannelBasicCollector(ctx, deps);
      } catch (error) {
        if (ctx.signal.aborted || isAbortError(error)) {
          return { status: "CANCELLED", summary: "Cancelled by user" };
        }
        throw error;
      }
    },
  };
}
