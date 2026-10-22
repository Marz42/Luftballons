/**
 * youtube.channel.basic collector workflow (IMPLEMENTATION §40–§42, SPEC §18–§19).
 * UI-only DOM reads via DomService + NavigationService — no network / private API.
 */

import type {
  TaskContext,
  TaskResult,
  TaskWarning,
} from "../../../../runtime/types.js";
import type { CancellableDomService } from "../../../../services/dom-service.js";
import { DomTimeoutError } from "../../../../services/dom-service.js";
import {
  LUFTBALLONS_SCHEMA_VERSION,
} from "../../../../services/collection-service.js";
import type { Collection } from "../../../../schemas/collection.js";
import { getOrCreateInstallation } from "../../../../schemas/installation.js";
import type {
  CancellableNavigationService,
} from "../../navigation.js";
import {
  CONTENT_VIDEO_ROW_SELECTOR,
  CONTENT_FIELDS,
  extractChannelIdFromHref,
  isActiveElement,
  getTarget,
} from "../../selectors.js";
import type { ChannelBasicData, RecentVideoSnapshot } from "./schema.js";
import {
  parseDisplayMetric,
  isDisplayPlaceholder,
  type MetricPrecision,
} from "./metrics.js";
import {
  detectContentFamily,
  parseFamilyAVideos,
  contentReady,
} from "./content-adapter.js";

export const CHANNEL_BASIC_COLLECTOR_ID = "youtube.channel.basic";
export const CHANNEL_BASIC_COLLECTOR_VERSION = 2;

export interface ChannelBasicCollectorDeps {
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
  /** Current Studio href (injected for tests). */
  getHref: () => string;
  document?: Document;
  collectionId?: string;
  installationId?: string;
  collectorVersion?: number;
  contentTimeoutMs?: number;
}

interface DraftMetrics {
  views?: number;
  viewsPrecision?: MetricPrecision;
  subscriberDelta?: number;
  subscriberDeltaPrecision?: MetricPrecision;
  periodLabel?: string;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
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

function warn(
  warnings: TaskWarning[],
  code: string,
  message: string,
): void {
  warnings.push({ code, message });
}

/**
 * Re-verify channel identity after navigation. Fail-closed when expected id is set.
 */
export function recheckChannelBinding(
  getHref: () => string,
  expectedChannelId: string,
): { ok: true } | { ok: false; message: string } {
  const current = extractChannelIdFromHref(getHref());
  if (!current) {
    return {
      ok: false,
      message: `No channel id in href=${getHref()}`,
    };
  }
  if (current !== expectedChannelId) {
    return {
      ok: false,
      message: `Expected channel=${expectedChannelId}, current=${current}`,
    };
  }
  return { ok: true };
}

function metricText(el: Element | null): string | null {
  if (!el) {
    return null;
  }
  const attr = el.getAttribute("data-metric-value");
  if (attr !== null && attr.trim().length > 0) {
    return attr.trim();
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * How a metric source read resolved.
 * - VALUE: parsed number.
 * - ABSENT: the UI itself shows no value (「—」「–」「— 无法比较」) — or, for a
 *   control that rendered EMPTY (calibrated 2026-09-07: `.subscribers-trend`
 *   is the no-value display of a real Dashboard). Legitimate absence (H5).
 * - MISSING: no such control in the DOM after the settle window — NOT a
 *   legitimate "no value" and must never silently become one (review R5).
 * - UNREADABLE: text exists but cannot be parsed.
 */
type MetricRead = "VALUE" | "ABSENT" | "UNREADABLE" | "MISSING";

function applyMetric(
  draft: DraftMetrics,
  field: "views" | "subscriberDelta",
  raw: string | null,
  warnings: TaskWarning[],
  source: string,
  controlPresent: boolean,
): MetricRead {
  const parsed = parseDisplayMetric(raw);
  if (!parsed) {
    if (raw === null || raw.trim().length === 0) {
      if (!controlPresent) {
        // review R5 (2026-10-22): "control missing" used to fall into the
        // placeholder bucket and produce a fake COMPLETE.
        warn(
          warnings,
          "METRIC_CONTROL_MISSING",
          `${field} control not found on ${source}; the page exposes no value node at all`,
        );
        return "MISSING";
      }
      // Control exists but renders blank — calibrated real-DOM no-value form.
      return "ABSENT";
    }
    // Placeholder (「—」「–」「— 无法比较」…) is "no value shown", not bad data.
    if (isDisplayPlaceholder(raw)) {
      return "ABSENT";
    }
    warn(
      warnings,
      "METRIC_UNPARSED",
      `Could not parse ${field} from ${source}: "${raw}"`,
    );
    return "UNREADABLE";
  }
  if (field === "views") {
    if (parsed.value < 0) {
      warn(warnings, "VALIDATION", `views from ${source} was negative; dropped`);
      return "UNREADABLE";
    }
    draft.views = parsed.value;
    draft.viewsPrecision = parsed.precision;
  } else {
    draft.subscriberDelta = parsed.value;
    draft.subscriberDeltaPrecision = parsed.precision;
  }
  if (parsed.precision === "DISPLAY_ROUNDED") {
    warn(
      warnings,
      "METRIC_DISPLAY_ROUNDED",
      `${field} from ${source} used UI abbreviation (precision=DISPLAY_ROUNDED, value=${parsed.value})`,
    );
  }
  return "VALUE";
}

function readVideoIdFromRow(row: Element): string | undefined {
  const attr =
    row.getAttribute("data-video-id") ??
    row.getAttribute("data-luftballons-video-id");
  if (attr && attr.trim().length > 0) {
    return attr.trim();
  }
  const links = row.querySelectorAll(CONTENT_FIELDS.title);
  if (links.length !== 1) return undefined;
  const link = links[0];
  const href = link?.getAttribute("href") ?? "";
  let pathname = href;
  try {
    pathname = new URL(href, "https://studio.youtube.com").pathname;
  } catch {
    /* keep raw href as pathname */
  }
  const match = pathname.match(/^\/video\/([^/?#]+)\/edit(?:[/?#]|$)/i);
  return match?.[1];
}

function readCell(
  row: Element,
  attr: string,
): string | null {
  const el =
    row.querySelector(`[data-luftballons-field="${attr}"]`) ??
    row.querySelector(`[data-field="${attr}"]`);
  if (el) return metricText(el);
  const selector = CONTENT_FIELDS[attr as "title" | "views" | "publishedAt"];
  if (!selector) return null;
  const cells = Array.from(row.querySelectorAll(selector)).filter(isActiveElement);
  if (cells.length !== 1) return null;
  if (attr === "publishedAt") {
    if (metricText(row.querySelector(CONTENT_FIELDS.dateType)) !== "发布日期") return null;
    return Array.from(cells[0]!.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent).join("").trim() || null;
  }
  return metricText(cells[0]!);
}

function directText(el: Element | null): string | null {
  if (!el) return null;
  return Array.from(el.childNodes).filter(n => n.nodeType === 3)
    .map(n => n.textContent).join("").trim() || null;
}

function periodDates(raw: string | null): { start: string; end: string } | undefined {
  const m = raw?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[–—-]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return undefined;
  const date = (offset: number): string | undefined => {
    const value = `${m[offset]}-${m[offset + 1]!.padStart(2, "0")}-${m[offset + 2]!.padStart(2, "0")}`;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
  };
  const start = date(1), end = date(4);
  return start && end && start <= end ? { start, end } : undefined;
}

function validateAndBuild(
  draft: {
    channelId?: string;
    channelName: string;
    periodLabel?: string;
    periodStart?: string;
    periodEnd?: string;
    views?: number;
    subscriberDelta?: number;
    recentVideos: RecentVideoSnapshot[];
  },
  warnings: TaskWarning[],
  capturedAt: string,
  absentFields: ReadonlySet<string> = new Set(),
): { data: ChannelBasicData; status: "COMPLETE" | "PARTIAL" } {
  if (!Number.isFinite(Date.parse(capturedAt))) {
    warn(warnings, "VALIDATION", "capturedAt is not a valid ISO timestamp");
  }
  if (draft.channelName.trim().length === 0) {
    warn(warnings, "CHANNEL_NAME_MISSING", "Channel name was not readable from DOM");
  }
  if (draft.views !== undefined && draft.views < 0) {
    warn(warnings, "VALIDATION", "views < 0; clearing");
    delete draft.views;
  }

  const data: ChannelBasicData = {
    channel: {
      channelName: draft.channelName,
      ...(draft.channelId !== undefined ? { channelId: draft.channelId } : {}),
    },
    period: {
      ...(draft.periodStart ? { start: draft.periodStart } : {}),
      ...(draft.periodEnd ? { end: draft.periodEnd } : {}),
      ...(draft.periodLabel !== undefined ? { label: draft.periodLabel } : {}),
    },
    summary: {
      ...(draft.views !== undefined ? { views: draft.views } : {}),
      ...(draft.subscriberDelta !== undefined
        ? { subscriberDelta: draft.subscriberDelta }
        : {}),
    },
    recentVideos: draft.recentVideos,
  };

  // Core-field completeness (SPEC §19). A metric the Studio UI itself does not
  // show (placeholder 「—」/empty) is legitimately absent — not a collection
  // failure and must not poison the status (H5).
  const missingCore =
    draft.views === undefined ||
    (draft.subscriberDelta === undefined &&
      !absentFields.has("subscriberDelta")) ||
    draft.recentVideos.length === 0 ||
    draft.channelName.trim().length === 0;

  // Warnings that evidence lost/incomplete data still force PARTIAL.
  // Informational ones (display rounding, UI-absent metrics) do not (H5).
  const lossCodes = new Set([
    "METRIC_UNPARSED",
    "VIDEO_SKIPPED",
    "VIDEO_SCOPE_PARTIAL",
    "CONTENT_LOAD_TIMEOUT",
    "ANALYTICS_PERIOD_UNKNOWN",
    "VALIDATION",
  ]);
  const dataLoss = warnings.some((w) => lossCodes.has(w.code));
  const status: "COMPLETE" | "PARTIAL" =
    missingCore || dataLoss ? "PARTIAL" : "COMPLETE";

  return { data, status };
}

async function saveCollection(
  ctx: TaskContext,
  deps: ChannelBasicCollectorDeps,
  data: ChannelBasicData,
  status: "COMPLETE" | "PARTIAL",
  capturedAt: string,
  warnings: TaskWarning[] = [],
): Promise<Collection<ChannelBasicData>> {
  const installationId =
    deps.installationId ?? getOrCreateInstallation().installationId;
  const collection: Collection<ChannelBasicData> = {
    collectionId: deps.collectionId ?? newId("col"),
    installationId,
    collector: CHANNEL_BASIC_COLLECTOR_ID,
    collectorVersion: deps.collectorVersion ?? CHANNEL_BASIC_COLLECTOR_VERSION,
    schemaVersion: LUFTBALLONS_SCHEMA_VERSION,
    capturedAt,
    status,
    data,
    // Observability: history must explain PARTIAL (audit §6.2 gap).
    ...(warnings.length > 0
      ? { warnings: warnings.map((w) => ({ code: w.code, message: w.message })) }
      : {}),
  };
  await ctx.collections.save(collection);
  return collection;
}

/**
 * Run the §40 state machine. Cancel → CANCELLED; already-read data saved as PARTIAL.
 */
export async function runChannelBasicCollector(
  ctx: TaskContext,
  deps: ChannelBasicCollectorDeps,
): Promise<TaskResult> {
  const warnings: TaskWarning[] = [];
  const capturedAt = new Date().toISOString();
  const draft: {
    channelId?: string;
    channelName: string;
    periodLabel?: string;
    periodStart?: string;
    periodEnd?: string;
    views?: number;
    subscriberDelta?: number;
    recentVideos: RecentVideoSnapshot[];
  } = {
    channelName: "",
    recentVideos: [],
  };
  let savedId: string | undefined;
  /** Fields the Studio UI itself shows as "no value" (placeholder) — not failures. */
  const absentFields = new Set<string>();

  /**
   * Bounded read retry (M4): a page-ready anchor can appear before its metric
   * nodes render (SPA). Retry empty/placeholder reads briefly; never longer
   * than the content budget (tests keep it small via contentTimeoutMs).
   */
  const metricRetryMs = Math.min(2_000, deps.contentTimeoutMs ?? 2_000);
  const readTextEventually = async (
    target: Parameters<CancellableDomService["readText"]>[0],
  ): Promise<string | null> => {
    const deadline = Date.now() + metricRetryMs;
    let last: string | null = null;
    for (;;) {
      throwIfAborted(ctx.signal);
      last = await deps.dom.readText(target);
      if (last !== null && !isDisplayPlaceholder(last)) {
        return last;
      }
      if (Date.now() >= deadline) {
        return last;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 120);
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  };
  /**
   * Metric read with control-presence evidence (review R5): a missing DOM
   * control and a placeholder display are different facts and must not share
   * one "ABSENT" bucket.
   */
  const readMetricEventually = async (
    target: Parameters<CancellableDomService["readText"]>[0],
  ): Promise<{ text: string | null; present: boolean }> => {
    const text = await readTextEventually(target);
    if (text !== null && !isDisplayPlaceholder(text)) {
      return { text, present: true };
    }
    return { text, present: await deps.dom.exists(target) };
  };
  const hasPayload = (): boolean =>
    draft.channelName.trim().length > 0 ||
    draft.views !== undefined ||
    draft.subscriberDelta !== undefined ||
    draft.recentVideos.length > 0;

  const persistPartial = async (summary: string): Promise<TaskResult> => {
    const built = validateAndBuild(draft, warnings, capturedAt, absentFields);
    // Always PARTIAL when cancelling mid-flight with any useful payload.
    if (hasPayload()) {
      const collection = await saveCollection(
        ctx,
        deps,
        built.data,
        "PARTIAL",
        capturedAt,
        warnings,
      );
      savedId = collection.collectionId;
      return {
        status: "CANCELLED",
        summary,
        collectionIds: [collection.collectionId],
        warnings: [...warnings],
      };
    }
    return {
      status: "CANCELLED",
      summary,
      ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
    };
  };

  const stopOnChannelSwitch = async (
    check: { message: string },
  ): Promise<TaskResult> => {
    warn(warnings, "CHANNEL_SWITCHED", check.message);
    const built = validateAndBuild(draft, warnings, capturedAt, absentFields);
    if (hasPayload()) {
      const collection = await saveCollection(
        ctx,
        deps,
        built.data,
        "PARTIAL",
        capturedAt,
        warnings,
      );
      return {
        status: "PARTIAL",
        summary: `Channel switched mid-collection; partial data retained (${check.message})`,
        collectionIds: [collection.collectionId],
        warnings: [...warnings],
      };
    }
    return {
      status: "FAILED",
      summary: `Channel switched; no data retained (${check.message})`,
      warnings: [...warnings],
    };
  };

  try {
    throwIfAborted(ctx.signal);
    ctx.setProgress("Detecting channel…", "RUNNING");
    ctx.logger.info("Detect channel context");

    const expectedChannelId = extractChannelIdFromHref(deps.getHref());
    if (expectedChannelId) {
      draft.channelId = expectedChannelId;
    }
    const nameEl = await deps.dom.find(getTarget("channel.name"));
    const nameText = nameEl?.id === "entity-name" ? directText(nameEl) : metricText(nameEl);
    if (nameText) {
      draft.channelName = nameText;
    }

    throwIfAborted(ctx.signal);
    ctx.setProgress("Reading channel summary (Dashboard)…", "RUNNING");
    ctx.logger.info("Read dashboard data");

    if (deps.navigation.currentPage() !== "DASHBOARD") {
      await deps.navigation.navigate("DASHBOARD", ctx.signal);
    }
    await deps.navigation.waitReady("DASHBOARD", undefined, ctx.signal);
    if (expectedChannelId) {
      const bind = recheckChannelBinding(deps.getHref, expectedChannelId);
      if (!bind.ok) {
        return stopOnChannelSwitch(bind);
      }
    }

    throwIfAborted(ctx.signal);

    const metrics: DraftMetrics = {};
    const periodRaw = await readTextEventually(getTarget("dashboard.period"));
    if (periodRaw) {
      metrics.periodLabel = periodRaw;
      draft.periodLabel = periodRaw;
    }

    const dashViews = await readMetricEventually(getTarget("dashboard.views"));
    const dashViewsRead = applyMetric(
      metrics,
      "views",
      dashViews.text,
      warnings,
      "dashboard",
      dashViews.present,
    );
    const dashDelta = await readMetricEventually(
      getTarget("dashboard.subscriberDelta"),
    );
    const dashDeltaRead = applyMetric(
      metrics,
      "subscriberDelta",
      dashDelta.text,
      warnings,
      "dashboard",
      dashDelta.present,
    );
    if (metrics.views !== undefined) {
      draft.views = metrics.views;
    }
    if (metrics.subscriberDelta !== undefined) {
      draft.subscriberDelta = metrics.subscriberDelta;
    }
    // Dashboard is the summary source unless Analytics is adopted below.
    absentFields.clear();
    if (dashViewsRead === "ABSENT") absentFields.add("views");
    if (dashDeltaRead === "ABSENT") absentFields.add("subscriberDelta");

    const needAnalytics =
      draft.views === undefined || draft.subscriberDelta === undefined;

    if (needAnalytics) {
      throwIfAborted(ctx.signal);
      ctx.setProgress("Reading analytics summary…", "RUNNING");
      ctx.logger.info("Navigate Analytics for missing metrics");
      await deps.navigation.navigate("ANALYTICS", ctx.signal);
      await deps.navigation.waitReady("ANALYTICS", undefined, ctx.signal);
      if (expectedChannelId) {
        const bind = recheckChannelBinding(deps.getHref, expectedChannelId);
        if (!bind.ok) {
          return stopOnChannelSwitch(bind);
        }
      }
      throwIfAborted(ctx.signal);

      const analyticsPeriod = await readTextEventually(getTarget("analytics.period"));
      const dates = periodDates(await readTextEventually(getTarget("analytics.dates")));
      const analytics: DraftMetrics = {};
      const anViews = await readMetricEventually(getTarget("analytics.views"));
      const anViewsRead = applyMetric(analytics, "views", anViews.text, warnings, "analytics", anViews.present);
      const anDelta = await readMetricEventually(getTarget("analytics.subscriberDelta"));
      const anDeltaRead = applyMetric(analytics, "subscriberDelta", anDelta.text, warnings, "analytics", anDelta.present);
      // Never merge a dashboard metric with an unverified Analytics period.
      // If Analytics has values, use that page as the sole summary source.
      if (analytics.views !== undefined || analytics.subscriberDelta !== undefined) {
        if (analyticsPeriod && dates) {
          if (analytics.views === undefined) delete draft.views;
          else draft.views = analytics.views;
          if (analytics.subscriberDelta === undefined) delete draft.subscriberDelta;
          else draft.subscriberDelta = analytics.subscriberDelta;
          // Analytics becomes the sole source — its absences are authoritative.
          absentFields.clear();
          if (anViewsRead === "ABSENT") absentFields.add("views");
          if (anDeltaRead === "ABSENT") absentFields.add("subscriberDelta");
          draft.periodLabel = analyticsPeriod;
          draft.periodStart = dates.start;
          draft.periodEnd = dates.end;
        } else {
          warn(warnings, "ANALYTICS_PERIOD_UNKNOWN", "Analytics metrics omitted: date range was not readable");
        }
      }

      // review R5 + H5 synthesis (2026-10-22): an explicit placeholder display
      // on EITHER consulted page is the UI's own "no value" evidence and keeps
      // the field legitimately absent. Only a metric with NEITHER a value node
      // NOR a placeholder anywhere is an unexplained absence (→ missingCore).
      if (anViewsRead === "ABSENT" && draft.views === undefined) {
        absentFields.add("views");
      }
      if (anDeltaRead === "ABSENT" && draft.subscriberDelta === undefined) {
        absentFields.add("subscriberDelta");
      }

      if (draft.views === undefined && !absentFields.has("views")) {
        warn(warnings, "VIEWS_MISSING", "Views not found on Dashboard or Analytics");
      }
      if (draft.subscriberDelta === undefined && !absentFields.has("subscriberDelta")) {
        warn(
          warnings,
          "SUBSCRIBER_DELTA_MISSING",
          "Subscriber delta not found on Dashboard or Analytics",
        );
      }
    }

    throwIfAborted(ctx.signal);
    ctx.logger.info("Navigate Content for recent videos");
    await deps.navigation.navigate("CONTENT", ctx.signal);
    await deps.navigation.waitReady("CONTENT", undefined, ctx.signal);
    if (expectedChannelId) {
      const bind = recheckChannelBinding(deps.getHref, expectedChannelId);
      if (!bind.ok) {
        return stopOnChannelSwitch(bind);
      }
    }
    throwIfAborted(ctx.signal);

    ctx.setProgress("Reading recent videos…", "RUNNING");
    // A SPA shell can be ready before its rows/cards arrive. Observe content
    // mutations during this task; never conclude an empty list from one read.
    // Readiness = surface rendered with at least one row/card (H4) — a single
    // unparseable row must not block the whole list forever.
    let list: Element | null = null;
    try {
      list = await deps.dom.waitFor({
        id: "content.videos.loaded",
        selectorFallback: [
          "ytcp-video-section-content#video-list",
          'ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]',
          '[data-luftballons-target="content.videos.list"]',
        ],
        unique: true,
        matches: (candidate) => isActiveElement(candidate) && contentReady(candidate),
      }, deps.contentTimeoutMs ?? 5_000, ctx.signal);
    } catch (error) {
      if (!(error instanceof DomTimeoutError)) throw error;
      warn(warnings, "CONTENT_LOAD_TIMEOUT", "Video rows/cards did not finish loading before timeout; preserving available data");
      list = await deps.dom.find(getTarget("content.videos.list"));
    }
    throwIfAborted(ctx.signal);
    const family = detectContentFamily(deps.document ?? document);
    if (family === "A_HUB") {
      // Family A (Content Hub): shelf lockup cards, no table/pagination.
      // docs/layout-family-a.md §1.2. Cards stream in with their icon metrics —
      // give unreadable cards a bounded settle window (same H4 policy as rows).
      const settleDeadline = Date.now() + (deps.contentTimeoutMs ?? 5_000);
      let cards = parseFamilyAVideos(deps.document ?? document);
      while (
        Date.now() < settleDeadline &&
        cards.some((c) => c.skipReason)
      ) {
        throwIfAborted(ctx.signal);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 120);
          ctx.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        cards = parseFamilyAVideos(deps.document ?? document);
      }
      throwIfAborted(ctx.signal);
      if (cards.length === 0) {
        warn(
          warnings,
          "RECENT_VIDEOS_MISSING",
          "Content Hub rendered but no video cards parsed",
        );
      }
      warn(
        warnings,
        "VIDEO_SCOPE_PARTIAL",
        "Family A Content Hub: captured rendered shelf cards only (full list behind 查看全部)",
      );
      for (const card of cards) {
        throwIfAborted(ctx.signal);
        if (card.skipReason) {
          warn(
            warnings,
            "VIDEO_SKIPPED",
            `Skipped content card${card.videoId ? ` ${card.videoId}` : ""}: ${card.skipReason}`,
          );
          continue;
        }
        if (card.viewsRounded) {
          warn(
            warnings,
            "METRIC_DISPLAY_ROUNDED",
            `recent video "${card.title}" views abbreviation → ${card.views}`,
          );
        }
        if (card.views === undefined) {
          warn(
            warnings,
            "VIDEO_SKIPPED",
            `Skipped content card${card.videoId ? ` ${card.videoId}` : ""}: views unreadable`,
          );
          continue;
        }
        const snap: RecentVideoSnapshot = {
          title: card.title,
          views: card.views,
          capturedAt,
          ...(card.videoId ? { videoId: card.videoId } : {}),
          ...(card.publishedAt ? { publishedAt: card.publishedAt } : {}),
        };
        draft.recentVideos.push(snap);
      }
    } else if (!list) {
      warn(
        warnings,
        "RECENT_VIDEOS_MISSING",
        "Content video list selector failed; recentVideos empty",
      );
    } else {
      let rows = Array.from(list.querySelectorAll(CONTENT_VIDEO_ROW_SELECTOR)).filter(isActiveElement);
      // Cells can stream in after their row shell (calibration P2-2 style).
      // Give unreadable cells a bounded settle window before declaring the row
      // unparseable — but never wait forever for one bad row (H4).
      const settleDeadline = Date.now() + (deps.contentTimeoutMs ?? 5_000);
      while (Date.now() < settleDeadline) {
        throwIfAborted(ctx.signal);
        const pending = rows.some(
          (row) => readCell(row, "title") === null || readCell(row, "views") === null,
        );
        if (!pending) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 50);
          ctx.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        rows = Array.from(list.querySelectorAll(CONTENT_VIDEO_ROW_SELECTOR)).filter(isActiveElement);
      }
      throwIfAborted(ctx.signal);
      if (list.matches("ytcp-video-section-content#video-list")) {
        const sort = list.querySelector(CONTENT_FIELDS.dateSort)?.getAttribute("aria-sort");
        if (sort !== "descending") warn(warnings, "VIDEO_ORDER_UNKNOWN", "Current video rows are not confirmed date-descending");
        const footer = list.querySelector(CONTENT_FIELDS.footer);
        const next = footer?.querySelector(CONTENT_FIELDS.next);
        const previous = footer?.querySelector(CONTENT_FIELDS.previous);
        const disabled = (el: Element | null | undefined): boolean => Boolean(Boolean(el?.hasAttribute("disabled")) && el?.getAttribute("aria-disabled") === "true");
        const range = metricText(footer?.querySelector(CONTENT_FIELDS.range) ?? null)?.match(/第\s*([\d,]+)\s*[-–—]\s*([\d,]+)\s*条[，,]\s*共\s*([\d,]+)\s*条/) ?? metricText(footer?.querySelector(CONTENT_FIELDS.range) ?? null)?.match(/([\d,]+)\s*[-–—]\s*([\d,]+)\s*(?:of|\/|共)\s*([\d,]+)/i);
        const numbers = range?.slice(1).map(n => Number(n.replace(/,/g, "")));
        if (!disabled(next) || !disabled(previous) || !numbers || numbers[0] !== 1 || numbers[1] !== rows.length || numbers[2] !== rows.length) {
          warn(warnings, "VIDEO_SCOPE_PARTIAL", "Only currently rendered video rows captured; full filtered list not verified");
        }
      }
      if (rows.length === 0) {
        warn(
          warnings,
          "RECENT_VIDEOS_MISSING",
          "Content list found but no video rows matched",
        );
      }
      for (const row of rows) {
        throwIfAborted(ctx.signal);
        const title = readCell(row, "title");
        if (!title || title.trim().length === 0) {
          warn(warnings, "VIDEO_SKIPPED", "Skipped a content row without title");
          continue;
        }
        const viewsParsed = parseDisplayMetric(readCell(row, "views"));
        if (!viewsParsed || viewsParsed.value < 0) {
          warn(
            warnings,
            "VIDEO_SKIPPED",
            `Skipped video "${title}": views unreadable`,
          );
          continue;
        }
        if (viewsParsed.precision === "DISPLAY_ROUNDED") {
          warn(
            warnings,
            "METRIC_DISPLAY_ROUNDED",
            `recent video "${title}" views abbreviation → ${viewsParsed.value}`,
          );
        }
        const publishedAt = readCell(row, "publishedAt") ?? undefined;
        const videoId = readVideoIdFromRow(row);
        const snap: RecentVideoSnapshot = {
          title,
          views: viewsParsed.value,
          capturedAt,
          ...(videoId !== undefined ? { videoId } : {}),
          ...(publishedAt !== undefined && publishedAt.length > 0
            ? { publishedAt }
            : {}),
        };
        draft.recentVideos.push(snap);
      }
    }

    throwIfAborted(ctx.signal);
    ctx.setProgress("Saving collection…", "RUNNING");
    ctx.logger.info("Normalize and validate");
    const built = validateAndBuild(draft, warnings, capturedAt, absentFields);
    const collection = await saveCollection(
      ctx,
      deps,
      built.data,
      built.status,
      capturedAt,
      warnings,
    );
    savedId = collection.collectionId;

    const result: TaskResult = {
      status: built.status === "PARTIAL" ? "PARTIAL" : "COMPLETED",
      summary: `Saved channel collection (${draft.recentVideos.length} videos, ${built.status})`,
      collectionIds: [collection.collectionId],
    };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) {
      ctx.logger.info("Collector cancelled", {
        savedId,
        videos: draft.recentVideos.length,
      });
      return persistPartial("Cancelled by user; partial data retained when present");
    }
    // Fail-partial (H1 / SPEC §19): a non-abort failure must not discard the
    // data already read — save what exists as PARTIAL instead of losing it.
    const message =
      error instanceof Error ? error.message : "collector failed unexpectedly";
    ctx.logger.error("Collector error", { message });
    warn(warnings, "COLLECTOR_ERROR", message);
    if (hasPayload()) {
      const built = validateAndBuild(draft, warnings, capturedAt, absentFields);
      const collection = await saveCollection(
        ctx,
        deps,
        built.data,
        "PARTIAL",
        capturedAt,
        warnings,
      );
      savedId = collection.collectionId;
      return {
        status: "PARTIAL",
        summary: `Collection interrupted (${message}); partial data retained`,
        collectionIds: [collection.collectionId],
        warnings: [...warnings],
      };
    }
    return {
      status: "FAILED",
      summary: `Collection failed: ${message}`,
      warnings: [...warnings],
    };
  }
}
