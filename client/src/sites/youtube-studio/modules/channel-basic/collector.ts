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
  isActiveElement,
  getTarget,
} from "../../selectors.js";
import type { ChannelBasicData, RecentVideoSnapshot } from "./schema.js";
import { parseDisplayMetric, type MetricPrecision } from "./metrics.js";

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

function channelIdFromHref(href: string): string | undefined {
  try {
    const pathname = new URL(href, "https://studio.youtube.com").pathname;
    const match = pathname.match(/\/channel\/([^/]+)/i);
    const id = match?.[1];
    return id && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
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

function applyMetric(
  draft: DraftMetrics,
  field: "views" | "subscriberDelta",
  raw: string | null,
  warnings: TaskWarning[],
  source: string,
): void {
  const parsed = parseDisplayMetric(raw);
  if (!parsed) {
    if (raw !== null && raw.trim().length > 0) {
      warn(
        warnings,
        "METRIC_UNPARSED",
        `Could not parse ${field} from ${source}: "${raw}"`,
      );
    }
    return;
  }
  if (field === "views") {
    if (parsed.value < 0) {
      warn(warnings, "VALIDATION", `views from ${source} was negative; dropped`);
      return;
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
  const match = href.match(/^\/video\/([^/?#]+)\/edit(?:[/?#]|$)/i);
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

  const missingCore =
    draft.views === undefined ||
    draft.subscriberDelta === undefined ||
    draft.recentVideos.length === 0 ||
    draft.channelName.trim().length === 0;

  // DISPLAY_ROUNDED is expected for abbreviated UI — does not force PARTIAL alone.
  const blockingWarnings = warnings.some(
    (w) => w.code !== "METRIC_DISPLAY_ROUNDED",
  );
  const status: "COMPLETE" | "PARTIAL" =
    missingCore || blockingWarnings ? "PARTIAL" : "COMPLETE";

  return { data, status };
}

async function saveCollection(
  ctx: TaskContext,
  deps: ChannelBasicCollectorDeps,
  data: ChannelBasicData,
  status: "COMPLETE" | "PARTIAL",
  capturedAt: string,
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

  const persistPartial = async (summary: string): Promise<TaskResult> => {
    const built = validateAndBuild(draft, warnings, capturedAt);
    // Always PARTIAL when cancelling mid-flight with any useful payload.
    const hasPayload =
      draft.channelName.trim().length > 0 ||
      draft.views !== undefined ||
      draft.subscriberDelta !== undefined ||
      draft.recentVideos.length > 0;
    if (hasPayload) {
      const collection = await saveCollection(
        ctx,
        deps,
        built.data,
        "PARTIAL",
        capturedAt,
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

  try {
    throwIfAborted(ctx.signal);
    ctx.logger.info("Detect channel context");

    const channelId = channelIdFromHref(deps.getHref());
    if (channelId !== undefined) {
      draft.channelId = channelId;
    }
    const nameEl = await deps.dom.find(getTarget("channel.name"));
    const nameText = nameEl?.id === "entity-name" ? directText(nameEl) : metricText(nameEl);
    if (nameText) {
      draft.channelName = nameText;
    }

    throwIfAborted(ctx.signal);
    ctx.logger.info("Read dashboard data");

    if (deps.navigation.currentPage() !== "DASHBOARD") {
      await deps.navigation.navigate("DASHBOARD", ctx.signal);
    }
    await deps.navigation.waitReady("DASHBOARD", undefined, ctx.signal);

    throwIfAborted(ctx.signal);

    const metrics: DraftMetrics = {};
    const periodRaw = await deps.dom.readText(getTarget("dashboard.period"));
    if (periodRaw) {
      metrics.periodLabel = periodRaw;
      draft.periodLabel = periodRaw;
    }

    applyMetric(
      metrics,
      "views",
      await deps.dom.readText(getTarget("dashboard.views")),
      warnings,
      "dashboard",
    );
    applyMetric(
      metrics,
      "subscriberDelta",
      await deps.dom.readText(getTarget("dashboard.subscriberDelta")),
      warnings,
      "dashboard",
    );
    if (metrics.views !== undefined) {
      draft.views = metrics.views;
    }
    if (metrics.subscriberDelta !== undefined) {
      draft.subscriberDelta = metrics.subscriberDelta;
    }

    const needAnalytics =
      draft.views === undefined || draft.subscriberDelta === undefined;

    if (needAnalytics) {
      throwIfAborted(ctx.signal);
      ctx.logger.info("Navigate Analytics for missing metrics");
      await deps.navigation.navigate("ANALYTICS", ctx.signal);
      await deps.navigation.waitReady("ANALYTICS", undefined, ctx.signal);
      throwIfAborted(ctx.signal);

      const analyticsPeriod = await deps.dom.readText(getTarget("analytics.period"));
      const dates = periodDates(await deps.dom.readText(getTarget("analytics.dates")));
      const analytics: DraftMetrics = {};
      applyMetric(analytics, "views", await deps.dom.readText(getTarget("analytics.views")), warnings, "analytics");
      applyMetric(analytics, "subscriberDelta", await deps.dom.readText(getTarget("analytics.subscriberDelta")), warnings, "analytics");
      // Never merge a dashboard metric with an unverified Analytics period.
      // If Analytics has values, use that page as the sole summary source.
      if (analytics.views !== undefined || analytics.subscriberDelta !== undefined) {
        if (analyticsPeriod && dates) {
          if (analytics.views === undefined) delete draft.views;
          else draft.views = analytics.views;
          if (analytics.subscriberDelta === undefined) delete draft.subscriberDelta;
          else draft.subscriberDelta = analytics.subscriberDelta;
          draft.periodLabel = analyticsPeriod;
          draft.periodStart = dates.start;
          draft.periodEnd = dates.end;
        } else {
          warn(warnings, "ANALYTICS_PERIOD_UNKNOWN", "Analytics metrics omitted: date range was not readable");
        }
      }

      if (draft.views === undefined) {
        warn(warnings, "VIEWS_MISSING", "Views not found on Dashboard or Analytics");
      }
      if (draft.subscriberDelta === undefined) {
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
    throwIfAborted(ctx.signal);

    // A SPA shell can be ready before its rows/cells arrive. Observe content
    // mutations during this task; never conclude an empty list from one read.
    let list: Element | null = null;
    try {
      list = await deps.dom.waitFor({
        id: "content.videos.loaded",
        selectorFallback: 'ytcp-video-section-content#video-list, [data-luftballons-target="content.videos.list"]',
        unique: true,
        matches: candidate => {
          if (!isActiveElement(candidate)) return false;
          const rows = Array.from(candidate.querySelectorAll(CONTENT_VIDEO_ROW_SELECTOR)).filter(isActiveElement);
          return rows.length > 0 && rows.every(row => readCell(row, "title") !== null && readCell(row, "views") !== null);
        },
      }, deps.contentTimeoutMs ?? 5_000, ctx.signal);
    } catch (error) {
      if (!(error instanceof DomTimeoutError)) throw error;
      warn(warnings, "CONTENT_LOAD_TIMEOUT", "Video rows did not finish loading before timeout; preserving available data");
      list = await deps.dom.find(getTarget("content.videos.list"));
    }
    throwIfAborted(ctx.signal);
    if (!list) {
      warn(
        warnings,
        "RECENT_VIDEOS_MISSING",
        "Content video list selector failed; recentVideos empty",
      );
    } else {
      const rows = Array.from(list.querySelectorAll(CONTENT_VIDEO_ROW_SELECTOR)).filter(isActiveElement);
      if (list.matches("ytcp-video-section-content#video-list")) {
        const sort = list.querySelector(CONTENT_FIELDS.dateSort)?.getAttribute("aria-sort");
        if (sort !== "descending") warn(warnings, "VIDEO_ORDER_UNKNOWN", "Current video rows are not confirmed date-descending");
        const footer = list.querySelector(CONTENT_FIELDS.footer);
        const next = footer?.querySelector(CONTENT_FIELDS.next);
        const previous = footer?.querySelector(CONTENT_FIELDS.previous);
        const disabled = (el: Element | null | undefined): boolean => Boolean(el?.hasAttribute("disabled") && el.getAttribute("aria-disabled") === "true");
        const range = metricText(footer?.querySelector(CONTENT_FIELDS.range) ?? null)?.match(/^第\s*([\d,]+)\s*-\s*([\d,]+)\s*条，共\s*([\d,]+)\s*条$/);
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
    ctx.logger.info("Normalize and validate");
    const built = validateAndBuild(draft, warnings, capturedAt);
    const collection = await saveCollection(
      ctx,
      deps,
      built.data,
      built.status,
      capturedAt,
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
    throw error;
  }
}
