/**
 * CollectionService — IndexedDB backend (IMPLEMENTATION §16, §37).
 * Modules must access storage only via this service (never IndexedDB directly).
 */

import type {
  Collection,
  CollectionFilter,
  CollectionSummary,
} from "../schemas/collection.js";
import type { ChannelBasicData } from "../schemas/channel-basic.js";
import { isChannelBasicData } from "../schemas/channel-basic.js";

/** IndexedDB open version — bump + add migration when stores change. */
export const LUFTBALLONS_DB_VERSION = 1;

/** Logical Collection envelope schema version. */
export const LUFTBALLONS_SCHEMA_VERSION = 1;

const DEFAULT_DB_NAME = "luftballons";
const STORE_COLLECTIONS = "collections";
const STORE_META = "meta";

export interface CollectionService {
  save<T>(collection: Collection<T>): Promise<void>;
  get(id: string): Promise<Collection<unknown> | null>;
  list(filter?: CollectionFilter): Promise<CollectionSummary[]>;
  delete(id: string): Promise<void>;
}

export interface CollectionDbMeta {
  db_version: number;
  schema_version: number;
}

type MigrationFn = (
  db: IDBDatabase,
  oldVersion: number,
  tx: IDBTransaction,
) => void;

/**
 * Migration chain: key = target version after applying the migration.
 * Empty future slots must still be filled before bumping LUFTBALLONS_DB_VERSION —
 * never skip versions.
 */
const MIGRATIONS: Record<number, MigrationFn> = {
  1: (db) => {
    if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
      const store = db.createObjectStore(STORE_COLLECTIONS, {
        keyPath: "collectionId",
      });
      store.createIndex("capturedAt", "capturedAt", { unique: false });
      store.createIndex("collector", "collector", { unique: false });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("installationId", "installationId", { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: "key" });
    }
  },
};

function runMigrationChain(
  db: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  tx: IDBTransaction,
): void {
  for (let version = oldVersion + 1; version <= newVersion; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(
        `Missing IndexedDB migration for version ${version} (db_version chain broken)`,
      );
    }
    migrate(db, oldVersion, tx);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function summarizeItemCount(data: unknown): number | undefined {
  if (isChannelBasicData(data)) {
    return data.recentVideos.length;
  }
  return undefined;
}

function toSummary(collection: Collection<unknown>): CollectionSummary {
  const itemCount = summarizeItemCount(collection.data);
  const summary: CollectionSummary = {
    collectionId: collection.collectionId,
    installationId: collection.installationId,
    collector: collection.collector,
    collectorVersion: collection.collectorVersion,
    schemaVersion: collection.schemaVersion,
    capturedAt: collection.capturedAt,
    status: collection.status,
  };
  if (itemCount !== undefined) {
    summary.itemCount = itemCount;
  }
  return summary;
}

function matchesFilter(
  collection: Collection<unknown>,
  filter?: CollectionFilter,
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.collector !== undefined && collection.collector !== filter.collector) {
    return false;
  }
  if (filter.status !== undefined && collection.status !== filter.status) {
    return false;
  }
  if (
    filter.installationId !== undefined &&
    collection.installationId !== filter.installationId
  ) {
    return false;
  }
  return true;
}

/** Placeholding service for tests / Phase 0 TaskRunner default. */
export class NoopCollectionService implements CollectionService {
  async save<T>(_collection: Collection<T>): Promise<void> {
    /* no-op */
  }

  async get(_id: string): Promise<Collection<unknown> | null> {
    return null;
  }

  async list(_filter?: CollectionFilter): Promise<CollectionSummary[]> {
    return [];
  }

  async delete(_id: string): Promise<void> {
    /* no-op */
  }
}

export interface IndexedDbCollectionServiceOptions {
  dbName?: string;
  dbVersion?: number;
}

export class IndexedDbCollectionService implements CollectionService {
  private readonly dbName: string;
  private readonly dbVersion: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbCollectionServiceOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.dbVersion = options.dbVersion ?? LUFTBALLONS_DB_VERSION;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open IndexedDB"));
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction;
        if (!tx) {
          reject(new Error("Missing upgrade transaction"));
          return;
        }
        runMigrationChain(
          db,
          event.oldVersion,
          event.newVersion ?? this.dbVersion,
          tx,
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        void this.ensureMeta(db)
          .then(() => resolve(db))
          .catch(reject);
      };
    });
    return this.dbPromise;
  }

  private async ensureMeta(db: IDBDatabase): Promise<void> {
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    store.put({ key: "db_version", value: this.dbVersion });
    store.put({ key: "schema_version", value: LUFTBALLONS_SCHEMA_VERSION });
    await transactionDone(tx);
  }

  async getMeta(): Promise<CollectionDbMeta> {
    const db = await this.openDb();
    const tx = db.transaction(STORE_META, "readonly");
    const store = tx.objectStore(STORE_META);
    const dbVersionRow = await requestToPromise<{ key: string; value: number }>(
      store.get("db_version"),
    );
    const schemaVersionRow = await requestToPromise<{
      key: string;
      value: number;
    }>(store.get("schema_version"));
    await transactionDone(tx);
    return {
      db_version: dbVersionRow?.value ?? this.dbVersion,
      schema_version: schemaVersionRow?.value ?? LUFTBALLONS_SCHEMA_VERSION,
    };
  }

  async save<T>(collection: Collection<T>): Promise<void> {
    if (typeof collection.capturedAt !== "string") {
      throw new Error("capturedAt must be an ISO string, not a Date object");
    }
    const db = await this.openDb();
    const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
    tx.objectStore(STORE_COLLECTIONS).put(collection);
    await transactionDone(tx);
  }

  async get(id: string): Promise<Collection<unknown> | null> {
    const db = await this.openDb();
    const tx = db.transaction(STORE_COLLECTIONS, "readonly");
    const result = await requestToPromise<Collection<unknown> | undefined>(
      tx.objectStore(STORE_COLLECTIONS).get(id),
    );
    await transactionDone(tx);
    return result ?? null;
  }

  async list(filter?: CollectionFilter): Promise<CollectionSummary[]> {
    const db = await this.openDb();
    const tx = db.transaction(STORE_COLLECTIONS, "readonly");
    const all = await requestToPromise<Collection<unknown>[]>(
      tx.objectStore(STORE_COLLECTIONS).getAll(),
    );
    await transactionDone(tx);
    return all
      .filter((c) => matchesFilter(c, filter))
      .map(toSummary)
      .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
    tx.objectStore(STORE_COLLECTIONS).delete(id);
    await transactionDone(tx);
  }
}

/** Default mock ChannelBasicData for stub collectors / tests. */
export function createMockChannelBasicData(
  overrides: Partial<ChannelBasicData> = {},
): ChannelBasicData {
  const capturedAt = new Date().toISOString();
  const base: ChannelBasicData = {
    channel: {
      channelName: "Demo Channel",
      channelId: "UC_demo_channel",
    },
    period: {
      label: "Last 28 days",
      start: "2026-08-10",
      end: "2026-09-07",
    },
    summary: {
      views: 42_000,
      subscriberDelta: 120,
    },
    recentVideos: [
      {
        videoId: "vid_demo_1",
        title: "Welcome to the channel",
        publishedAt: "2026-09-01T00:00:00.000Z",
        views: 10_000,
        capturedAt,
      },
      {
        videoId: "vid_demo_2",
        title: "Studio tips",
        publishedAt: "2026-08-20T00:00:00.000Z",
        views: 5_500,
        capturedAt,
      },
      {
        title: "Untitled draft snapshot",
        views: 0,
        capturedAt,
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    channel: { ...base.channel, ...overrides.channel },
    period: { ...base.period, ...overrides.period },
    summary: { ...base.summary, ...overrides.summary },
    recentVideos: overrides.recentVideos ?? base.recentVideos,
  };
}
