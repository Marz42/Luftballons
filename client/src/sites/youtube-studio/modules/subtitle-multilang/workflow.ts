/**
 * youtube.subtitle.multilang workflow (IMPLEMENTATION §47, SPEC §35–§37).
 * Fail-closed: unknown DOM → stop; no speculative clicks; no fixed sleep.
 */

import type {
  TaskContext,
  TaskResult,
  TaskWarning,
} from "../../../../runtime/types.js";
import { abortableDelay } from "../../../../modules/step-control.js";
import {
  createDomService,
  querySelectorAllDeep,
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
  isCaptionsPublishedState,
  labelAliasesForLanguage,
  needsCaptionsResume,
  pickerFilterQueryForLanguage,
  resolveLanguageCodeFromLabel,
  type CaptionsTranslatePhase,
  type LanguageListParseResult,
  type LanguageOutcome,
  type SubtitleLanguage,
  type SubtitleLanguageRow,
  type SubtitleMultilangSummary,
  type SubtitleRowState,
} from "./schema.js";
import type { HumanGateService } from "../../../../runtime/types.js";

export { extractVideoIdFromHref };

/** Prefer content ready within this budget; timeout → do not publish. */
const CAPTIONS_READY_TIMEOUT_MS = 12_000;
/** Post-publish: captions published + list restore. */
const PUBLISH_VERIFY_TIMEOUT_MS = 8_000;
/** After publish click: blank error or success in one loop. */
const PUBLISH_OBSERVE_MS = 8_000;
const TRANSLATE_RETRY_SETTLE_MS = 3_000;

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
  if (detection.layout === "UNKNOWN" || detection.page !== "SUBTITLES") {
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
  // Prefer language-name cell when present (translations table).
  const nameCell =
    el.querySelector(
      ".language-text, .tablecell-language, button.language-display-name, [class*='language']",
    ) ?? el;
  const raw = (nameCell.textContent ?? "").replace(/\s+/g, " ").trim();
  // Strip fixture `(pending)` and live Studio `（视频语言）` / `(Video language)`.
  const text = raw
    .replace(/\s*\(pending\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*[（(][^）)]*[）)]\s*$/u, "")
    .trim();
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

function findCaptionsCell(row: Element): Element | null {
  const raw = Array.from(
    row.querySelectorAll(
      [
        "ytgn-video-translation-cell-captions",
        ".tablecell-captions",
        "[data-luftballons-captions-cell]",
        ".captions-hover-cell-container",
      ].join(", "),
    ),
  ).filter((el): el is Element => el instanceof Element);

  // Prefer top-level captions hosts (ignore nested matches inside the same cell).
  const top = raw.filter((el) => {
    const parentCap = el.parentElement?.closest(
      "ytgn-video-translation-cell-captions, .tablecell-captions, [data-luftballons-captions-cell]",
    );
    return parentCap === null || parentCap === el;
  });
  const cells = top.length > 0 ? top : raw;
  if (cells.length === 1) {
    return cells[0]!;
  }
  if (cells.length > 1) {
    // Prefer the Polymer captions cell host when several candidates exist.
    const polymer = cells.filter(
      (el) => el.tagName.toLowerCase() === "ytgn-video-translation-cell-captions",
    );
    if (polymer.length === 1) {
      return polymer[0]!;
    }
    return null;
  }

  // Hover cell scoped under captions naming (live Layout A idle DOM).
  const hover = row.querySelector(
    "ytgn-video-translation-cell-captions ytgn-video-translation-hover-cell, .tablecell-captions ytgn-video-translation-hover-cell, .captions-hover-cell-container ytgn-video-translation-hover-cell",
  );
  if (hover) {
    return hover;
  }

  // Fixture: captions controls mounted on the row itself.
  if (
    row.querySelector(
      "#captions-add, [data-luftballons-captions-cell], [data-luftballons-captions-status]",
    )
  ) {
    return row;
  }
  return null;
}

function normalizeStatusText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isDashStatus(text: string): boolean {
  const t = normalizeStatusText(text);
  // Explicit Studio dash glyphs only — empty string is not "missing captions".
  return t === "–" || t === "-" || t === "—" || t === "－";
}

/** Draft / processing / error — wins over published heuristics. */
function isDraftOrBusyStatus(text: string): boolean {
  const t = normalizeStatusText(text);
  if (!t) {
    return false;
  }
  return /草稿|Draft|处理中|Processing|翻译中|正在翻译|Translating|Loading|失败|Error|无法发布|空白字幕/i.test(
    t,
  );
}

/**
 * Bounded published status (captions #status-info). Avoids substring traps
 * like Unpublished / Not published matching /Published/i.
 */
function isPublishedStatus(text: string): boolean {
  const t = normalizeStatusText(text);
  if (!t) {
    return false;
  }
  if (/未发布|Not\s+published|Unpublished|无法发布|空白/i.test(t)) {
    return false;
  }
  // zh-Hans: 「已发布」or「已发布 2026年9月8日」
  if (/^已发布(\b|\s|$|[\d年])/.test(t)) {
    return true;
  }
  // en: leading Published token only
  if (/^Published(\b|\s|$)/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Live Layout A: hovering the captions cell replaces「已发布」with edit/delete icons.
 * Clear synthetic/real hover so #status-info can be read again.
 */
function clearCaptionsCellHover(captionsCell: Element): void {
  const hosts = [
    captionsCell,
    ...Array.from(
      captionsCell.querySelectorAll(
        "#cell-container, ytgn-video-translation-hover-cell, .captions-hover-cell-container",
      ),
    ),
  ];
  for (const el of hosts) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    el.removeAttribute("hovered");
    el.classList.remove("hovered");
    try {
      (el as HTMLElement & { hovered?: boolean }).hovered = false;
    } catch {
      /* ignore */
    }
    el.dispatchEvent(
      new MouseEvent("mouseleave", { bubbles: true, cancelable: true, composed: true }),
    );
    try {
      el.dispatchEvent(
        new PointerEvent("pointerleave", {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    } catch {
      /* PointerEvent unavailable */
    }
  }
}

/**
 * Published captions track from status text only.
 * Edit/delete hover chrome is never sole evidence (draft rows may show edit).
 */
function captionsCellIndicatesPublished(captionsCell: Element): boolean {
  const status = captionsStatusText(captionsCell);
  if (isDraftOrBusyStatus(status)) {
    return false;
  }
  return isPublishedStatus(status);
}

const CAPTIONS_EDIT_SELECTOR = [
  '[aria-label="编辑"]',
  '[aria-label="Edit"]',
  'button[aria-label*="编辑"]',
  'button[aria-label*="Edit"]',
  "#edit-button",
  'ytcp-icon-button[id*="edit"]',
].join(", ");

export function findCaptionsEditInCell(captionsCell: Element): Element | null {
  const matches = Array.from(
    captionsCell.querySelectorAll(CAPTIONS_EDIT_SELECTOR),
  ).filter((el) => isActiveElement(el) && !isDisabledControl(el));
  // Fail-closed: never pick the first of several candidates.
  return matches.length === 1 ? matches[0]! : null;
}

function captionsStatusText(captionsCell: Element): string {
  const status =
    captionsCell.querySelector("#status-info") ??
    captionsCell.querySelector("[data-luftballons-captions-status]") ??
    captionsCell.querySelector("#status-with-icon-container #status-info") ??
    captionsCell.querySelector("#status-with-icon-container");
  if (status) {
    return normalizeStatusText(status.textContent ?? "");
  }
  return normalizeStatusText(
    captionsCell.getAttribute("data-luftballons-captions-status") ?? "",
  );
}

/**
 * Captions-scoped row state (Layout A). Never uses metadata cell「已发布」.
 * Unknown / missing cell → UNPARSEABLE (fail-closed), not CAPTIONS_MISSING.
 */
function rowStateFromElement(el: Element): SubtitleRowState {
  const attr = el.getAttribute("data-subtitle-state");
  if (attr === "PENDING_PUBLISH") {
    return "CAPTIONS_MISSING";
  }
  if (
    attr === "PUBLISHED" ||
    el.getAttribute("data-subtitle-published") === "true"
  ) {
    return "CAPTIONS_PUBLISHED";
  }

  const captionsCell = findCaptionsCell(el);
  if (!captionsCell) {
    return "UNPARSEABLE";
  }

  clearCaptionsCellHover(captionsCell);

  const status = captionsStatusText(captionsCell);
  if (isDraftOrBusyStatus(status)) {
    return "CAPTIONS_DRAFT";
  }
  if (captionsCellIndicatesPublished(captionsCell)) {
    return "CAPTIONS_PUBLISHED";
  }

  const add = captionsCell.querySelector("#captions-add");
  if (isDashStatus(status) || add) {
    return "CAPTIONS_MISSING";
  }

  // Empty or unrecognized status without add entry — do not invent MISSING/DRAFT.
  return "UNPARSEABLE";
}

function collectRowElements(list: Element): Element[] {
  const seen = new Set<Element>();
  const rows: Element[] = [];

  const pushRow = (el: Element): void => {
    if (seen.has(el)) {
      return;
    }
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!label || /^语言\b/.test(label)) {
      return;
    }
    seen.add(el);
    rows.push(el);
  };

  // Layout A/B: always search under the list host (may be ytgn-video-translations-list,
  // not an HTMLTableElement — do not require table id).
  for (const host of list.querySelectorAll("ytgn-video-translation-row")) {
    if (!(host instanceof Element)) {
      continue;
    }
    const inner =
      host.querySelector("tr#row-container") ??
      host.querySelector("tbody tr") ??
      host.querySelector("tr");
    pushRow(inner instanceof Element ? inner : host);
  }
  if (rows.length > 0) {
    return rows;
  }

  for (const el of list.querySelectorAll(
    "tbody tr, tr#row-container, [data-luftballons-subtitle-row]",
  )) {
    if (el instanceof Element) {
      pushRow(el);
    }
  }
  if (rows.length > 0) {
    return rows;
  }

  const itemSel =
    typeof SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback ===
    "string"
      ? SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback
      : '[data-luftballons-subtitle-lang], [data-language-code]';

  for (const el of list.querySelectorAll(itemSel)) {
    if (el instanceof Element) {
      pushRow(el);
    }
  }
  for (const el of list.children) {
    if (
      el instanceof Element &&
      (el.hasAttribute("data-luftballons-subtitle-lang") ||
        el.hasAttribute("data-language-code") ||
        el.hasAttribute("data-luftballons-subtitle-row") ||
        (el.textContent ?? "").trim().length > 0)
    ) {
      pushRow(el);
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
    const state = rowStateFromElement(el);
    // Keep UNPARSEABLE rows in the map; fail only when that code is a target (diff).
    byCode.set(key, {
      code,
      state,
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

async function hasConfirmedEmptyList(dom: CancellableDomService): Promise<boolean> {
  const list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
  // Assumption marker until a real Studio empty-state signal is calibrated.
  return list?.getAttribute("data-subtitle-list-state") === "EMPTY" &&
    list.getAttribute("aria-busy") !== "true";
}

async function waitForLanguageListSettled(
  dom: CancellableDomService,
  signal: AbortSignal,
  /** Maximum wait for rows or explicit empty evidence; elapsed time is not evidence. */
  emptySettleMs = 2_000,
): Promise<LanguageListParseResult | { kind: "MISSING" }> {
  throwIfAborted(signal);
  const first = await parseLanguageList(dom);
  if (first.kind !== "EMPTY" || await hasConfirmedEmptyList(dom)) {
    return first;
  }

  const deadline = Date.now() + emptySettleMs;
  let last: LanguageListParseResult | { kind: "MISSING" } = first;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    await abortableDelay(20, signal);
    last = await parseLanguageList(dom);
    if (last.kind !== "EMPTY" || await hasConfirmedEmptyList(dom)) {
      return last;
    }
  }
  return { kind: "UNPARSEABLE", rows: [], detail: "Language list never confirmed loading complete/empty" };
}

async function findUniqueLanguageRow(
  list: Element,
  lang: SubtitleLanguage,
): Promise<Element | null> {
  const labelAliases = labelAliasesForLanguage(lang);
  const matches: Element[] = [];
  for (const el of collectRowElements(list)) {
    const mapped = languageCodeFromElement(el);
    if (mapped.code?.toLowerCase() === lang.code.toLowerCase()) {
      matches.push(el);
      continue;
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    for (const alias of labelAliases) {
      if (
        alias &&
        alias.toLowerCase() !== lang.code.toLowerCase() &&
        (text === alias ||
          text.startsWith(`${alias} `) ||
          text.startsWith(alias))
      ) {
        matches.push(el);
        break;
      }
    }
  }
  if (matches.length !== 1) {
    return null;
  }
  return matches[0]!;
}

function listSurfaceActive(domRoot: ParentNode = document): boolean {
  const editors = querySelectorAllDeep(
    domRoot instanceof Document ? domRoot : (domRoot as Element).ownerDocument ?? document,
    "ytve-captions-editor-options-panel, ytve-timedtext-editor, ytve-captions-editor, [data-luftballons-captions-editor]",
  ).filter((el) => isActiveElement(el) && !(el as HTMLElement).hidden);
  // List is "restored" when no active captions editor chrome.
  return editors.length === 0;
}

/**
 * Every success path must satisfy: binding + unique row + captions published
 * + editor exited + list operable. No soft bypasses.
 */
async function publishVerifyOk(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  assertBinding: () => void,
): Promise<boolean> {
  assertBinding();
  const list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
  if (!list || !isActiveElement(list)) {
    return false;
  }
  if (!listSurfaceActive()) {
    return false;
  }
  const row = await findUniqueLanguageRow(list, lang);
  if (!row) {
    return false;
  }
  const cell = findCaptionsCell(row);
  if (cell) {
    clearCaptionsCellHover(cell);
  }
  return isCaptionsPublishedState(rowStateFromElement(row));
}

export async function waitForPublishedRow(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  assertBinding: () => void,
  timeoutMs = PUBLISH_VERIFY_TIMEOUT_MS,
): Promise<boolean> {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  let sawList = false;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    const list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
    if (!list || !isActiveElement(list)) {
      if (sawList) {
        return false;
      }
      await abortableDelay(100, signal);
      continue;
    }
    sawList = true;
    if (await publishVerifyOk(dom, lang, assertBinding)) {
      return true;
    }
    await abortableDelay(100, signal);
  }
  return false;
}

function isDisabledControl(el: Element): boolean {
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
    return true;
  }
  const host = el.closest("[disabled], [aria-disabled='true']");
  return host !== null;
}

function optionTargetFor(lang: SubtitleLanguage): DomTarget {
  const labelAliases = labelAliasesForLanguage(lang);

  // Prefer stable option markers — never bare language rows (P1-2).
  // Live 2026-09-08: tp-yt-paper-item[role=option] text「日语」.
  // Live 2026-09-08: already-added langs are greyed/disabled in picker (阿尔巴尼亚语).
  return {
    id: "subtitle.language.option",
    selectorFallback: [
      `[data-luftballons-subtitle-option][data-language-code="${lang.code}"]`,
      `[data-language-code="${lang.code}"][data-luftballons-subtitle-option]`,
      `button[data-luftballons-subtitle-option][data-language-code="${lang.code}"]`,
      'tp-yt-paper-item[role="option"]',
      '[role="option"]',
      '[role="menuitem"]',
      "tp-yt-paper-item",
    ],
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (isDisabledControl(el)) {
        return false;
      }
      if (el.closest("ytcp-navigation-drawer")) {
        return false;
      }
      // Prefer the paper-item itself, not nested ytcp-ve / div clones.
      if (
        el.tagName.toLowerCase() !== "tp-yt-paper-item" &&
        el.getAttribute("role") !== "option" &&
        !el.hasAttribute("data-luftballons-subtitle-option") &&
        !el.hasAttribute("data-language-code")
      ) {
        return false;
      }
      const code =
        el.getAttribute("data-language-code") ??
        el.getAttribute("data-luftballons-subtitle-lang") ??
        el.getAttribute("test-id");
      if (code && code.toLowerCase() === lang.code.toLowerCase()) {
        return true;
      }
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 40) {
        return false;
      }
      for (const alias of labelAliases) {
        if (alias && text === alias) {
          return true;
        }
      }
      return false;
    },
    unique: true,
  };
}

/** Prefer typing into picker search so long catalogs need not scroll (live Studio). */
async function filterPickerForLanguage(
  picker: Element,
  lang: SubtitleLanguage,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const portal =
    picker.closest("tp-yt-iron-dropdown, iron-dropdown, tp-yt-paper-dialog") ??
    picker;
  const input =
    portal.querySelector<HTMLInputElement>(
      'input:not([type="hidden"]):not([disabled])',
    ) ??
    picker.querySelector<HTMLInputElement>(
      'input:not([type="hidden"]):not([disabled])',
    );
  if (!input) {
    return;
  }
  const query = pickerFilterQueryForLanguage(lang);
  input.focus();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await abortableDelay(50, signal);
}

async function findLanguageOption(
  picker: Element,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  timeoutMs = 3_000,
): Promise<Element> {
  const pickerDom = scopedDom(picker);
  const option = optionTargetFor(lang);
  await filterPickerForLanguage(picker, lang, signal);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    try {
      return await pickerDom.waitFor(option, 200, signal);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        throw error;
      }
      lastError = error;
      // Scroll catalog if virtualized / long list.
      const scrollParent =
        picker.querySelector("[scrollable], .scrollable, #scroller") ?? picker;
      if (scrollParent instanceof HTMLElement) {
        scrollParent.scrollTop += 120;
      }
      await abortableDelay(40, signal);
    }
  }
  void lastError;
  throw new WaitTimeoutError(
    `Language option not ready for ${lang.code} inside open picker`,
  );
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
    if (
      !picker ||
      (picker instanceof HTMLElement && picker.hidden) ||
      !isActiveElement(picker)
    ) {
      return;
    }
    await abortableDelay(20, signal);
  }
  throw new WaitTimeoutError(
    "Language picker did not close after option selection",
  );
}

type CaptionsEntrySurface = "list_row_hover" | "manual_dialog";

/**
 * After picker option click: Layout A → list row; Layout B → 手动字幕 dialog.
 */
async function waitCaptionsEntrySurface(
  dom: CancellableDomService,
  editorDom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
): Promise<CaptionsEntrySurface> {
  const deadline = Date.now() + 5_000;
  const manual = getSubtitleTarget("subtitle.manual_captions_add");
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    if ((await dom.exists(manual)) || (await editorDom.exists(manual))) {
      return "manual_dialog";
    }
    const list =
      (await dom.find(getSubtitleTarget("subtitle.languages.list"))) ??
      (await editorDom.find(getSubtitleTarget("subtitle.languages.list")));
    if (list) {
      const labelAliases = labelAliasesForLanguage(lang);
      for (const el of list.querySelectorAll(
        "tbody tr, tr, [data-luftballons-subtitle-row], ytgn-video-translation-row",
      )) {
        if (!(el instanceof Element) || !isActiveElement(el)) {
          continue;
        }
        if (
          el.hasAttribute("data-luftballons-subtitle-option") ||
          el.getAttribute("role") === "option"
        ) {
          continue;
        }
        const mapped = languageCodeFromElement(el);
        if (mapped.code?.toLowerCase() === lang.code.toLowerCase()) {
          return "list_row_hover";
        }
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        for (const alias of labelAliases) {
          if (
            alias &&
            alias.toLowerCase() !== lang.code.toLowerCase() &&
            (text === alias || text.startsWith(`${alias} `) || text.startsWith(alias))
          ) {
            return "list_row_hover";
          }
        }
      }
    }
    await abortableDelay(40, signal);
  }
  throw new WaitTimeoutError(
    `Neither list row nor 手动字幕 dialog appeared after selecting ${lang.code}`,
  );
}

/** Synthetic hover for Layout A captions cell (Polymer stamps #captions-add). */
function simulatePointerHover(el: Element): void {
  if (!(el instanceof HTMLElement)) {
    return;
  }
  const view = el.ownerDocument.defaultView ?? window;
  const bubbled = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
  } as const;
  const nonBubbling = {
    bubbles: false,
    cancelable: true,
    composed: true,
    view,
  } as const;
  try {
    el.dispatchEvent(
      new PointerEvent("pointerover", {
        ...bubbled,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    el.dispatchEvent(
      new PointerEvent("pointerenter", {
        ...nonBubbling,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  } catch {
    /* PointerEvent unavailable */
  }
  el.dispatchEvent(new MouseEvent("mouseover", bubbled));
  el.dispatchEvent(new MouseEvent("mouseenter", nonBubbling));
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/**
 * Find #captions-add inside a captions cell (unique required).
 */
function findUniqueCaptionsAddInCell(cell: Element): Element | null {
  const selectors = [
    '[data-luftballons-target="subtitle.captions_add"]',
    "ytcp-icon-button#captions-add",
    "#captions-add",
  ];
  const hits: Element[] = [];
  for (const sel of selectors) {
    for (const el of querySelectorAllDeep(cell, sel)) {
      if (
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true"
      ) {
        continue;
      }
      if (
        el.id === "captions-add" ||
        el.getAttribute("data-luftballons-target") === "subtitle.captions_add"
      ) {
        hits.push(el);
      }
    }
    if (hits.length > 0) {
      break;
    }
  }
  if (hits.length !== 1) {
    return null;
  }
  return hits[0]!;
}

function captionsHoverHostsFromCell(captionsCell: Element): Element[] {
  const hosts: Element[] = [captionsCell];
  const hoverCell = captionsCell.querySelector(
    "ytgn-video-translation-hover-cell",
  );
  if (hoverCell) {
    hosts.push(hoverCell);
  }
  const cellContainer =
    captionsCell.querySelector("#cell-container") ??
    hoverCell?.querySelector("#cell-container");
  if (cellContainer) {
    hosts.push(cellContainer);
  }
  return hosts;
}

type HoverMod = {
  el: HTMLElement;
  hoveredAttr: boolean;
  hadHoveredClass: boolean;
  hoveredProp: boolean | undefined;
  styleVisibility: string;
  styleOpacity: string;
  stylePointerEvents: string;
};

function restoreHoverMods(mods: HoverMod[]): void {
  for (const m of mods) {
    if (!m.hoveredAttr) {
      m.el.removeAttribute("hovered");
    }
    if (!m.hadHoveredClass) {
      m.el.classList.remove("hovered");
    }
    try {
      const hostWithHover = m.el as HTMLElement & { hovered?: boolean };
      if (typeof m.hoveredProp === "boolean") {
        hostWithHover.hovered = m.hoveredProp;
      } else {
        delete hostWithHover.hovered;
      }
    } catch {
      /* ignore */
    }
    m.el.style.visibility = m.styleVisibility;
    m.el.style.opacity = m.styleOpacity;
    m.el.style.pointerEvents = m.stylePointerEvents;
  }
}

/**
 * Shared captions-cell hover: wait for a unique control, act while hovered, always restore.
 */
async function hoverCaptionsCellAndAct(
  captionsCell: Element,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  assertBinding: () => void,
  findControl: (cell: Element) => Element | null,
  act: (control: Element, cell: Element) => void | Promise<void>,
  timeoutMs = 2_500,
): Promise<boolean> {
  const mods: HoverMod[] = [];
  const doc = captionsCell.ownerDocument;
  const forceStyle = doc.createElement("style");
  forceStyle.setAttribute("data-luftballons-captions-hover", lang.code);
  captionsCell.setAttribute("data-luftballons-hover-scope", lang.code);
  forceStyle.textContent = `
    [data-luftballons-hover-scope="${lang.code}"] .hover-button,
    [data-luftballons-hover-scope="${lang.code}"] #captions-add,
    [data-luftballons-hover-scope="${lang.code}"] #cell-container #captions-add,
    [data-luftballons-hover-scope="${lang.code}"] [aria-label="编辑"],
    [data-luftballons-hover-scope="${lang.code}"] [aria-label="Edit"] {
      display: inline-flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;
  doc.head.append(forceStyle);

  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      throwIfAborted(signal);
      assertBinding();
      for (const host of captionsHoverHostsFromCell(captionsCell)) {
        if (!(host instanceof HTMLElement)) {
          continue;
        }
        if (!mods.some((m) => m.el === host)) {
          const hostWithHover = host as HTMLElement & { hovered?: boolean };
          mods.push({
            el: host,
            hoveredAttr: host.hasAttribute("hovered"),
            hadHoveredClass: host.classList.contains("hovered"),
            hoveredProp: hostWithHover.hovered,
            styleVisibility: host.style.visibility,
            styleOpacity: host.style.opacity,
            stylePointerEvents: host.style.pointerEvents,
          });
        }
        host.setAttribute("hovered", "");
        host.classList.add("hovered");
        try {
          (host as HTMLElement & { hovered?: boolean }).hovered = true;
        } catch {
          /* ignore */
        }
        simulatePointerHover(host);
      }
      const found = findControl(captionsCell);
      if (found) {
        await act(found, captionsCell);
        return true;
      }
      await abortableDelay(50, signal);
    }
    return false;
  } finally {
    restoreHoverMods(mods);
    captionsCell.removeAttribute("data-luftballons-hover-scope");
    forceStyle.remove();
  }
}

/**
 * Editor language binding: match | mismatch | unknown.
 * Editors without lang attrs/title evidence are unknown (fail-closed).
 */
export function editorLanguageBinding(
  root: Element,
  lang: SubtitleLanguage,
): "match" | "mismatch" | "unknown" {
  const codes = new Set<string>();
  const push = (raw: string | null): void => {
    const c = (raw ?? "").trim().toLowerCase();
    if (c) {
      codes.add(c);
    }
  };
  push(root.getAttribute("data-language-code"));
  push(root.getAttribute("data-luftballons-subtitle-lang"));
  for (const el of root.querySelectorAll(
    "[data-language-code], [data-luftballons-subtitle-lang]",
  )) {
    push(el.getAttribute("data-language-code"));
    push(el.getAttribute("data-luftballons-subtitle-lang"));
  }
  const want = lang.code.toLowerCase();
  if (codes.size > 0) {
    if (codes.has(want) && [...codes].every((c) => c === want)) {
      return "match";
    }
    if (codes.has(want)) {
      return "match";
    }
    return "mismatch";
  }

  const aliases = labelAliasesForLanguage(lang).filter((a) => a.length >= 2);
  const headerBits = [
    root.getAttribute("aria-label") ?? "",
    root.getAttribute("title") ?? "",
    ...Array.from(
      root.querySelectorAll(
        "h1, h2, h3, [role='heading'], .editor-title, .language-name, .header-text, .language-text",
      ),
    ).map((el) => el.textContent ?? ""),
  ];
  const hay = headerBits.join(" ").replace(/\s+/g, " ").trim();
  if (!hay) {
    return "unknown";
  }
  const selfHit = aliases.some((a) => hay.includes(a));
  if (selfHit) {
    return "match";
  }
  // Another language's label in the chrome → mismatch.
  for (const other of [
    { code: "en", label: "English" },
    { code: "ja", label: "日本語" },
    { code: "ko", label: "한국어" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "es", label: "Español" },
    { code: "ar", label: "العربية" },
    { code: "zh-Hans", label: "中文（简体）" },
  ] as SubtitleLanguage[]) {
    if (other.code.toLowerCase() === want) {
      continue;
    }
    const otherAliases = labelAliasesForLanguage(other).filter((a) => a.length >= 2);
    if (otherAliases.some((a) => hay.includes(a))) {
      return "mismatch";
    }
  }
  return "unknown";
}

function listActiveCaptionsEditors(): Element[] {
  return querySelectorAllDeep(
    document,
    [
      "ytve-captions-editor-options-panel",
      "ytve-timedtext-editor",
      "ytve-captions-editor",
      "[data-luftballons-captions-editor]",
    ].join(", "),
  ).filter((el) => isActiveElement(el) && !(el as HTMLElement).hidden);
}

/**
 * True only when an open editor (or auto-translate surface) is bound to `lang`.
 */
async function captionsEditorEntryOpenForLang(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
): Promise<"match" | "mismatch" | "unknown" | "none"> {
  const editors = listActiveCaptionsEditors();
  if (editors.length > 0) {
    const bindings = editors.map((el) => editorLanguageBinding(el, lang));
    if (bindings.some((b) => b === "mismatch")) {
      return "mismatch";
    }
    const matches = editors.filter(
      (el) => editorLanguageBinding(el, lang) === "match",
    );
    if (matches.length === 1) {
      return "match";
    }
    if (matches.length > 1) {
      return "unknown";
    }
    return "unknown";
  }

  const auto = await dom.find(getSubtitleTarget("subtitle.auto_translate"));
  const manual = await dom.find(getSubtitleTarget("subtitle.manual_captions_add"));
  const control = auto ?? manual;
  if (!control) {
    return "none";
  }
  const host =
    control.closest(
      "ytve-captions-editor-options-panel, ytve-timedtext-editor, ytve-captions-editor, [data-luftballons-captions-editor], [data-luftballons-target='subtitle.editor']",
    ) ?? control.parentElement;
  if (!host) {
    return "unknown";
  }
  return editorLanguageBinding(host, lang);
}

async function revealAndClickCaptionsAdd(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  assertBinding: () => void,
  humanGate?: HumanGateService,
): Promise<void> {
  throwIfAborted(signal);
  assertBinding();

  const resolveList = async (): Promise<Element> => {
    let list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
    if (!list) {
      const editor = await requireEditor(dom);
      list = await scopedDom(editor).find(
        getSubtitleTarget("subtitle.languages.list"),
      );
    }
    if (!list || !isActiveElement(list)) {
      throw new UiMismatchError(
        "Unique active language list missing for captions-add",
      );
    }
    return list;
  };

  const tryHoverAndClick = async (): Promise<boolean> => {
    const list = await resolveList();
    const row = await findUniqueLanguageRow(list, lang);
    if (!row) {
      throw new UiMismatchError(
        `Unique language row for ${lang.code} not found for captions-add`,
      );
    }
    const captionsCell = findCaptionsCell(row);
    if (!captionsCell) {
      throw new UiMismatchError(`Unique captions cell missing for ${lang.code}`);
    }

    return hoverCaptionsCellAndAct(
      captionsCell,
      lang,
      signal,
      assertBinding,
      findUniqueCaptionsAddInCell,
      async (_found) => {
        assertBinding();
        const list2 = await resolveList();
        const row2 = await findUniqueLanguageRow(list2, lang);
        const cell2 = row2 ? findCaptionsCell(row2) : null;
        const btn2 = cell2 ? findUniqueCaptionsAddInCell(cell2) : null;
        if (!btn2 || !btn2.isConnected) {
          throw new UiMismatchError(
            `Captions-add for ${lang.code} not uniquely active before click`,
          );
        }
        if (btn2 instanceof HTMLElement) {
          btn2.click();
        } else {
          btn2.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
        }
      },
    );
  };

  if (await tryHoverAndClick()) {
    return;
  }

  // Language-name fallback (Layout B hybrid) before asking human.
  const list = await resolveList();
  const row = await findUniqueLanguageRow(list, lang);
  if (row) {
    const langOpen =
      row.querySelector("button.language-display-name") ??
      row.querySelector(".language-text") ??
      row.querySelector(".tablecell-language");
    if (langOpen instanceof HTMLElement) {
      langOpen.click();
      await abortableDelay(80, signal);
      const manual = getSubtitleTarget("subtitle.manual_captions_add");
      const auto = getSubtitleTarget("subtitle.auto_translate");
      const fallbackDeadline = Date.now() + 2_500;
      while (Date.now() <= fallbackDeadline) {
        throwIfAborted(signal);
        if (await dom.exists(manual)) {
          await clickManualCaptionsAdd(dom, signal);
          return;
        }
        if (await dom.exists(auto)) {
          const open = await captionsEditorEntryOpenForLang(dom, lang);
          if (open === "match") {
            return;
          }
          if (open === "mismatch" || open === "unknown") {
            throw new UiMismatchError(
              `Captions editor language not bound to ${lang.code} after language-name open`,
            );
          }
        }
        await abortableDelay(50, signal);
      }
    }
  }

  if (humanGate) {
    const decision = await humanGate.request(
      {
        capability: "WRITE_COMMIT",
        title: "Hover captions cell",
        description: `Hover the captions cell (or open the editor) for ${lang.label} (${lang.code}), then Continue.`,
        consequences: [
          "Luftballons could not stamp #captions-add via synthetic hover",
          `Continue only after the ${lang.label} captions editor is open OR #captions-add is visible`,
        ],
        reversible: false,
      },
      signal,
    );
    if (decision === "REJECTED") {
      throw new UiMismatchError(`Human declined hover assist for ${lang.code}`);
    }
    assertBinding();
    const open = await captionsEditorEntryOpenForLang(dom, lang);
    if (open === "match") {
      return;
    }
    if (open === "mismatch" || open === "unknown") {
      throw new UiMismatchError(
        `Open captions editor is not confirmed for ${lang.code}; refusing to continue`,
      );
    }
    const listAfter = await resolveList();
    const rowAfter = await findUniqueLanguageRow(listAfter, lang);
    const cellAfter = rowAfter ? findCaptionsCell(rowAfter) : null;
    const addAfter = cellAfter ? findUniqueCaptionsAddInCell(cellAfter) : null;
    if (addAfter instanceof HTMLElement) {
      addAfter.click();
      return;
    }
    if (await tryHoverAndClick()) {
      return;
    }
  }

  throw new WaitTimeoutError(
    `Captions add (#captions-add) not found for ${lang.code} after hover`,
  );
}

/**
 * Open an existing draft track via captions-cell edit control (shared hover helper).
 */
async function revealAndClickCaptionsEdit(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  assertBinding: () => void,
): Promise<boolean> {
  throwIfAborted(signal);
  assertBinding();
  const list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
  if (!list || !isActiveElement(list)) {
    return false;
  }
  const row = await findUniqueLanguageRow(list, lang);
  if (!row) {
    return false;
  }
  const captionsCell = findCaptionsCell(row);
  if (!captionsCell) {
    return false;
  }
  return hoverCaptionsCellAndAct(
    captionsCell,
    lang,
    signal,
    assertBinding,
    findCaptionsEditInCell,
    async (edit) => {
      if (edit instanceof HTMLElement) {
        edit.click();
      } else {
        edit.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    },
  );
}

async function clickManualCaptionsAdd(
  dom: CancellableDomService,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const target = getSubtitleTarget("subtitle.manual_captions_add");
  try {
    await dom.waitFor(target, 3_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError("手动字幕 Add control did not appear");
  }
  await dom.click(target);
}

/**
 * Unique captions editor bound to `lang`. No lang evidence → not accepted.
 */
function activeCaptionsEditorRoot(lang: SubtitleLanguage): Element | null {
  const scoped = listActiveCaptionsEditors();
  const matches = scoped.filter(
    (el) => editorLanguageBinding(el, lang) === "match",
  );
  if (matches.length === 1) {
    return matches[0]!;
  }
  return null;
}

/**
 * DOM scoped to the language-bound editor (or its parent surface that holds actions).
 * If no editor chrome yet (post-add options), allow page-level actions only when
 * no open editor is mismatched/unknown for `lang`.
 */
function actionDomForLanguage(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
): CancellableDomService {
  const root = activeCaptionsEditorRoot(lang);
  if (root) {
    const hasActions =
      root.querySelector(
        '[data-luftballons-target="subtitle.auto_translate"], #choose-auto-translate, [data-luftballons-target="subtitle.publish"], button[aria-label="发布"], button[aria-label="Publish"]',
      ) !== null;
    if (hasActions) {
      return scopedDom(root);
    }
    const parent = root.parentElement;
    if (parent) {
      return scopedDom(parent);
    }
    return scopedDom(root);
  }

  const open = listActiveCaptionsEditors();
  for (const el of open) {
    const binding = editorLanguageBinding(el, lang);
    if (binding !== "match") {
      throw new UiMismatchError(
        `Captions editor not uniquely bound to ${lang.code}; refusing auto-translate/publish`,
      );
    }
  }
  // No captions editor panel yet (list-row add → options) — page-level controls OK.
  return dom;
}

function captionsContentReadyInRoot(root: Element): boolean {
  if (root.getAttribute("data-luftballons-captions-ready") === "true") {
    return true;
  }
  const markers = querySelectorAllDeep(
    root,
    [
      '[data-luftballons-captions-ready="true"]',
      "ytve-timedtext-segment",
      ".cue-text",
      ".timedtext-text",
      "ytve-captions-editor-timeline",
      "ytve-timedtext-list",
      "[contenteditable='true']",
      "textarea",
      "ytve-drafts-list",
      "[class*='cue']",
      "[class*='timedtext']",
    ].join(", "),
  );
  for (const el of markers) {
    if (!isActiveElement(el)) {
      continue;
    }
    if (el.getAttribute("data-luftballons-captions-ready") === "true") {
      return true;
    }
    const value =
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
        ? el.value
        : (el.textContent ?? "");
    const text = value.replace(/\s+/g, " ").trim();
    // Cue body may legitimately contain words like "Loading" — do not treat as chrome.
    if (
      text.length >= 2 &&
      !/字幕空白|无法发布空白|自动翻译|选择方式|添加语言/i.test(text)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Busy only from explicit status / loading chrome — never full editor textContent
 * (cue bodies can say "We are processing your order").
 */
function editorRootLooksBusy(root: Element): boolean {
  if (root.getAttribute("aria-busy") === "true") {
    return true;
  }
  const statusNodes = querySelectorAllDeep(
    root,
    [
      '[aria-busy="true"]',
      '[role="status"]',
      '[role="progressbar"]',
      '[data-luftballons-translate-status]',
      ".loading-spinner",
      '[class*="spinner"]',
      '[class*="progress"]',
      '[class*="Spinner"]',
      '[class*="Progress"]',
    ].join(", "),
  );
  for (const el of statusNodes) {
    if (!isActiveElement(el) || (el as HTMLElement).hidden) {
      continue;
    }
    if (el.getAttribute("aria-busy") === "true") {
      return true;
    }
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (
      t.length > 0 &&
      /正在翻译|Translating|Loading|处理中|Processing/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

function hasLanguageScopedReadyMarker(lang: SubtitleLanguage): boolean {
  const readyNodes = querySelectorAllDeep(
    document,
    `[data-luftballons-captions-ready="true"][data-language-code="${lang.code}"], [data-luftballons-captions-ready="true"][data-luftballons-subtitle-lang="${lang.code}"]`,
  ).filter(isActiveElement);
  if (readyNodes.length === 1) {
    return true;
  }
  const anyReady = querySelectorAllDeep(
    document,
    '[data-luftballons-captions-ready="true"]',
  ).filter((el) => {
    if (!isActiveElement(el)) {
      return false;
    }
    const code =
      el.getAttribute("data-language-code") ??
      el.getAttribute("data-luftballons-subtitle-lang");
    return !code || code.toLowerCase() === lang.code.toLowerCase();
  });
  return anyReady.length === 1;
}

/**
 * Single state machine for fixture + live. Publish enabled alone is never READY.
 */
export async function classifyTranslatePhase(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
): Promise<CaptionsTranslatePhase> {
  if (await blankPublishErrorVisible(dom)) {
    return "ERROR";
  }
  if (hasLanguageScopedReadyMarker(lang)) {
    return "READY";
  }
  const root = activeCaptionsEditorRoot(lang);
  if (root && editorRootLooksBusy(root)) {
    return "TRANSLATING";
  }
  if (root && captionsContentReadyInRoot(root)) {
    return "READY";
  }
  const publishEnabled = await dom.exists(getSubtitleTarget("subtitle.publish"));
  if (!publishEnabled) {
    return "TRANSLATING";
  }
  if (!root) {
    return "UNKNOWN";
  }
  // Publish enabled but no reliable cue signal — not READY.
  return "UNKNOWN";
}

/**
 * Wait until captions are READY (cue/marker evidence only).
 * On timeout: optional Human Gate then one re-check; still not READY → refuse publish.
 */
export async function waitUntilCaptionsReady(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  timeoutMs: number = CAPTIONS_READY_TIMEOUT_MS,
  humanGate?: HumanGateService,
): Promise<void> {
  const waitLoop = async (budgetMs: number): Promise<boolean> => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() <= deadline) {
      throwIfAborted(signal);
      const phase = await classifyTranslatePhase(dom, lang);
      if (phase === "READY") {
        await abortableDelay(120, signal);
        if ((await classifyTranslatePhase(dom, lang)) === "READY") {
          return true;
        }
        continue;
      }
      if (phase === "ERROR") {
        throw new UiMismatchError(
          "Studio captions error while waiting for translate ready",
        );
      }
      await abortableDelay(100, signal);
    }
    return false;
  };

  if (await waitLoop(timeoutMs)) {
    return;
  }

  if (humanGate) {
    const decision = await humanGate.request(
      {
        capability: "WRITE_COMMIT",
        title: "Confirm captions translation ready",
        description: `Studio did not expose a reliable READY signal for ${lang.label} (${lang.code}). Continue only when translation looks finished in the editor.`,
        consequences: [
          "Publish will be refused if cues are still missing after Continue",
          "Do not Continue while「正在翻译」is visible",
        ],
        reversible: false,
      },
      signal,
    );
    if (decision === "REJECTED") {
      throw new WaitTimeoutError(
        `Captions not READY for ${lang.code}; human declined ready confirm`,
      );
    }
    if (await waitLoop(1_500)) {
      return;
    }
  }

  throw new WaitTimeoutError(
    `Captions not READY for ${lang.code} within ${timeoutMs}ms (refusing to publish)`,
  );
}

async function blankPublishErrorVisible(
  dom: CancellableDomService,
): Promise<boolean> {
  return dom.exists(getSubtitleTarget("subtitle.publish.blank_error"));
}

async function autoTranslateAndPublish(
  dom: CancellableDomService,
  deps: SubtitleWorkflowDeps,
  signal: AbortSignal,
  assertBinding: () => void,
  lang: SubtitleLanguage,
  opts?: { skipAutoTranslateClick?: boolean },
  humanGate?: HumanGateService,
): Promise<void> {
  throwIfAborted(signal);
  assertBinding();

  const actionDom = actionDomForLanguage(dom, lang);

  if (!opts?.skipAutoTranslateClick) {
    const auto = getSubtitleTarget("subtitle.auto_translate");
    try {
      await actionDom.waitFor(auto, 5_000, signal);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        throw error;
      }
      throw new WaitTimeoutError("自动翻译 control did not appear");
    }
    await actionDom.click(auto);
    throwIfAborted(signal);
    assertBinding();
  }

  const publish = getSubtitleTarget("subtitle.publish");
  try {
    await actionDom.waitFor(publish, 8_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError(
      "Publish (发布) did not become available after 自动翻译",
    );
  }

  await waitUntilCaptionsReady(dom, lang, signal, CAPTIONS_READY_TIMEOUT_MS, humanGate);
  throwIfAborted(signal);
  assertBinding();
  if (!(await actionDom.exists(publish))) {
    throw new WaitTimeoutError(
      "Publish (发布) disappeared while waiting for captions READY",
    );
  }

  const observeAfterClick = async (): Promise<"ok" | "blank" | "error"> => {
    // Bound window for blank/error toast only; success verified by waitForPublishedRow.
    const deadline = Date.now() + Math.min(PUBLISH_OBSERVE_MS, 1_500);
    while (Date.now() <= deadline) {
      throwIfAborted(signal);
      if (await blankPublishErrorVisible(dom)) {
        return "blank";
      }
      const publishErr = await actionDom.find({
        id: "subtitle.publish.error",
        selectorFallback: [
          '[data-luftballons-target="subtitle.publish"][data-publish-error="true"]',
          'button[aria-label="Publish"][data-publish-error="true"]',
          'button[aria-label="发布"][data-publish-error="true"]',
        ],
        matches: isActiveElement,
      });
      if (publishErr) {
        return "error";
      }
      const list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
      if (list) {
        const row = await findUniqueLanguageRow(list, lang);
        if (row && isCaptionsPublishedState(rowStateFromElement(row))) {
          return "ok";
        }
      }
      await abortableDelay(50, signal);
    }
    return "ok";
  };

  deps.onPublishAttempt?.();
  await actionDom.click(publish);
  let outcome = await observeAfterClick();
  if (outcome === "error") {
    throw new UiMismatchError("Publish control reported an error after click");
  }
  if (outcome === "blank") {
    await waitUntilCaptionsReady(
      dom,
      lang,
      signal,
      TRANSLATE_RETRY_SETTLE_MS,
      humanGate,
    );
    throwIfAborted(signal);
    assertBinding();
    if (!(await actionDom.exists(publish))) {
      throw new UiMismatchError(
        "Studio rejected publish: blank captions (无法发布空白字幕)",
      );
    }
    deps.onPublishAttempt?.();
    await actionDom.click(publish);
    outcome = await observeAfterClick();
    if (outcome === "blank" || outcome === "error") {
      throw new UiMismatchError(
        "Studio rejected publish: blank captions (无法发布空白字幕)",
      );
    }
  }
}

/**
 * Select language from picker, then complete captions entry + auto-translate + publish.
 * Layout A: list row → hover #captions-add. Layout B: 手动字幕 dialog Add.
 */
async function addTranslateAndPublishLanguage(
  dom: CancellableDomService,
  deps: SubtitleWorkflowDeps,
  lang: SubtitleLanguage,
  signal: AbortSignal,
  assertBinding: () => void,
  humanGate?: HumanGateService,
): Promise<void> {
  throwIfAborted(signal);
  assertBinding();
  const editor = await requireEditor(dom);
  const editorDom = scopedDom(editor);

  const addBtn = getSubtitleTarget("subtitle.add_language");
  const addRoot = (await dom.exists(addBtn)) ? dom : editorDom;
  if (!(await addRoot.exists(addBtn))) {
    throw new UiMismatchError(
      `Add-language control missing (assumption target "${addBtn.id}"; not in page or editor)`,
    );
  }
  assertBinding();
  if (!editor.isConnected || !isActiveElement(editor)) {
    throw new UiMismatchError("Editor detached or inactive");
  }
  await addRoot.click(addBtn);
  throwIfAborted(signal);

  const pickerTarget = getSubtitleTarget("subtitle.language.picker");
  let picker: Element;
  try {
    picker = await dom.waitFor(pickerTarget, 2_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    try {
      picker = await editorDom.waitFor(pickerTarget, 500, signal);
    } catch (inner) {
      if (isAbortError(inner) || signal.aborted) {
        throw inner;
      }
      throw new WaitTimeoutError(
        'Language picker did not appear after Add language (assumption "subtitle.language.picker")',
      );
    }
  }

  let found: Element;
  try {
    found = await findLanguageOption(picker, lang, signal, 3_000);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError(
      `Language option not ready for ${lang.code} inside open picker`,
    );
  }

  throwIfAborted(signal);
  assertBinding();
  if (
    !editor.isConnected ||
    !picker.isConnected ||
    !found.isConnected ||
    !isActiveElement(found)
  ) {
    throw new UiMismatchError("Picker/option no longer active");
  }
  if (found instanceof HTMLElement) {
    found.click();
  } else {
    found.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }
  throwIfAborted(signal);

  const surface = await waitCaptionsEntrySurface(dom, editorDom, lang, signal);
  try {
    await waitPickerClosed(dom, signal, 1_500);
  } catch {
    try {
      await waitPickerClosed(editorDom, signal, 500);
    } catch {
      /* Layout B may keep chrome; continue */
    }
  }

  assertBinding();
  if (surface === "manual_dialog") {
    await clickManualCaptionsAdd(dom, signal);
  } else {
    await revealAndClickCaptionsAdd(
      dom,
      lang,
      signal,
      assertBinding,
      humanGate,
    );
  }
  await autoTranslateAndPublish(
    dom,
    deps,
    signal,
    assertBinding,
    lang,
    undefined,
    humanGate,
  );
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

  const assertBinding = (): void => {
    const check = recheckVideoBinding(deps, videoId);
    if (!check.ok) throw new UiMismatchError(check.message);
  };

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

  // 4) diff: captions-cell scoped (never treat metadata「已发布」as skip)
  type WorkMode = "add" | "resume_captions" | "resume_draft";
  type WorkItem = { lang: SubtitleLanguage; mode: WorkMode };
  const workItems: WorkItem[] = [];
  const outcomes: LanguageOutcome[] = [];

  for (const lang of targets) {
    throwIfAborted(ctx.signal);
    const row = rowByCode.get(lang.code.toLowerCase());
    if (!row) {
      workItems.push({ lang, mode: "add" });
      continue;
    }
    if (row.state === "UNPARSEABLE") {
      return {
        status: "FAILED",
        summary: `Subtitle captions state unparseable for ${lang.code}; refusing to skip or write.`,
        warnings: [
          {
            code: "SUBTITLE_CAPTIONS_UNPARSEABLE",
            message: `Target ${lang.code}: captions cell status could not be read (not metadata)`,
          },
        ],
      };
    }
    if (isCaptionsPublishedState(row.state)) {
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "SKIPPED",
        detail: "Captions already published",
      });
      continue;
    }
    if (row.state === "CAPTIONS_DRAFT") {
      workItems.push({ lang, mode: "resume_draft" });
      continue;
    }
    // CAPTIONS_MISSING / PENDING_PUBLISH
    if (needsCaptionsResume(row.state)) {
      workItems.push({ lang, mode: "resume_captions" });
      continue;
    }
    // EXISTS legacy → treat as unparseable (do not skip)
    return {
      status: "FAILED",
      summary: `Unrecognized subtitle row state for ${lang.code}; fail-closed.`,
      warnings: [
        {
          code: "SUBTITLE_CAPTIONS_UNPARSEABLE",
          message: `Target ${lang.code}: state=${row.state}`,
        },
      ],
    };
  }

  // Re-run / idempotent path: nothing to do → no WRITE_COMMIT
  if (workItems.length === 0) {
    const summary: SubtitleMultilangSummary = {
      videoId,
      outcomes: outcomes.map((o) =>
        o.status === "SKIPPED"
          ? { ...o, status: "EXISTS", detail: "Captions already published" }
          : o,
      ),
      published: false,
      humanRejected: false,
    };
    return buildResult(summary, warnings);
  }

  // 5) Human Gate once, then per-language work
  const workQueue = workItems;

  ctx.capabilities.require("WRITE_REVERSIBLE");
  ctx.capabilities.require("WRITE_COMMIT");
  const consequenceLines = workQueue.map(
    (w) => `${w.lang.label} (${w.lang.code}) [${w.mode}]`,
  );
  ctx.setProgress("Waiting for human confirmation…", "WAITING_HUMAN");
  const decision = await ctx.humanGate.request(
    {
      capability: "WRITE_COMMIT",
      title: "Publish subtitle languages",
      description: `Add & publish the following subtitle languages on video ${videoId} via Studio auto-translate. This action cannot be undone from Luftballons.`,
      consequences: [
        ...consequenceLines,
        "不可撤销 / irreversible WRITE_COMMIT",
        "Languages are processed one-at-a-time (Studio card / hover-add path)",
      ],
      reversible: false,
    },
    ctx.signal,
  );

  if (ctx.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  ctx.setProgress("Resuming…", "RUNNING");

  if (decision === "REJECTED") {
    for (const item of workQueue) {
      outcomes.push({
        code: item.lang.code,
        label: item.lang.label,
        status: "CANCELLED",
        detail: "Human Gate REJECTED — not published",
      });
    }
    return buildResult(
      {
        videoId,
        outcomes,
        published: false,
        humanRejected: true,
      },
      warnings,
    );
  }

  let publishedAny = false;
  for (let i = 0; i < workQueue.length; i++) {
    const item = workQueue[i]!;
    const lang = item.lang;
    throwIfAborted(ctx.signal);
    const before = recheckVideoBinding(deps, videoId);
    if (!before.ok) {
      return bindingFailureResult(videoId, before, warnings, outcomes);
    }
    ctx.setProgress(`Adding & publishing ${lang.label}…`, "RUNNING");
    try {
      if (item.mode === "add") {
        await addTranslateAndPublishLanguage(
          deps.dom,
          deps,
          lang,
          ctx.signal,
          assertBinding,
          ctx.humanGate,
        );
      } else if (item.mode === "resume_captions") {
        try {
          await revealAndClickCaptionsAdd(
            deps.dom,
            lang,
            ctx.signal,
            assertBinding,
            ctx.humanGate,
          );
        } catch {
          await clickManualCaptionsAdd(deps.dom, ctx.signal);
        }
        await autoTranslateAndPublish(
          deps.dom,
          deps,
          ctx.signal,
          assertBinding,
          lang,
          undefined,
          ctx.humanGate,
        );
      } else {
        // resume_draft: open via edit (not #captions-add); wait if loading; no blind re-translate
        const openedEdit = await revealAndClickCaptionsEdit(
          deps.dom,
          lang,
          ctx.signal,
          assertBinding,
        );
        if (!openedEdit) {
          try {
            await revealAndClickCaptionsAdd(
              deps.dom,
              lang,
              ctx.signal,
              assertBinding,
              ctx.humanGate,
            );
          } catch {
            await clickManualCaptionsAdd(deps.dom, ctx.signal);
          }
        }
        let phase = await classifyTranslatePhase(deps.dom, lang);
        const autoVisibleEarly = await deps.dom.exists(
          getSubtitleTarget("subtitle.auto_translate"),
        );
        // Wait only while loading/busy — not when the empty options panel is already open.
        if (
          phase === "TRANSLATING" ||
          (phase === "UNKNOWN" && !autoVisibleEarly)
        ) {
          await waitUntilCaptionsReady(
            deps.dom,
            lang,
            ctx.signal,
            CAPTIONS_READY_TIMEOUT_MS,
            ctx.humanGate,
          );
          phase = await classifyTranslatePhase(deps.dom, lang);
        }
        if (phase === "ERROR") {
          throw new UiMismatchError(
            `Draft editor error for ${lang.code} before publish`,
          );
        }
        const publishEnabled = await deps.dom.exists(
          getSubtitleTarget("subtitle.publish"),
        );
        const autoVisible = await deps.dom.exists(
          getSubtitleTarget("subtitle.auto_translate"),
        );
        if (phase === "READY" && publishEnabled) {
          await autoTranslateAndPublish(
            deps.dom,
            deps,
            ctx.signal,
            assertBinding,
            lang,
            { skipAutoTranslateClick: true },
            ctx.humanGate,
          );
        } else if (autoVisible) {
          // Options panel / empty track entry — one translate allowed.
          await autoTranslateAndPublish(
            deps.dom,
            deps,
            ctx.signal,
            assertBinding,
            lang,
            undefined,
            ctx.humanGate,
          );
        } else {
          throw new UiMismatchError(
            `Draft for ${lang.code} not READY after wait (refusing blind re-translate)`,
          );
        }
      }
      const publishedOk = await waitForPublishedRow(
        deps.dom,
        lang,
        ctx.signal,
        assertBinding,
      );
      if (!publishedOk) {
        throw new UiMismatchError(
          `Publish clicked but captions PUBLISHED state not observed for ${lang.code}`,
        );
      }
      outcomes.push({
        code: lang.code,
        label: lang.label,
        status: "SUCCESS",
        detail: "Added + auto-translated + published",
      });
      publishedAny = true;
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "language write failed";
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
      warnings.push({ code, message: `${lang.code}: ${message}` });
      for (const rest of workQueue.slice(i + 1)) {
        outcomes.push({
          code: rest.lang.code,
          label: rest.lang.label,
          status: "CANCELLED",
          detail: "Stopped after prior language wait/UI failure",
        });
      }
      return {
        status: "FAILED",
        summary: `Subtitle workflow stopped; pending changes retained. ${formatOutcomesSummary(outcomes)}`,
        warnings,
      };
    }
  }

  throwIfAborted(ctx.signal);
  const afterPublishBind = recheckVideoBinding(deps, videoId);
  if (!afterPublishBind.ok) {
    return bindingFailureResult(videoId, afterPublishBind, warnings, outcomes);
  }

  return buildResult(
    {
      videoId,
      outcomes,
      published: publishedAny,
      humanRejected: false,
    },
    warnings,
  );
}
