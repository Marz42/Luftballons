/**
 * NavigationService for YouTube Studio (IMPLEMENTATION §10, §38).
 * Modules must not assign window.location.href directly.
 */

import { abortableDelay } from "../../modules/step-control.js";
import type { CancellableDomService } from "../../services/dom-service.js";
import { DomTimeoutError } from "../../services/dom-service.js";
import {
  detectStudio,
  type StudioPage,
} from "./page-detector.js";
import {
  extractVideoIdFromHref,
  navTargetFor,
  pageReadyTarget,
  type StudioTarget,
} from "./selectors.js";

export interface NavigationService {
  currentPage(): StudioPage;

  navigate(target: StudioTarget): Promise<void>;

  waitReady(page: StudioPage, timeoutMs?: number): Promise<void>;

  back(): Promise<void>;
}

/** Concrete service with AbortSignal on navigate / waitReady (P2-T4). */
export interface CancellableNavigationService extends NavigationService {
  navigate(target: StudioTarget, signal?: AbortSignal): Promise<void>;
  waitReady(
    page: StudioPage,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class NavigationError extends Error {
  readonly code:
    | "UNSUPPORTED_LAYOUT"
    | "WRONG_PAGE"
    | "TIMEOUT"
    | "CANCELLED"
    | "NO_ANCHOR";

  constructor(
    code: NavigationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "NavigationError";
    this.code = code;
  }
}

export interface CreateNavigationServiceOptions {
  dom: CancellableDomService;
  document?: Document;
  /** Current href; defaults to location.href. */
  getHref?: () => string;
  /**
   * Apply SPA href after anchor click when the fixture/host does not navigate.
   * Tests inject pushState; production may no-op if click handles SPA.
   */
  setHref?: (href: string) => void;
  defaultTimeoutMs?: number;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

/**
 * Automation postcondition: layout known AND URL page AND DOM page all match.
 * Distinct from detectStudio merge, which may report URL-only while SPA settles.
 */
export function pagePostcondition(
  expected: StudioPage,
  options: { href: string; document: Document },
): boolean {
  if (expected === "UNKNOWN") {
    return false;
  }
  const detection = detectStudio(options);
  if (detection.layout === "UNKNOWN") {
    return false;
  }
  return (
    detection.urlPage === expected && detection.domPage === expected
  );
}

export function createNavigationService(
  options: CreateNavigationServiceOptions,
): CancellableNavigationService {
  const doc = options.document ?? document;
  const getHref =
    options.getHref ??
    (() => (typeof location !== "undefined" ? location.href : ""));
  const setHref = options.setHref;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
  const historyStack: StudioTarget[] = [];

  const currentPage = (): StudioPage => {
    return detectStudio({ href: getHref(), document: doc }).page;
  };

  const ensureLayout = (): void => {
    const detection = detectStudio({ href: getHref(), document: doc });
    if (detection.layout === "UNKNOWN") {
      throw new NavigationError(
        "UNSUPPORTED_LAYOUT",
        "Refusing navigation: Studio layout is UNKNOWN",
      );
    }
  };

  const waitReady = async (
    page: StudioPage,
    timeoutMs = defaultTimeoutMs,
    signal?: AbortSignal,
  ): Promise<void> => {
    throwIfAborted(signal);
    if (page === "UNKNOWN") {
      throw new NavigationError(
        "WRONG_PAGE",
        "waitReady cannot target UNKNOWN",
      );
    }

    ensureLayout();

    const target = pageReadyTarget(page);
    const deadline = Date.now() + timeoutMs;

    // State wait: page feature appears + postcondition (no fixed sleep sync).
    // Optional targets (e.g. CONTENT on variant B without ytcp-video-section):
    // if absent, skip DOM wait and rely on URL postcondition.
    const existing = await options.dom.find(target);
    if (!existing) {
      if (target.optional) {
        // DOM feature unavailable — fall through to postcondition polling.
      } else {
        try {
          await options.dom.waitFor(target, timeoutMs, signal);
        } catch (err) {
          throwIfAborted(signal);
          if (err instanceof DomTimeoutError) {
            throw new NavigationError(
              "TIMEOUT",
              `waitReady timed out waiting for ${page}`,
            );
          }
          throw err;
        }
      }
    }

    throwIfAborted(signal);

    const remaining = Math.max(0, deadline - Date.now());
    const pollDeadline = Date.now() + remaining;
    while (Date.now() <= pollDeadline) {
      throwIfAborted(signal);
      if (pagePostcondition(page, { href: getHref(), document: doc })) {
        return;
      }
      if (signal) {
        await abortableDelay(20, signal);
      } else {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 20);
        });
      }
    }

    throw new NavigationError(
      "TIMEOUT",
      `waitReady postcondition failed for ${page}`,
    );
  };

  const navigate = async (
    target: StudioTarget,
    signal?: AbortSignal,
  ): Promise<void> => {
    throwIfAborted(signal);
    ensureLayout();

    const from = currentPage();
    if (from !== "UNKNOWN" && from !== target) {
      historyStack.push(from);
    }

    const href = getHref();
    const videoId =
      target === "SUBTITLES" ? extractVideoIdFromHref(href) : null;
    const navTarget = navTargetFor(target, {
      href,
      ...(videoId ? { videoId } : {}),
    });
    const el = await options.dom.find(navTarget);
    if (!el) {
      throw new NavigationError(
        "NO_ANCHOR",
        `No SPA nav anchor for ${target}`,
      );
    }

    throwIfAborted(signal);
    await options.dom.click(navTarget);
    throwIfAborted(signal);

    // Tests inject setHref to simulate SPA history. Production must not
    // forge navigation via history.pushState — waitReady fails closed.
    const hrefAttr = el.getAttribute("href");
    if (hrefAttr && setHref) {
      const next = new URL(hrefAttr, getHref()).href;
      if (next !== getHref()) {
        setHref(next);
      }
    }
  };

  const back = async (): Promise<void> => {
    ensureLayout();
    const previous = historyStack.pop();
    if (previous) {
      await navigate(previous);
      // navigate pushed current onto stack — drop the spurious entry
      historyStack.pop();
      return;
    }
    // assumption, calibrate on real device: browser-back equivalent UI
    // when no in-app stack. Prefer history.back over location mutation.
    if (typeof history !== "undefined" && history.length > 1) {
      history.back();
      return;
    }
    throw new NavigationError(
      "NO_ANCHOR",
      "back(): no navigation history and no browser history entry",
    );
  };

  return {
    currentPage,
    navigate,
    waitReady,
    back,
  };
}
