/**
 * youtube.subtitle.multilang Action module (FT-011 / SPEC §34).
 * Dom + Navigation injected at bootstrap (site wiring).
 */

import type { Capability } from "../../../../runtime/capability.js";
import type {
  DetectContext,
  LuftballonsModule,
  ModuleAvailability,
  TaskContext,
  TaskResult,
} from "../../../../runtime/types.js";
import type { CancellableDomService } from "../../../../services/dom-service.js";
import type { CancellableNavigationService } from "../../navigation.js";
import {
  detectStudio,
  studioModuleAvailability,
} from "../../page-detector.js";
import {
  PRESET_SUBTITLE_LANGUAGES,
  type SubtitleLanguage,
} from "./schema.js";
import {
  runSubtitleMultilangWorkflow,
  type SubtitleWorkflowDeps,
} from "./workflow.js";

const SUBTITLE_CAPS: Capability[] = [
  "READ",
  "NAVIGATE",
  "WRITE_REVERSIBLE",
  "WRITE_COMMIT",
];

export interface SubtitleMultilangControls {
  setTargetLanguages(languages: SubtitleLanguage[]): void;
  getTargetLanguages(): SubtitleLanguage[];
}

export type SubtitleMultilangModule = LuftballonsModule &
  SubtitleMultilangControls;

export interface SubtitleMultilangModuleOptions {
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
  getHref?: () => string;
  /** Override document for layout / page detect (tests). */
  detectDocument?: Document;
  /** Initial target languages (defaults to en + ja). */
  initialLanguages?: SubtitleLanguage[];
  onPublishAttempt?: () => void;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isSubtitleControls(
  module: LuftballonsModule,
): module is SubtitleMultilangModule {
  return (
    module.id === "youtube.subtitle.multilang" &&
    typeof (module as SubtitleMultilangModule).setTargetLanguages ===
      "function"
  );
}

export { isSubtitleControls };

export function createSubtitleMultilangModule(
  options: SubtitleMultilangModuleOptions,
): SubtitleMultilangModule {
  const getHref =
    options.getHref ??
    (() => (typeof location !== "undefined" ? location.href : ""));

  let targetLanguages: SubtitleLanguage[] =
    options.initialLanguages ??
    PRESET_SUBTITLE_LANGUAGES.filter((l) => l.code === "en" || l.code === "ja");

  return {
    id: "youtube.subtitle.multilang",
    name: "YouTube Multilingual Subtitle",
    version: "0.1.0",
    site: "youtube-studio",
    capabilities: SUBTITLE_CAPS,

    setTargetLanguages(languages: SubtitleLanguage[]): void {
      targetLanguages = languages.map((l) => ({
        code: l.code.trim(),
        label: l.label.trim() || l.code.trim(),
      }));
    },

    getTargetLanguages(): SubtitleLanguage[] {
      return targetLanguages.map((l) => ({ ...l }));
    },

    detect: async (ctx: DetectContext): Promise<ModuleAvailability> => {
      const base = studioModuleAvailability({
        hostname: ctx.hostname,
        href: ctx.href,
        ...(options.detectDocument !== undefined
          ? { document: options.detectDocument }
          : {}),
      });
      if (!base.available) {
        return base;
      }

      // Phase 4 boundary: one task = current explicitly chosen video only.
      const detection = detectStudio({
        href: ctx.href,
        ...(options.detectDocument !== undefined
          ? { document: options.detectDocument }
          : {}),
      });
      if (detection.page !== "VIDEO_DETAILS") {
        return {
          available: false,
          reason: "WRONG_PAGE",
          metadata: {
            ...(base.metadata ?? {}),
            page: detection.page,
            requiredPage: "VIDEO_DETAILS",
            urlPage: detection.urlPage,
            domPage: detection.domPage,
          },
        };
      }

      return {
        available: true,
        metadata: {
          ...(base.metadata ?? {}),
          page: detection.page,
        },
      };
    },

    run: async (ctx: TaskContext): Promise<TaskResult> => {
      try {
        const deps: SubtitleWorkflowDeps = {
          dom: options.dom,
          navigation: options.navigation,
          getHref,
          getTargetLanguages: () => targetLanguages,
          ...(options.onPublishAttempt !== undefined
            ? { onPublishAttempt: options.onPublishAttempt }
            : {}),
        };
        return await runSubtitleMultilangWorkflow(ctx, deps);
      } catch (error) {
        if (ctx.signal.aborted || isAbortError(error)) {
          return { status: "CANCELLED", summary: "Cancelled by user" };
        }
        throw error;
      }
    },
  };
}
