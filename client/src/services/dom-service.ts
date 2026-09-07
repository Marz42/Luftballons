/**
 * DomService (IMPLEMENTATION §9).
 * Modules must not scatter raw document.querySelector calls.
 *
 * Resolution priority: semantic (ariaLabel / role / text) →
 * stable attribute → CSS selectorFallback.
 */

export interface DomTarget {
  id: string;

  ariaLabel?: string;
  role?: string;
  text?: string;

  /**
   * CSS fallback(s). A string array is tried in order; first match wins.
   * Single string remains supported.
   */
  selectorFallback?: string | string[];

  /**
   * When true, callers (e.g. waitReady) may skip waiting if the target is
   * absent and rely on other postconditions instead of timing out.
   */
  optional?: boolean;
}

export interface DomService {
  find(target: DomTarget): Promise<Element | null>;

  waitFor(target: DomTarget, timeoutMs?: number): Promise<Element>;

  click(target: DomTarget): Promise<void>;

  readText(target: DomTarget): Promise<string | null>;

  exists(target: DomTarget): Promise<boolean>;
}

/**
 * Concrete DomService with AbortSignal on waitFor (task cancel must not hang).
 * §9 signature is (target, timeoutMs?); signal is an additive 3rd parameter.
 */
export interface CancellableDomService extends DomService {
  waitFor(
    target: DomTarget,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<Element>;
}

export interface CreateDomServiceOptions {
  /** Search root; defaults to document. */
  root?: ParentNode;
  defaultTimeoutMs?: number;
}

export class DomTimeoutError extends Error {
  readonly targetId: string;
  constructor(targetId: string, timeoutMs: number) {
    super(`waitFor timed out after ${timeoutMs}ms for DomTarget "${targetId}"`);
    this.name = "DomTimeoutError";
    this.targetId = targetId;
  }
}

export class DomNotFoundError extends Error {
  readonly targetId: string;
  constructor(targetId: string) {
    super(`DomTarget not found: "${targetId}"`);
    this.name = "DomNotFoundError";
    this.targetId = targetId;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function elementText(el: Element): string {
  return normalizeText(el.textContent ?? "");
}

function matchesSemantic(el: Element, target: DomTarget): boolean {
  if (target.ariaLabel !== undefined) {
    const label = el.getAttribute("aria-label");
    if (label !== target.ariaLabel) {
      return false;
    }
  }
  if (target.role !== undefined) {
    const role = el.getAttribute("role");
    const implicit =
      role ??
      (el.tagName === "A"
        ? "link"
        : el.tagName === "BUTTON"
          ? "button"
          : null);
    if (implicit !== target.role) {
      return false;
    }
  }
  if (target.text !== undefined) {
    if (elementText(el) !== normalizeText(target.text)) {
      return false;
    }
  }
  return true;
}

function hasSemantic(target: DomTarget): boolean {
  return (
    target.ariaLabel !== undefined ||
    target.role !== undefined ||
    target.text !== undefined
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Resolve element by DomTarget priority (§9 / SPEC §13).
 */
export function resolveDomTarget(
  target: DomTarget,
  root: ParentNode,
): Element | null {
  // 1) Semantic: ARIA / role / visible text
  if (hasSemantic(target)) {
    const candidates = root.querySelectorAll("*");
    for (const el of candidates) {
      if (matchesSemantic(el, target)) {
        return el;
      }
    }
  }

  // 2) Stable attribute: data-luftballons-target="<id>"
  const byStable = root.querySelector(
    `[data-luftballons-target="${cssEscape(target.id)}"]`,
  );
  if (byStable) {
    return byStable;
  }

  // 3) CSS fallback (string | string[] — try in order)
  const fallbacks = normalizeSelectorFallbacks(target.selectorFallback);
  for (const selector of fallbacks) {
    try {
      const found = root.querySelector(selector);
      if (found) {
        return found;
      }
    } catch {
      // Invalid selector → try next (fail-closed per entry)
    }
  }

  return null;
}

/** Normalize selectorFallback to an ordered list. */
export function normalizeSelectorFallbacks(
  fallback: string | string[] | undefined,
): string[] {
  if (fallback === undefined) {
    return [];
  }
  return Array.isArray(fallback) ? fallback : [fallback];
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export async function waitForDomTarget(
  target: DomTarget,
  options: {
    root: ParentNode;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<Element> {
  const { root, timeoutMs, signal } = options;
  if (signal?.aborted) {
    throw abortError();
  }

  const existing = resolveDomTarget(target, root);
  if (existing) {
    return existing;
  }

  return new Promise<Element>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      observer.disconnect();
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const settleOk = (el: Element): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(el);
    };

    const settleErr = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = (): void => {
      settleErr(abortError());
    };

    const poll = (): void => {
      const el = resolveDomTarget(target, root);
      if (el) {
        settleOk(el);
      }
    };

    const observer = new MutationObserver(poll);
    const observeTarget =
      root instanceof Document ? root.documentElement : (root as Node);
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const timer = window.setTimeout(() => {
      settleErr(new DomTimeoutError(target.id, timeoutMs));
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createDomService(
  options: CreateDomServiceOptions = {},
): CancellableDomService {
  const root = options.root ?? document;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;

  return {
    async find(target) {
      return resolveDomTarget(target, root);
    },

    async waitFor(target, timeoutMs = defaultTimeoutMs, signal?: AbortSignal) {
      return waitForDomTarget(target, {
        root,
        timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async click(target) {
      const el = resolveDomTarget(target, root);
      if (!el) {
        throw new DomNotFoundError(target.id);
      }
      if (el instanceof HTMLElement) {
        el.click();
      } else {
        el.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      }
    },

    async readText(target) {
      const el = resolveDomTarget(target, root);
      if (!el) {
        return null;
      }
      const text = elementText(el);
      return text.length > 0 ? text : null;
    },

    async exists(target) {
      return resolveDomTarget(target, root) !== null;
    },
  };
}
