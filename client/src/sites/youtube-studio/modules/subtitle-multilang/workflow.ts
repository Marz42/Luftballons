/**
 * youtube.subtitle.multilang workflow (IMPLEMENTATION §47, SPEC §35–§37).
 * Fail-closed: unknown DOM → stop; no speculative clicks; no fixed sleep.
 */

import type {
  TaskContext,
  TaskResult,
  TaskWarning,
} from "../../../../runtime/types.js";
import {
  createDomService,
  type CancellableDomService,
  type DomTarget,
} from "../../../../services/dom-service.js";
import type { CancellableNavigationService } from "../../navigation.js";
import { NavigationError } from "../../navigation.js";
import { detectStudio } from "../../page-detector.js";
import {
  extractVideoIdFromHref,
  getSubtitleTarget,
  isActiveElement,
  SUBTITLE_TARGETS,
} from "../../selectors.js";
import {
  formatOutcomesSummary,
  resolveLanguageCodeFromLabel,
  type LanguageListParseResult,
  type LanguageOutcome,
  type SubtitleLanguage,
  type SubtitleLanguageRow,
  type SubtitleMultilangSummary,
  type SubtitleRowState,
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

function languageCodeFromElement(el: Element): {
  code: string | null;
  unparseable: boolean;
} {
  const attr =
    el.getAttribute("data-language-code") ??
    el.getAttribute("data-luftballons-subtitle-lang");
  if (attr && attr.trim()) {
    return { code: attr.trim(), unparseable: false };
  }
  // Strip trailing fixture state suffix e.g. "英语 (pending)"
  const raw = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const text = raw.replace(/\s*\(pending\)\s*$/i, "").trim();
  if (!text) {
    return { code: null, unparseable: true };
  }
  const mapped = resolveLanguageCodeFromLabel(text);
  if (mapped) {
    return { code: mapped, unparseable: false };
  }
  // Unknown label without code attribute — do not treat text as a BCP code
  return { code: null, unparseable: true };
}

/**
 * assumption, calibrate on real device:
 * PUBLISHED = data-subtitle-state=PUBLISHED or data-subtitle-published=true;
 * PENDING_PUBLISH = data-subtitle-state=PENDING_PUBLISH;
 * unmarked existing row → EXISTS (treated as already on video).
 */
function rowStateFromElement(el: Element): SubtitleRowState {
  const state = el.getAttribute("data-subtitle-state");
  if (state === "PENDING_PUBLISH") {
    return "PENDING_PUBLISH";
  }
  if (
    state === "PUBLISHED" ||
    el.getAttribute("data-subtitle-published") === "true"
  ) {
    return "PUBLISHED";
  }
  return "EXISTS";
}

function collectRowElements(list: Element): Element[] {
  const itemSel =
    typeof SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback ===
    "string"
      ? SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback
      : '[data-luftballons-subtitle-lang], [data-language-code]';

  const seen = new Set<Element>();
  const rows: Element[] = [];
  for (const el of list.querySelectorAll(itemSel)) {
    if (!seen.has(el)) {
      seen.add(el);
      rows.push(el);
    }
  }
  for (const el of list.children) {
    if (
      el instanceof Element &&
      !seen.has(el) &&
      (el.hasAttribute("data-luftballons-subtitle-lang") ||
        el.hasAttribute("data-language-code") ||
        el.hasAttribute("data-luftballons-subtitle-row") ||
        (el.textContent ?? "").trim().length > 0)
    ) {
      seen.add(el);
      rows.push(el);
    }
  }
  return rows;
}

/**
 * Three-state language list parse (P2-2):
 * EMPTY — container present, zero rows
 * READABLE — every row yields a reliable code
 * UNPARSEABLE — container missing OR a row cannot yield a code
 */
export async function parseLanguageList(
  dom: CancellableDomService,
): Promise<LanguageListParseResult | { kind: "MISSING" }> {
  const listTarget = getSubtitleTarget("subtitle.languages.list");
  const list = await dom.find(listTarget);
  if (!list) {
    return { kind: "MISSING" };
  }

  const elements = collectRowElements(list);
  if (elements.length === 0) {
    return { kind: "EMPTY", rows: [] };
  }

  const byCode = new Map<string, SubtitleLanguageRow>();
  for (const el of elements) {
    const { code, unparseable } = languageCodeFromElement(el);
    if (unparseable || !code) {
      return {
        kind: "UNPARSEABLE",
        rows: [...byCode.values()],
        detail:
          "Subtitle language row missing reliable code — calibrate selectors / label map",
      };
    }
    const key = code.toLowerCase();
    if (byCode.has(key)) {
      continue;
    }
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    byCode.set(key, {
      code,
      state: rowStateFromElement(el),
      ...(label ? { label } : {}),
    });
  }
  return { kind: "READABLE", rows: [...byCode.values()] };
}

/**
 * Read language rows with publish state from the subtitle list.
 * Returns null when the list container itself is missing (UI mismatch).
 * @deprecated Prefer parseLanguageList for three-state handling.
 */
export async function readLanguageRows(
  dom: CancellableDomService,
): Promise<SubtitleLanguageRow[] | null> {
  const parsed = await parseLanguageList(dom);
  if (parsed.kind === "MISSING") {
    return null;
  }
  if (parsed.kind === "UNPARSEABLE") {
    return null;
  }
  return parsed.rows;
}

/**
 * Read existing language codes from the subtitle languages list.
 * Returns null when the list container itself is missing (UI mismatch).
 */
export async function readExistingLanguages(
  dom: CancellableDomService,
): Promise<string[] | null> {
  const rows = await readLanguageRows(dom);
  if (rows === null) {
    return null;
  }
  return rows.map((r) => r.code);
}

async function waitForLanguageListSettled(
  dom: CancellableDomService,
  signal: AbortSignal,
  /** Max wait while list is EMPTY (rows may still be loading). */
  emptySettleMs = 400,
): Promise<LanguageListParseResult | { kind: "MISSING" }> {
  throwIfAborted(signal);
  const first = await parseLanguageList(dom);
  if (first.kind !== "EMPTY") {
    return first;
  }

  const deadline = Date.now() + emptySettleMs;
  let last: LanguageListParseResult | { kind: "MISSING" } = first;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(resolve, 20);
      const onAbort = (): void => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    last = await parseLanguageList(dom);
    if (last.kind !== "EMPTY") {
      return last;
    }
  }
  // Confirmed empty after settle window — safe to treat as vacuum.
  return last.kind === "EMPTY" ? last : last;
}

async function waitForPublishedRow(
  dom: CancellableDomService,
  langCode: string,
  signal: AbortSignal,
  timeoutMs = 2_000,
): Promise<boolean> {
  throwIfAborted(signal);
  const target: DomTarget = {
    id: `subtitle.language.published.${langCode}`,
    // assumption, calibrate on real device
    selectorFallback: [
      `[data-luftballons-subtitle-lang="${langCode}"][data-subtitle-state="PUBLISHED"]`,
      `[data-language-code="${langCode}"][data-subtitle-published="true"]`,
      `[data-language-code="${langCode}"][data-subtitle-state="PUBLISHED"]`,
    ],
    matches: isActiveElement,
    unique: true,
  };
  try {
    await dom.waitFor(target, timeoutMs, signal);
    return true;
  } catch {
    throwIfAborted(signal);
    return false;
  }
}

function optionTargetFor(lang: SubtitleLanguage): DomTarget {
  // Prefer stable option markers — never bare language rows (P1-2).
  return {
    id: "subtitle.language.option",
    // assumption, calibrate on real device
    selectorFallback: [
      `[data-luftballons-subtitle-option][data-language-code="${lang.code}"]`,
      `[data-language-code="${lang.code}"][data-luftballons-subtitle-option]`,
      `button[data-luftballons-subtitle-option][data-language-code="${lang.code}"]`,
    ],
    matches: isActiveElement,
    unique: true,
  };
}

class UiMismatchError extends Error {
  readonly code = "UI_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "UiMismatchError";
  }
}

class WaitTimeoutError extends Error {
  readonly code = "WAIT_TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "WaitTimeoutError";
  }
}

/**
 * Unique active subtitle editor — fail closed if missing / ambiguous.
 */
async function requireEditor(
  dom: CancellableDomService,
): Promise<Element> {
  const editor = await dom.find(getSubtitleTarget("subtitle.editor"));
  if (!editor) {
    throw new UiMismatchError(
      'Unique active subtitle editor not found (assumption "subtitle.editor")',
    );
  }
  return editor;
}

function scopedDom(root: ParentNode, timeoutMs = 2_000): CancellableDomService {
  return createDomService({ root, defaultTimeoutMs: timeoutMs });
}

async function waitPickerClosed(
  editorDom: CancellableDomService,
  signal: AbortSignal,
  timeoutMs = 2_000,
): Promise<void> {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    const picker = await editorDom.find(
      getSubtitleTarget("subtitle.language.picker"),
    );
    if (!picker) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(resolve, 20);
      const onAbort = (): void => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new WaitTimeoutError(
    "Language picker did not close after option selection",
  );
}

async function addLanguage(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const editor = await requireEditor(dom);
  const editorDom = scopedDom(editor);

  const addBtn = getSubtitleTarget("subtitle.add_language");
  if (!(await editorDom.exists(addBtn))) {
    throw new UiMismatchError(
      `Add-language control missing inside editor (assumption target "${addBtn.id}")`,
    );
  }
  await editorDom.click(addBtn);
  throwIfAborted(signal);

  // Wait: menu appears (cancellable, no fixed sleep)
  const pickerTarget = getSubtitleTarget("subtitle.language.picker");
  let picker: Element;
  try {
    picker = await editorDom.waitFor(pickerTarget, 2_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError(
      'Language picker did not appear after Add language (assumption "subtitle.language.picker")',
    );
  }

  const pickerDom = scopedDom(picker);
  const option = optionTargetFor(lang);
  let found: Element;
  try {
    found = await pickerDom.waitFor(option, 2_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError(
      `Language option not ready for ${lang.code} inside open picker`,
    );
  }

  if (found instanceof HTMLElement) {
    found.click();
  } else {
    found.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }
  throwIfAborted(signal);

  // Wait: add result — pending or published row appears in list
  const pendingTarget: DomTarget = {
    id: `subtitle.language.row.${lang.code}`,
    selectorFallback: [
      `[data-luftballons-subtitle-lang="${lang.code}"]`,
      `[data-language-code="${lang.code}"]`,
    ],
    matches: isActiveElement,
    unique: true,
  };
  try {
    await editorDom.waitFor(pendingTarget, 2_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError(
      `Language row for ${lang.code} did not appear after option click`,
    );
  }

  // Wait: picker closed / editor operable before next language
  await waitPickerClosed(editorDom, signal);
}

async function publishSubtitles(
  dom: CancellableDomService,
  deps: SubtitleWorkflowDeps,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const editor = await requireEditor(dom);
  const editorDom = scopedDom(editor);
  const publish = getSubtitleTarget("subtitle.publish");
  if (!(await editorDom.exists(publish))) {
    throw new UiMismatchError(
      `Publish control missing inside editor (assumption target "${publish.id}")`,
    );
  }
  deps.onPublishAttempt?.();
  await editorDom.click(publish);
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
  const unconfirmed = summary.outcomes.some((o) => o.status === "UNCONFIRMED");
  const anySuccess = summary.outcomes.some(
    (o) =>
      o.status === "SUCCESS" ||
      o.status === "EXISTS" ||
      o.status === "SKIPPED",
  );

  if (unconfirmed) {
    return {
      status: "PARTIAL",
      summary: `Subtitle multilang unconfirmed. video=${summary.videoId}; published=${summary.published}; ${line}`,
      warnings,
    };
  }
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

  // 3) read existing languages (three-state parse; wait if rows still loading)
  ctx.setProgress("Reading existing subtitle languages…", "RUNNING");
  throwIfAborted(ctx.signal);
  const parsed = await waitForLanguageListSettled(deps.dom, ctx.signal);
  if (parsed.kind === "MISSING") {
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
  if (parsed.kind === "UNPARSEABLE") {
    return {
      status: "FAILED",
      summary:
        "Subtitle language list unparseable — refusing to treat as empty (no add).",
      warnings: [
        {
          code: "SUBTITLE_LANGUAGE_UNPARSEABLE",
          message:
            parsed.detail ??
            "Calibrate subtitle.language.item / label→code map on real device",
        },
      ],
    };
  }

  const existingRows = parsed.rows;
  const rowByCode = new Map(
    existingRows.map((r) => [r.code.toLowerCase(), r] as const),
  );

  // 4) diff: PUBLISHED/EXISTS → SKIP; PENDING_PUBLISH → resume publish; absent → ADD
  const toAdd: SubtitleLanguage[] = [];
  const alreadyPending: SubtitleLanguage[] = [];
  const outcomes: LanguageOutcome[] = [];

  for (const lang of targets) {
    throwIfAborted(ctx.signal);
    const row = rowByCode.get(lang.code.toLowerCase());
    if (!row) {
      toAdd.push(lang);
      continue;
    }
    if (row.state === "PENDING_PUBLISH") {
      alreadyPending.push(lang);
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "SUCCESS",
        detail: "Added (pending publish)",
      });
      continue;
    }
    // PUBLISHED or EXISTS
    outcomes.push({
      code: lang.code,
      label: lang.label,
      status: "SKIPPED",
      detail: "Already present (EXISTS)",
    });
  }

  // Re-run / idempotent path: nothing to add and nothing pending → no WRITE_COMMIT
  if (toAdd.length === 0 && alreadyPending.length === 0) {
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
  if (toAdd.length > 0) {
    ctx.capabilities.require("WRITE_REVERSIBLE");
    ctx.setProgress("Adding missing languages…", "RUNNING");
    for (const lang of toAdd) {
      throwIfAborted(ctx.signal);
      const beforeAdd = recheckVideoBinding(deps, videoId);
      if (!beforeAdd.ok) {
        return bindingFailureResult(videoId, beforeAdd, warnings, outcomes);
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
        const message =
          error instanceof Error ? error.message : "add failed";
        const code =
          error instanceof UiMismatchError
            ? "UI_MISMATCH"
            : error instanceof WaitTimeoutError
              ? "WAIT_TIMEOUT"
              : "LANGUAGE_ADD_FAILED";
        outcomes.push({
          code: lang.code,
          label: lang.label,
          status: "FAILED",
          detail: message,
        });
        warnings.push({
          code,
          message: `${lang.code}: ${message}`,
        });
        // P2-1: wait/recovery failure → stop; do not continue next language
        if (
          error instanceof WaitTimeoutError ||
          error instanceof UiMismatchError
        ) {
          for (const rest of toAdd.slice(toAdd.indexOf(lang) + 1)) {
            outcomes.push({
              code: rest.code,
              label: rest.label,
              status: "CANCELLED",
              detail: "Stopped after prior language wait/UI failure",
            });
          }
          break;
        }
      }
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

  // 7) APPROVED → recheck binding, then publish + verify PUBLISHED state
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

  // Detect explicit publish error surface (assumption fixture).
  const publishErr = await deps.dom.find({
    id: "subtitle.publish.error",
    selectorFallback:
      '[data-luftballons-target="subtitle.publish"][data-publish-error="true"], button[aria-label="Publish"][data-publish-error="true"]',
    matches: isActiveElement,
    unique: true,
  });
  if (publishErr) {
    warnings.push({
      code: "PUBLISH_FAILED",
      message: "Publish control reported an error after click",
    });
    const summary: SubtitleMultilangSummary = {
      videoId,
      outcomes: outcomes.map((o) =>
        o.status === "SUCCESS" && o.detail === "Added (pending publish)"
          ? {
              ...o,
              status: "FAILED" as const,
              detail: "Publish failed (error surface)",
            }
          : o,
      ),
      published: false,
      humanRejected: false,
    };
    return buildResult(summary, warnings);
  }

  // Postcondition: require explicit PUBLISHED — not merely a language row.
  const finalOutcomes: LanguageOutcome[] = [];
  let anyUnconfirmed = false;
  let anyVerifiedPublished = false;

  for (const o of outcomes) {
    if (o.status !== "SUCCESS" || o.detail !== "Added (pending publish)") {
      finalOutcomes.push(o);
      continue;
    }

    const publishedOk = await waitForPublishedRow(
      deps.dom,
      o.code,
      ctx.signal,
    );
    if (publishedOk) {
      anyVerifiedPublished = true;
      finalOutcomes.push({
        ...o,
        status: "SUCCESS",
        detail: "Published and verified",
      });
      continue;
    }

    throwIfAborted(ctx.signal);
    const afterRows = await readLanguageRows(deps.dom);
    if (afterRows === null) {
      anyUnconfirmed = true;
      finalOutcomes.push({
        ...o,
        status: "UNCONFIRMED",
        detail: "Publish click done; list unreadable — result unconfirmed",
      });
      continue;
    }

    const row = afterRows.find(
      (r) => r.code.toLowerCase() === o.code.toLowerCase(),
    );
    if (row?.state === "PUBLISHED") {
      anyVerifiedPublished = true;
      finalOutcomes.push({
        ...o,
        status: "SUCCESS",
        detail: "Published and verified",
      });
    } else if (row?.state === "PENDING_PUBLISH" || row) {
      // Row present but not published — publish无效 / incomplete
      finalOutcomes.push({
        ...o,
        status: "FAILED",
        detail:
          row.state === "PENDING_PUBLISH"
            ? "Publish click done but row still PENDING_PUBLISH"
            : "Publish click done but PUBLISHED state not observed",
      });
      warnings.push({
        code: "PUBLISH_NOT_CONFIRMED",
        message: `${o.code}: expected PUBLISHED, observed ${row.state}`,
      });
    } else {
      finalOutcomes.push({
        ...o,
        status: "FAILED",
        detail: "Publish click done but language missing from list",
      });
    }
  }

  if (anyUnconfirmed) {
    warnings.push({
      code: "PUBLISH_UNCONFIRMED",
      message:
        "Could not re-read language list after publish — published must not be claimed",
    });
  }

  const summary: SubtitleMultilangSummary = {
    videoId,
    outcomes: finalOutcomes,
    published: anyVerifiedPublished && !anyUnconfirmed,
    humanRejected: false,
  };
  // Honest: if any UNCONFIRMED, published stays false even if others verified
  if (anyUnconfirmed) {
    summary.published = false;
  }
  return buildResult(summary, warnings);
}
