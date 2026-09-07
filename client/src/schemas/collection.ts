/**
 * Collection envelope (IMPLEMENTATION §13).
 * Unknown fields must be null/undefined — never guess or use 0 as unknown (§15).
 */

export type CollectionStatus = "COMPLETE" | "PARTIAL";

export interface Collection<T> {
  collectionId: string;
  installationId: string;
  collector: string;
  collectorVersion: number;
  schemaVersion: number;
  /** ISO-8601 timestamp string — never persist a Date object. */
  capturedAt: string;
  status: CollectionStatus;
  data: T;
}

export interface CollectionSummary {
  collectionId: string;
  installationId: string;
  collector: string;
  collectorVersion: number;
  schemaVersion: number;
  capturedAt: string;
  status: CollectionStatus;
  /** Brief overview (e.g. recentVideos length for channel.basic). */
  itemCount?: number;
}

export interface CollectionFilter {
  collector?: string;
  status?: CollectionStatus;
  installationId?: string;
}
