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
  getTarget,
} from "../../selectors.js";
import type { ChannelBasicData, RecentVideoSnapshot } from "./schema.js";
import { parseDisplayMetric, type MetricPrecision } from "./metrics.js";

export const CHANNEL_BASIC_COLLECTOR_ID = "youtube.channel.basic";
export const CHANNEL_BASIC_COLLECTOR_VERSION = 1;

export interface ChannelBasicCollectorDeps {
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
  /** Current Studio href (injected for tests). */
  getHref: () => string;
  document?: Document;
  collectionId?: string;
  installationId?: string;
  collectorVersion?: number;
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
  const link = row.querySelector("a[href*='/video/']");
  const href = link?.getAttribute("href") ?? "";
  const match = href.match(/\/video\/([^/]+)/i);
  return match?.[1];
}

function readCell(
  row: Element,
  attr: string,
): string | null {
  const el =
    row.querySelector(`[data-luftballons-field="${attr}"]`) ??
    row.querySelector(`[data-field="${attr}"]`);
  return metricText(el);
}

function validateAndBuild(
  draft: {
    channelId?: string;
    channelName: string;
    periodLabel?: string;
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
    const nameText = metricText(nameEl);
    if (nameText) {
      draft.channelName = nameText;
    }

    throwIfAborted(ctx.signal);
    ctx.logger.info("Read dashboard data");

    if (deps.navigation.currentPage() !== "DASHBOARD") {
      await deps.navigation.navigate("DASHBOARD", ctx.signal);
      await deps.navigation.waitReady("DASHBOARD", undefined, ctx.signal);
    }

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

      if (draft.views === undefined) {
        applyMetric(
          metrics,
          "views",
          await deps.dom.readText(getTarget("analytics.views")),
          warnings,
          "analytics",
        );
        if (metrics.views !== undefined) {
          draft.views = metrics.views;
        }
      }
      if (draft.subscriberDelta === undefined) {
        applyMetric(
          metrics,
          "subscriberDelta",
          await deps.dom.readText(getTarget("analytics.subscriberDelta")),
          warnings,
          "analytics",
        );
        if (metrics.subscriberDelta !== undefined) {
          draft.subscriberDelta = metrics.subscriberDelta;
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

    const list = await deps.dom.find(getTarget("content.videos.list"));
    if (!list) {
      warn(
        warnings,
        "RECENT_VIDEOS_MISSING",
        "Content video list selector failed; recentVideos empty",
      );
    } else {
      const rows = list.querySelectorAll(CONTENT_VIDEO_ROW_SELECTOR);
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
