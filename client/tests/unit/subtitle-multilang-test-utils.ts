/**
 * Shared helpers for Phase 4 subtitle.multilang module tests.
 */

import { createDomService } from "../../src/services/dom-service.js";
import { createNavigationService } from "../../src/sites/youtube-studio/navigation.js";
import {
  createSubtitleMultilangModule,
  type SubtitleMultilangModule,
} from "../../src/sites/youtube-studio/modules/subtitle-multilang/module.js";
import type { SubtitleLanguage } from "../../src/sites/youtube-studio/modules/subtitle-multilang/schema.js";
import type { HumanGateAction, HumanGateService } from "../../src/runtime/types.js";
import type { StudioFixtureHandle } from "../fixtures/studio-simulated.js";

export function createFixtureSubtitleModule(
  fixture: StudioFixtureHandle,
  overrides: {
    initialLanguages?: SubtitleLanguage[];
    onPublishAttempt?: () => void;
  } = {},
): SubtitleMultilangModule {
  const dom = createDomService();
  const navigation = createNavigationService({
    dom,
    getHref: () => fixture.href,
    setHref: (href) => {
      const page = href.includes("/analytics")
        ? "ANALYTICS"
        : href.includes("/videos") || href.includes("/content")
          ? "CONTENT"
          : href.includes("/translations") || href.includes("/subtitles")
            ? "SUBTITLES"
            : href.includes("/edit") || href.includes("/video/")
              ? "VIDEO_DETAILS"
              : "DASHBOARD";
      fixture.setPage(page);
    },
    defaultTimeoutMs: 500,
  });
  return createSubtitleMultilangModule({
    dom,
    navigation,
    getHref: () => fixture.href,
    detectDocument: document,
    ...overrides,
  });
}

/** Controllable Human Gate for P4-T2 / P4-T3. */
export function createDeferredHumanGate(): HumanGateService & {
  pending: Promise<"APPROVED" | "REJECTED"> | null;
  resolve(decision: "APPROVED" | "REJECTED"): void;
  lastAction: HumanGateAction | null;
} {
  let resolveFn: ((d: "APPROVED" | "REJECTED") => void) | null = null;
  const gate = {
    pending: null as Promise<"APPROVED" | "REJECTED"> | null,
    lastAction: null as HumanGateAction | null,
    resolve(decision: "APPROVED" | "REJECTED"): void {
      resolveFn?.(decision);
      resolveFn = null;
    },
    async request(
      action: HumanGateAction,
      signal?: AbortSignal,
    ): Promise<"APPROVED" | "REJECTED"> {
      gate.lastAction = action;
      if (signal?.aborted) {
        return "REJECTED";
      }
      gate.pending = new Promise<"APPROVED" | "REJECTED">((resolve) => {
        resolveFn = resolve;
        const onAbort = (): void => {
          resolve("REJECTED");
          resolveFn = null;
          signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return gate.pending;
    },
  };
  return gate;
}

export function createAutoApproveGate(): HumanGateService {
  return {
    async request(_action, signal) {
      if (signal?.aborted) {
        return "REJECTED";
      }
      return "APPROVED";
    },
  };
}

export function createAutoRejectGate(): HumanGateService {
  return {
    async request(_action, signal) {
      if (signal?.aborted) {
        return "REJECTED";
      }
      return "REJECTED";
    },
  };
}
