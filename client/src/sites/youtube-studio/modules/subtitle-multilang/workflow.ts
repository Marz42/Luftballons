/**
 * youtube.subtitle.multilang workflow (IMPLEMENTATION §47, SPEC §35–§37).
 * Fail-closed: unknown DOM → stop; no speculative clicks; no fixed sleep.
 */

import type {
  TaskContext,
  TaskResult,
  TaskWarning,
} from "../../../../runtime/types.js";
import type { CancellableDomService } from "../../../../services/dom-service.js";
import type { DomTarget } from "../../../../services/dom-service.js";
import type { CancellableNavigationService } from "../../navigation.js";
import { NavigationError } from "../../navigation.js";
import { detectStudio } from "../../page-detector.js";
import {
  extractVideoIdFromHref,
  getSubtitleTarget,
  SUBTITLE_TARGETS,
} from "../../selectors.js";
import {
  formatOutcomesSummary,
  type LanguageOutcome,
  type SubtitleLanguage,
  type SubtitleMultilangSummary,
} from "./schema.js";

export { extractVideoIdFromHref };

export interface SubtitleWorkflowDeps {
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
  getHref: () => string;
  /** Document used for page detection rechecks (defaults to global document). */
  detectDocument?: Document;
  /** Target languages chosen by the user for this run. */
  getTargetLanguages: () => SubtitleLanguage[];
  /**
   * Optional: observe publish clicks (tests assert no commit on reject).
   * Production leaves undefined.
   */
  onPublishAttempt?: () => void;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/**
 * Re-verify site + video identity + SUBTITLES page before any write.
 * Fail-closed: any mismatch → stop (no clicks).
 */
export function recheckVideoBinding(
  deps: SubtitleWorkflowDeps,
  expectedVideoId: string,
): { ok: true } | { ok: false; code: "VIDEO_SWITCHED" | "NAV_BINDING_FAILED"; message: string } {
  const href = deps.getHref();
  let hostname = "";
  try {
    hostname = new URL(href, "https://studio.youtube.com").hostname;
  } catch {
    return {
      ok: false,
      code: "NAV_BINDING_FAILED",
      message: `Unparseable href=${href}`,
    };
  }
  if (hostname !== "studio.youtube.com") {
    return {
      ok: false,
      code: "VIDEO_SWITCHED",
      message: `Expected studio.youtube.com, got host=${hostname}`,
    };
  }

  const currentId = extractVideoIdFromHref(href);
  if (!currentId) {
    return {
      ok: false,
      code: "NAV_BINDING_FAILED",
      message: `No video id in href=${href} (channel-level or non-video surface)`,
    };
  }
  if (currentId !== expectedVideoId) {
    return {
      ok: false,
      code: "VIDEO_SWITCHED",
      message: `Expected video=${expectedVideoId}, current=${currentId}`,
    };
  }

  const doc = deps.detectDocument ?? document;
  const detection = detectStudio({ href, document: doc });
  if (detection.page !== "SUBTITLES") {
    return {
      ok: false,
      code: "NAV_BINDING_FAILED",
      message: `Expected SUBTITLES page, got page=${detection.page} (layout=${detection.layout})`,
    };
  }
  return { ok: true };
}

function bindingFailureResult(
  videoId: string,
  check: { code: "VIDEO_SWITCHED" | "NAV_BINDING_FAILED"; message: string },
  warnings: TaskWarning[],
  outcomes: LanguageOutcome[],
): TaskResult {
  const line =
    outcomes.length > 0 ? `; ${formatOutcomesSummary(outcomes)}` : "";
  return {
    status: "FAILED",
    summary: `Subtitle multilang stopped: video binding failed (${check.code}). video=${videoId}${line}`,
    warnings: [...warnings, { code: check.code, message: check.message }],
  };
}

function languageCodeFromElement(el: Element): string | null {
  const attr =
    el.getAttribute("data-language-code") ??
    el.getAttribute("data-luftballons-subtitle-lang");
  if (attr && attr.trim()) {
    return attr.trim();
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Read existing language codes from the subtitle languages list.
 * Returns null when the list container itself is missing (UI mismatch).
 */
export async function readExistingLanguages(
  dom: CancellableDomService,
): Promise<string[] | null> {
  const listTarget = getSubtitleTarget("subtitle.languages.list");
  const list = await dom.find(listTarget);
  if (!list) {
    return null;
  }

  const itemSel =
    typeof SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback ===
    "string"
      ? SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback
      : '[data-luftballons-subtitle-lang], [data-language-code]';

  const codes = new Set<string>();
  for (const el of list.querySelectorAll(itemSel)) {
    const code = languageCodeFromElement(el);
    if (code) {
      codes.add(code);
    }
  }
  // Also accept direct children marked as language items under the list.
  for (const el of list.children) {
    const code = languageCodeFromElement(el);
    if (code) {
      codes.add(code);
    }
  }
  return [...codes];
}

function optionTargetFor(lang: SubtitleLanguage): DomTarget {
  // Prefer stable code attribute — do not use bare text match (a single-option
  // picker parent would share the same textContent as its only child).
  return {
    id: "subtitle.language.option",
    // assumption, calibrate on real device
    selectorFallback: [
      `[data-luftballons-subtitle-option][data-language-code="${lang.code}"]`,
      `[data-language-code="${lang.code}"][data-luftballons-subtitle-option]`,
      `button[data-language-code="${lang.code}"]`,
      `[data-language-code="${lang.code}"]`,
    ],
  };
}

async function addLanguage(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const addBtn = getSubtitleTarget("subtitle.add_language");
  if (!(await dom.exists(addBtn))) {
    throw new Error(
      `Add-language control missing (assumption target "${addBtn.id}")`,
    );
  }
  await dom.click(addBtn);
  throwIfAborted(signal);

  const option = optionTargetFor(lang);
  const found =
    (await dom.find(option)) ??
    (await dom.find({
      id: "subtitle.language.option",
      selectorFallback: `[data-language-code="${lang.code}"]`,
    }));
  if (!found) {
    throw new Error(
      `Language option not found for ${lang.code} (assumption picker DOM)`,
    );
  }
  if (found instanceof HTMLElement) {
    found.click();
  } else {
    found.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }
}

async function publishSubtitles(
  dom: CancellableDomService,
  deps: SubtitleWorkflowDeps,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const publish = getSubtitleTarget("subtitle.publish");
  if (!(await dom.exists(publish))) {
    throw new Error(
      `Publish control missing (assumption target "${publish.id}")`,
    );
  }
  deps.onPublishAttempt?.();
  await dom.click(publish);
}

function buildResult(
  summary: SubtitleMultilangSummary,
  warnings: TaskWarning[],
): TaskResult {
  const line = formatOutcomesSummary(summary.outcomes);
  if (summary.humanRejected) {
    return {
      status: "COMPLETED",
      summary: `Publish skipped (Human Gate REJECTED). video=${summary.videoId}; ${line}`,
      warnings: [
        ...warnings,
        {
          code: "HUMAN_GATE_REJECTED",
          message:
            "User rejected WRITE_COMMIT; no publish. Per-language status CANCELLED.",
        },
      ],
    };
  }

  const failed = summary.outcomes.some((o) => o.status === "FAILED");
  const cancelled = summary.outcomes.some((o) => o.status === "CANCELLED");
  const anySuccess = summary.outcomes.some(
    (o) =>
      o.status === "SUCCESS" ||
      o.status === "EXISTS" ||
      o.status === "SKIPPED",
  );

  if (failed && anySuccess) {
    return {
      status: "PARTIAL",
      summary: `Subtitle multilang partial. video=${summary.videoId}; ${line}`,
      warnings,
    };
  }
  if (failed && !anySuccess) {
    return {
      status: "FAILED",
      summary: `Subtitle multilang failed. video=${summary.videoId}; ${line}`,
      warnings,
    };
  }
  if (cancelled && !summary.published && !anySuccess) {
    return {
      status: "CANCELLED",
      summary: `Subtitle multilang cancelled. video=${summary.videoId}; ${line}`,
      warnings,
    };
  }
  return {
    status: "COMPLETED",
    summary: `Subtitle multilang done. video=${summary.videoId}; published=${summary.published}; ${line}`,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function runSubtitleMultilangWorkflow(
  ctx: TaskContext,
  deps: SubtitleWorkflowDeps,
): Promise<TaskResult> {
  const warnings: TaskWarning[] = [];
  const targets = deps.getTargetLanguages();

  if (targets.length === 0) {
    return {
      status: "FAILED",
      summary: "No target languages selected",
      warnings: [
        {
          code: "NO_TARGET_LANGUAGES",
          message: "Select at least one subtitle language before starting",
        },
      ],
    };
  }

  // 1) verify current video
  ctx.setProgress("Verifying current video…", "RUNNING");
  throwIfAborted(ctx.signal);
  const videoId = extractVideoIdFromHref(deps.getHref());
  if (!videoId) {
    return {
      status: "FAILED",
      summary:
        "Cannot read video id from URL (expected /video/{id}/…). Refusing to guess.",
      warnings: [
        {
          code: "VIDEO_ID_MISSING",
          message: `href=${deps.getHref()}`,
        },
      ],
    };
  }

  // 2) navigate to subtitles (video-scoped target via NavigationService)
  ctx.setProgress("Opening subtitles…", "RUNNING");
  throwIfAborted(ctx.signal);
  try {
    await deps.navigation.navigate("SUBTITLES", ctx.signal);
    await deps.navigation.waitReady("SUBTITLES", undefined, ctx.signal);
  } catch (error) {
    if (isAbortError(error) || ctx.signal.aborted) {
      throw error;
    }
    const detail =
      error instanceof NavigationError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "navigation failed";
    return {
      status: "FAILED",
      summary: `Failed to open subtitles page: ${detail}`,
      warnings: [{ code: "SUBTITLES_NAV_FAILED", message: detail }],
    };
  }

  // 2b) recheck: same video + SUBTITLES before any DOM write
  const afterNav = recheckVideoBinding(deps, videoId);
  if (!afterNav.ok) {
    return bindingFailureResult(videoId, afterNav, warnings, []);
  }

  // 3) read existing languages
  ctx.setProgress("Reading existing subtitle languages…", "RUNNING");
  throwIfAborted(ctx.signal);
  const existing = await readExistingLanguages(deps.dom);
  if (existing === null) {
    // UI mismatch — fail closed, no speculative clicks
    return {
      status: "FAILED",
      summary:
        "Subtitle languages list not found (UI mismatch). No clicks performed.",
      warnings: [
        {
          code: "SUBTITLE_UI_MISMATCH",
          message:
            'Missing assumption target "subtitle.languages.list" — calibrate on real device',
        },
      ],
    };
  }

  const existingSet = new Set(
    existing.map((c) => c.toLowerCase()),
  );

  // 4) diff: exists → SKIP; absent → ADD
  const toAdd: SubtitleLanguage[] = [];
  const outcomes: LanguageOutcome[] = [];

  for (const lang of targets) {
    throwIfAborted(ctx.signal);
    if (existingSet.has(lang.code.toLowerCase())) {
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "SKIPPED",
        detail: "Already present (EXISTS)",
      });
    } else {
      toAdd.push(lang);
    }
  }

  // Re-run / idempotent path: nothing to add → no WRITE_COMMIT needed
  if (toAdd.length === 0) {
    const summary: SubtitleMultilangSummary = {
      videoId,
      outcomes: outcomes.map((o) =>
        o.status === "SKIPPED"
          ? { ...o, status: "EXISTS", detail: "Already present" }
          : o,
      ),
      published: false,
      humanRejected: false,
    };
    // Prefer EXISTS wording on pure re-run (P4-T5)
    return buildResult(summary, warnings);
  }

  // 5) prepare final state (WRITE_REVERSIBLE — add languages before commit)
  ctx.capabilities.require("WRITE_REVERSIBLE");
  ctx.setProgress("Adding missing languages…", "RUNNING");
  for (const lang of toAdd) {
    throwIfAborted(ctx.signal);
    const beforeAdd = recheckVideoBinding(deps, videoId);
    if (!beforeAdd.ok) {
      return {
        ...bindingFailureResult(videoId, beforeAdd, warnings, outcomes),
        // keep outcomes so far in summary via warnings path
      };
    }
    try {
      await addLanguage(deps.dom, lang, ctx.signal);
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "SUCCESS",
        detail: "Added (pending publish)",
      });
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) {
        throw error;
      }
      // SPEC §37: single-language failure must not sink the whole task
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "FAILED",
        detail: error instanceof Error ? error.message : "add failed",
      });
      warnings.push({
        code: "LANGUAGE_ADD_FAILED",
        message: `${lang.code}: ${error instanceof Error ? error.message : "add failed"}`,
      });
    }
  }

  const pendingPublish = outcomes.filter(
    (o) => o.status === "SUCCESS" && o.detail === "Added (pending publish)",
  );
  if (pendingPublish.length === 0) {
    const summary: SubtitleMultilangSummary = {
      videoId,
      outcomes,
      published: false,
      humanRejected: false,
    };
    return buildResult(summary, warnings);
  }

  // 6) WRITE_COMMIT → Human Gate
  ctx.capabilities.require("WRITE_COMMIT");
  const consequenceLines = pendingPublish.map(
    (o) => `${o.label} (${o.code})`,
  );
  ctx.setProgress("Waiting for human confirmation…", "WAITING_HUMAN");
  const decision = await ctx.humanGate.request(
    {
      capability: "WRITE_COMMIT",
      title: "Publish subtitle languages",
      description: `Publish the following subtitle languages on video ${videoId}. This action cannot be undone from Luftballons.`,
      consequences: [
        ...consequenceLines,
        "不可撤销 / irreversible WRITE_COMMIT",
      ],
      reversible: false,
    },
    ctx.signal,
  );

  if (ctx.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  ctx.setProgress("Resuming…", "RUNNING");

  // 8) REJECTED → no commit
  if (decision === "REJECTED") {
    const summary: SubtitleMultilangSummary = {
      videoId,
      outcomes: outcomes.map((o) =>
        o.status === "SUCCESS" && o.detail === "Added (pending publish)"
          ? {
              ...o,
              status: "CANCELLED" as const,
              detail: "Human Gate REJECTED — not published",
            }
          : o,
      ),
      published: false,
      humanRejected: true,
    };
    return buildResult(summary, warnings);
  }

  // 7) APPROVED → recheck binding, then publish + verify
  const beforePublish = recheckVideoBinding(deps, videoId);
  if (!beforePublish.ok) {
    return bindingFailureResult(videoId, beforePublish, warnings, outcomes);
  }

  ctx.setProgress("Publishing…", "RUNNING");
  try {
    await publishSubtitles(deps.dom, deps, ctx.signal);
  } catch (error) {
    if (isAbortError(error) || ctx.signal.aborted) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "publish failed";
    return {
      status: "FAILED",
      summary: `Publish failed after approval: ${message}`,
      warnings: [
        ...warnings,
        { code: "PUBLISH_FAILED", message },
      ],
    };
  }

  throwIfAborted(ctx.signal);
  const afterPublishBind = recheckVideoBinding(deps, videoId);
  if (!afterPublishBind.ok) {
    return bindingFailureResult(videoId, afterPublishBind, warnings, outcomes);
  }

  const after = await readExistingLanguages(deps.dom);
  if (after === null) {
    warnings.push({
      code: "POSTCONDITION_UNREADABLE",
      message: "Could not re-read language list after publish",
    });
  }
  const afterSet = new Set((after ?? []).map((c) => c.toLowerCase()));

  const finalOutcomes: LanguageOutcome[] = outcomes.map((o) => {
    if (o.status !== "SUCCESS" || o.detail !== "Added (pending publish)") {
      return o;
    }
    if (afterSet.has(o.code.toLowerCase())) {
      return {
        ...o,
        status: "SUCCESS" as const,
        detail: "Published and verified",
      };
    }
    // List unreadable or code absent — do not invent success
    if (after === null) {
      return {
        ...o,
        status: "SUCCESS" as const,
        detail: "Published (postcondition list unreadable)",
      };
    }
    return {
      ...o,
      status: "FAILED" as const,
      detail: "Published click done but language missing from list",
    };
  });

  const summary: SubtitleMultilangSummary = {
    videoId,
    outcomes: finalOutcomes,
    published: true,
    humanRejected: false,
  };
  return buildResult(summary, warnings);
}
