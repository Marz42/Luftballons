/**
 * Sink interface (IMPLEMENTATION §17).
 */

import type { Capability } from "../runtime/capability.js";
import type { Collection } from "../schemas/collection.js";

export interface SinkFile {
  filename: string;
  content: string;
  mimeType: string;
}

export interface SinkResult {
  status: "OK" | "FAILED";
  message?: string;
  files?: SinkFile[];
}

export interface Sink {
  id: string;
  capability: Capability;
  available(): Promise<boolean>;
  write(collection: Collection<unknown>): Promise<SinkResult>;
}

export type DownloadFn = (
  filename: string,
  content: string,
  mimeType: string,
) => void;

/**
 * Browser-local download via Blob + object URL (no network).
 */
export function downloadViaAnchor(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
