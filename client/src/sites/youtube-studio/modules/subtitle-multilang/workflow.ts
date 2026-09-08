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
  labelAliasesForLanguage,
  pickerFilterQueryForLanguage,
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
    el.querySelector(".tablecell-language, [class*='language']") ?? el;
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
  const seen = new Set<Element>();
  const rows: Element[] = [];

  // calibrated 2026-09-08: translations list is an HTML table
  if (list instanceof HTMLTableElement || list.id === "ytgn-video-translations-list-table") {
    for (const el of list.querySelectorAll("tbody tr")) {
      if (!(el instanceof Element) || seen.has(el)) {
        continue;
      }
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!label || /^语言\b/.test(label)) {
        continue;
      }
      seen.add(el);
      rows.push(el);
    }
    if (rows.length > 0) {
      return rows;
    }
  }

  const itemSel =
    typeof SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback ===
    "string"
      ? SUBTITLE_TARGETS["subtitle.language.item"].selectorFallback
      : '[data-luftballons-subtitle-lang], [data-language-code]';

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

async function waitForPublishedRow(
  dom: CancellableDomService,
  langCode: string,
  signal: AbortSignal,
  timeoutMs = 2_000,
): Promise<boolean> {
  throwIfAborted(signal);
  const target: DomTarget = {
    id: `subtitle.language.published.${langCode}`,
    selectorFallback: [
      `[data-luftballons-subtitle-lang="${langCode}"][data-subtitle-state="PUBLISHED"]`,
      `[data-language-code="${langCode}"][data-subtitle-published="true"]`,
      `[data-language-code="${langCode}"][data-subtitle-state="PUBLISHED"]`,
      '[data-subtitle-state="PUBLISHED"]',
      "[data-luftballons-subtitle-row]",
      "tbody tr",
      "tr",
    ],
    matches: (el) => {
      if (!isActiveElement(el)) {
        return false;
      }
      if (rowStateFromElement(el) !== "PUBLISHED") {
        return false;
      }
      const mapped = languageCodeFromElement(el);
      return mapped.code?.toLowerCase() === langCode.toLowerCase();
    },
    unique: true,
  };
  try {
    await dom.waitFor(target, timeoutMs, signal);
    return true;
  } catch {
    throwIfAborted(signal);
    const rows = await readLanguageRows(dom);
    return !!rows?.some(
      (r) =>
        r.code.toLowerCase() === langCode.toLowerCase() &&
        r.state === "PUBLISHED",
    );
  }
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
 * Find #captions-add inside a language row (light + open shadow).
 * Visibility ignored — Studio may keep it CSS-hidden without real :hover.
 */
function findCaptionsAddInRow(row: Element): Element | null {
  const selectors = [
    '[data-luftballons-target="subtitle.captions_add"]',
    "ytcp-icon-button#captions-add",
    "#captions-add",
  ];
  for (const sel of selectors) {
    const hits = querySelectorAllDeep(row, sel).filter((el) => {
      if (
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true"
      ) {
        return false;
      }
      return (
        el.id === "captions-add" ||
        el.getAttribute("data-luftballons-target") === "subtitle.captions_add"
      );
    });
    if (hits.length === 0) {
      continue;
    }
    const inCaptions = hits.find((el) =>
      el.closest(
        "ytgn-video-translation-cell-captions, .tablecell-captions, ytgn-video-translation-hover-cell",
      ),
    );
    return inCaptions ?? hits[0] ?? null;
  }
  return null;
}

function captionsHoverHosts(row: Element): Element[] {
  const hosts: Element[] = [];
  const captionsCell =
    row.querySelector("ytgn-video-translation-cell-captions") ??
    row.querySelector(".tablecell-captions");
  if (captionsCell) {
    hosts.push(captionsCell);
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
  } else {
    const hoverCell = row.querySelector("ytgn-video-translation-hover-cell");
    if (hoverCell) {
      hosts.push(hoverCell);
      const cellContainer = hoverCell.querySelector("#cell-container");
      if (cellContainer) {
        hosts.push(cellContainer);
      }
    }
  }
  if (hosts.length === 0) {
    hosts.push(row);
  }
  return hosts;
}

async function revealAndClickCaptionsAdd(
  dom: CancellableDomService,
  lang: SubtitleLanguage,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  let list = await dom.find(getSubtitleTarget("subtitle.languages.list"));
  if (!list) {
    const editor = await requireEditor(dom);
    list = await scopedDom(editor).find(
      getSubtitleTarget("subtitle.languages.list"),
    );
  }
  if (!list) {
    throw new UiMismatchError("Language list missing for captions-add");
  }

  const labelAliases = labelAliasesForLanguage(lang);
  let row: Element | null = null;
  const candidates = Array.from(
    list.querySelectorAll(
      "tbody tr, tr#row-container, tr, [data-luftballons-subtitle-row], ytgn-video-translation-row",
    ),
  );
  for (const el of candidates) {
    if (!(el instanceof Element)) {
      continue;
    }
    const mapped = languageCodeFromElement(el);
    if (mapped.code?.toLowerCase() === lang.code.toLowerCase()) {
      row = el;
      break;
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
        row = el;
        break;
      }
    }
    if (row) {
      break;
    }
  }
  if (!row) {
    throw new UiMismatchError(
      `Language row for ${lang.code} not found for captions-add`,
    );
  }

  // Force-show hover controls if Studio stamped them but CSS :hover keeps them hidden.
  const forceStyle = row.ownerDocument.createElement("style");
  forceStyle.setAttribute("data-luftballons-captions-hover", "true");
  forceStyle.textContent = `
    ytgn-video-translation-hover-cell .hover-button,
    ytgn-video-translation-hover-cell #captions-add,
    #cell-container #captions-add,
    #captions-add.hover-button {
      display: inline-flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;
  row.ownerDocument.head.append(forceStyle);

  try {
    const deadline = Date.now() + 2_500;
    let captionsAdd: Element | null = null;
    while (Date.now() <= deadline) {
      throwIfAborted(signal);
      for (const host of captionsHoverHosts(row)) {
        if (host instanceof HTMLElement) {
          host.setAttribute("hovered", "");
          host.classList.add("hovered");
          try {
            (host as HTMLElement & { hovered?: boolean }).hovered = true;
          } catch {
            /* ignore */
          }
          const rect = host.getBoundingClientRect();
          const cx = rect.left + Math.max(rect.width / 2, 1);
          const cy = rect.top + Math.max(rect.height / 2, 1);
          const moveInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: host.ownerDocument.defaultView ?? window,
            clientX: cx,
            clientY: cy,
            screenX: cx,
            screenY: cy,
          };
          host.dispatchEvent(new MouseEvent("mousemove", moveInit));
        }
        simulatePointerHover(host);
      }
      captionsAdd = findCaptionsAddInRow(row);
      if (captionsAdd) {
        break;
      }
      await abortableDelay(50, signal);
    }
    if (!captionsAdd) {
      // Fallback: open language details (some Layout A builds / Layout B hybrid).
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
            return;
          }
          await abortableDelay(50, signal);
        }
      }
      throw new WaitTimeoutError(
        `Captions add (#captions-add) not found for ${lang.code} after hover`,
      );
    }
    if (captionsAdd instanceof HTMLElement) {
      captionsAdd.style.visibility = "visible";
      captionsAdd.style.opacity = "1";
      captionsAdd.style.pointerEvents = "auto";
      captionsAdd.click();
    } else {
      captionsAdd.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  } finally {
    forceStyle.remove();
  }
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

async function captionsContentReady(
  dom: CancellableDomService,
): Promise<boolean> {
  const ready = getSubtitleTarget("subtitle.captions.ready");
  if (await dom.exists(ready)) {
    return true;
  }
  // Deep scan: Studio cues may sit in open shadow roots.
  const root = document;
  const markers = querySelectorAllDeep(
    root,
    [
      '[data-luftballons-captions-ready="true"]',
      "ytve-timedtext-segment",
      ".cue-text",
      ".timedtext-text",
      "ytve-captions-editor-timeline",
      "ytve-timedtext-list",
    ].join(", "),
  );
  for (const el of markers) {
    if (el.getAttribute("data-luftballons-captions-ready") === "true") {
      return true;
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (
      text.length >= 2 &&
      !/字幕空白|无法发布空白|自动翻译|选择方式/i.test(text)
    ) {
      return true;
    }
  }
  const editables = querySelectorAllDeep(
    root,
    [
      "ytve-captions-editor [contenteditable='true']",
      "ytve-timedtext-editor [contenteditable='true']",
      "ytve-captions-editor textarea",
      "ytve-timedtext-editor textarea",
      "[data-luftballons-captions-editor] [contenteditable='true']",
      "[data-luftballons-captions-editor] textarea",
    ].join(", "),
  );
  for (const el of editables) {
    const value =
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
        ? el.value
        : (el.textContent ?? "");
    if (value.replace(/\s+/g, " ").trim().length >= 1) {
      return true;
    }
  }
  return false;
}

/**
 * After 发布 enables, prefer a quick content signal; if Studio DOM has no
 * calibrated cue markers, settle briefly and continue (blank-publish retries).
 * Do not hard-timeout for 45s — live Layout A had no matching cue selectors.
 */
async function settleAfterAutoTranslate(
  dom: CancellableDomService,
  signal: AbortSignal,
  preferReadyMs = 2_500,
): Promise<void> {
  const deadline = Date.now() + preferReadyMs;
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    if (await captionsContentReady(dom)) {
      await abortableDelay(120, signal);
      return;
    }
    await abortableDelay(80, signal);
  }
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
): Promise<void> {
  throwIfAborted(signal);
  assertBinding();
  const auto = getSubtitleTarget("subtitle.auto_translate");
  try {
    await dom.waitFor(auto, 5_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError("自动翻译 control did not appear");
  }
  await dom.click(auto);
  throwIfAborted(signal);
  assertBinding();

  const publish = getSubtitleTarget("subtitle.publish");
  try {
    await dom.waitFor(publish, 8_000, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    throw new WaitTimeoutError("Publish (发布) did not become available after 自动翻译");
  }

  // Prefer cue/ready signal up to ~2.5s; do not hang on unknown Studio DOM.
  await settleAfterAutoTranslate(dom, signal);
  throwIfAborted(signal);
  assertBinding();
  if (!(await dom.exists(publish))) {
    throw new WaitTimeoutError(
      "Publish (发布) disappeared while waiting for captions content",
    );
  }

  const tryPublish = async (): Promise<void> => {
    deps.onPublishAttempt?.();
    await dom.click(publish);
    throwIfAborted(signal);
    const errDeadline = Date.now() + 500;
    while (Date.now() <= errDeadline) {
      throwIfAborted(signal);
      if (await blankPublishErrorVisible(dom)) {
        throw new UiMismatchError(
          "Studio rejected publish: blank captions (无法发布空白字幕)",
        );
      }
      const publishErr = await dom.find({
        id: "subtitle.publish.error",
        selectorFallback: [
          '[data-luftballons-target="subtitle.publish"][data-publish-error="true"]',
          'button[aria-label="Publish"][data-publish-error="true"]',
          'button[aria-label="发布"][data-publish-error="true"]',
        ],
        matches: isActiveElement,
      });
      if (publishErr) {
        throw new UiMismatchError("Publish control reported an error after click");
      }
      await abortableDelay(50, signal);
    }
  };

  try {
    await tryPublish();
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    if (
      !(error instanceof UiMismatchError) ||
      !/blank captions|空白字幕/i.test(error.message)
    ) {
      throw error;
    }
    // Short settle + one retry (no long cue timeout).
    await settleAfterAutoTranslate(dom, signal, 1_500);
    throwIfAborted(signal);
    assertBinding();
    if (!(await dom.exists(publish))) {
      throw error;
    }
    await tryPublish();
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
    await revealAndClickCaptionsAdd(dom, lang, signal);
  }
  await autoTranslateAndPublish(dom, deps, signal, assertBinding);
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

  // 5) Human Gate once, then per-language: add → captions (A/B) → 自动翻译 → 发布
  const workQueue: SubtitleLanguage[] = [...alreadyPending, ...toAdd];

  ctx.capabilities.require("WRITE_REVERSIBLE");
  ctx.capabilities.require("WRITE_COMMIT");
  const consequenceLines = workQueue.map((o) => `${o.label} (${o.code})`);
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
    for (const lang of workQueue) {
      const idx = outcomes.findIndex(
        (o) => o.code.toLowerCase() === lang.code.toLowerCase(),
      );
      if (idx >= 0) {
        outcomes[idx] = {
          ...outcomes[idx]!,
          status: "CANCELLED",
          detail: "Human Gate REJECTED — not published",
        };
      } else {
        outcomes.push({
          code: lang.code,
          label: lang.label,
          status: "CANCELLED",
          detail: "Human Gate REJECTED — not published",
        });
      }
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

  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (
      outcomes[i]!.status === "SUCCESS" &&
      outcomes[i]!.detail === "Added (pending publish)"
    ) {
      outcomes.splice(i, 1);
    }
  }

  let publishedAny = false;
  for (let i = 0; i < workQueue.length; i++) {
    const lang = workQueue[i]!;
    throwIfAborted(ctx.signal);
    const before = recheckVideoBinding(deps, videoId);
    if (!before.ok) {
      return bindingFailureResult(videoId, before, warnings, outcomes);
    }
    ctx.setProgress(`Adding & publishing ${lang.label}…`, "RUNNING");
    try {
      const alreadyInList = alreadyPending.some(
        (p) => p.code.toLowerCase() === lang.code.toLowerCase(),
      );
      if (alreadyInList) {
        try {
          await revealAndClickCaptionsAdd(deps.dom, lang, ctx.signal);
        } catch {
          await clickManualCaptionsAdd(deps.dom, ctx.signal);
        }
        await autoTranslateAndPublish(
          deps.dom,
          deps,
          ctx.signal,
          assertBinding,
        );
      } else {
        await addTranslateAndPublishLanguage(
          deps.dom,
          deps,
          lang,
          ctx.signal,
          assertBinding,
        );
      }
      const publishedOk = await waitForPublishedRow(
        deps.dom,
        lang.code,
        ctx.signal,
      );
      if (!publishedOk) {
        throw new UiMismatchError(
          `Publish clicked but PUBLISHED state not observed for ${lang.code}`,
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
          code: rest.code,
          label: rest.label,
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
