/**
 * CsvSink (IMPLEMENTATION §18).
 * UTF-8 with BOM; CSV injection defense for = + - @ and tab.
 */

import type { Capability } from "../runtime/capability.js";
import type { Collection } from "../schemas/collection.js";
import type { ChannelBasicData } from "../schemas/channel-basic.js";
import { isChannelBasicData } from "../schemas/channel-basic.js";
import {
  downloadViaAnchor,
  type DownloadFn,
  type Sink,
  type SinkResult,
} from "./sink.js";

const UTF8_BOM = "\uFEFF";

export interface CsvSinkOptions {
  download?: DownloadFn;
  /** Override "now" for deterministic filenames in tests. */
  now?: () => Date;
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * CSV injection defense: prefix cells that start with = + - @ or tab.
 */
export function escapeCsvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return escapeCsvCell(String(value));
}

function row(values: Array<string | number | null | undefined>): string {
  return values.map(cell).join(",");
}

function buildSummaryCsv(collection: Collection<ChannelBasicData>): string {
  const { channel, period, summary } = collection.data;
  const header = row([
    "collectionId",
    "installationId",
    "collector",
    "collectorVersion",
    "schemaVersion",
    "capturedAt",
    "status",
    "channelId",
    "channelName",
    "periodStart",
    "periodEnd",
    "periodLabel",
    "views",
    "subscriberDelta",
  ]);
  const body = row([
    collection.collectionId,
    collection.installationId,
    collection.collector,
    collection.collectorVersion,
    collection.schemaVersion,
    collection.capturedAt,
    collection.status,
    channel.channelId,
    channel.channelName,
    period.start,
    period.end,
    period.label,
    summary.views,
    summary.subscriberDelta,
  ]);
  return `${UTF8_BOM}${header}\n${body}\n`;
}

function buildVideosCsv(collection: Collection<ChannelBasicData>): string {
  const header = row([
    "collectionId",
    "installationId",
    "collector",
    "capturedAt",
    "status",
    "videoId",
    "title",
    "publishedAt",
    "views",
    "videoCapturedAt",
  ]);
  const lines = collection.data.recentVideos.map((video) =>
    row([
      collection.collectionId,
      collection.installationId,
      collection.collector,
      collection.capturedAt,
      collection.status,
      video.videoId,
      video.title,
      video.publishedAt,
      video.views,
      video.capturedAt,
    ]),
  );
  return `${UTF8_BOM}${header}\n${lines.join("\n")}\n`;
}

export class CsvSink implements Sink {
  readonly id = "csv";
  readonly capability: Capability = "LOCAL_EXPORT";

  private readonly download: DownloadFn;
  private readonly now: () => Date;

  constructor(options: CsvSinkOptions = {}) {
    this.download = options.download ?? downloadViaAnchor;
    this.now = options.now ?? (() => new Date());
  }

  async available(): Promise<boolean> {
    return (
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    );
  }

  async write(collection: Collection<unknown>): Promise<SinkResult> {
    if (!(await this.available())) {
      return {
        status: "FAILED",
        message: "LOCAL_EXPORT unavailable in this environment",
      };
    }
    if (!isChannelBasicData(collection.data)) {
      return {
        status: "FAILED",
        message: "CsvSink currently supports ChannelBasicData only",
      };
    }

    const stamped = yyyymmdd(this.now());
    const typed = collection as Collection<ChannelBasicData>;
    const summaryName = `Luftballons_channel_summary_${stamped}.csv`;
    const videosName = `Luftballons_recent_videos_${stamped}.csv`;
    const summaryContent = buildSummaryCsv(typed);
    const videosContent = buildVideosCsv(typed);

    const mime = "text/csv;charset=utf-8";
    this.download(summaryName, summaryContent, mime);
    this.download(videosName, videosContent, mime);

    return {
      status: "OK",
      message: "Exported channel summary and recent videos CSV",
      files: [
        { filename: summaryName, content: summaryContent, mimeType: mime },
        { filename: videosName, content: videosContent, mimeType: mime },
      ],
    };
  }
}
