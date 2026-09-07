/**
 * JsonSink (IMPLEMENTATION §19) — preserves full Collection envelope.
 */

import type { Capability } from "../runtime/capability.js";
import type { Collection } from "../schemas/collection.js";
import {
  downloadViaAnchor,
  type DownloadFn,
  type Sink,
  type SinkResult,
} from "./sink.js";

export interface JsonSinkOptions {
  download?: DownloadFn;
  now?: () => Date;
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export class JsonSink implements Sink {
  readonly id = "json";
  readonly capability: Capability = "LOCAL_EXPORT";

  private readonly download: DownloadFn;
  private readonly now: () => Date;

  constructor(options: JsonSinkOptions = {}) {
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

    const stamped = yyyymmdd(this.now());
    const filename = `Luftballons_collection_${collection.collectionId}_${stamped}.json`;
    // Full envelope: schemaVersion / collectionId / data preserved as-is.
    const content = `${JSON.stringify(collection, null, 2)}\n`;
    const mime = "application/json;charset=utf-8";
    this.download(filename, content, mime);

    return {
      status: "OK",
      message: "Exported collection JSON envelope",
      files: [{ filename, content, mimeType: mime }],
    };
  }
}
