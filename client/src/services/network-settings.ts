/**
 * Network / server settings persistence (IMPLEMENTATION §22 / §26).
 * Installation token uses userscript-manager private storage (GM_*);
 * non-secret settings stay in page localStorage.
 */

export type NetworkMode = "OFF" | "MANUAL" | "ENABLED";

export interface ServerSettings {
  baseUrl: string;
  /** Installation Bearer token — never log; never page localStorage. */
  token: string;
  networkMode: NetworkMode;
}

export const STORAGE_KEYS = {
  baseUrl: "luftballons.server.baseUrl",
  token: "luftballons.server.token",
  networkMode: "luftballons.networkMode",
} as const;

const DEFAULT_MODE: NetworkMode = "MANUAL";

export type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Key/value backend for secrets (GM_* in production; injectable in tests). */
export interface SecretStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

declare function GM_getValue(name: string, defaultValue?: string): unknown;
declare function GM_setValue(name: string, value: string): void;
declare function GM_deleteValue(name: string): void;

export function createMemorySecretStorage(
  initial?: Map<string, string>,
): SecretStorage {
  const map = initial ?? new Map<string, string>();
  return {
    get(key) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    set(key, value) {
      map.set(key, value);
    },
    remove(key) {
      map.delete(key);
    },
  };
}

export function createGmSecretStorage(): SecretStorage {
  return {
    get(key) {
      const raw = GM_getValue(key, "");
      if (raw === undefined || raw === null || raw === "") {
        return null;
      }
      return String(raw);
    },
    set(key, value) {
      GM_setValue(key, value);
    },
    remove(key) {
      GM_deleteValue(key);
    },
  };
}

function gmApisAvailable(): boolean {
  return (
    typeof GM_getValue === "function" &&
    typeof GM_setValue === "function" &&
    typeof GM_deleteValue === "function"
  );
}

let tokenStorage: SecretStorage = gmApisAvailable()
  ? createGmSecretStorage()
  : createMemorySecretStorage();

/** Override secret backend (tests / bootstrap). */
export function setTokenStorage(storage: SecretStorage): void {
  tokenStorage = storage;
}

export function getTokenStorage(): SecretStorage {
  return tokenStorage;
}

/**
 * One-shot migration: move legacy page-localStorage token into private storage.
 */
function migrateLegacyToken(pageStorage: SettingsStorage): void {
  const legacy = pageStorage.getItem(STORAGE_KEYS.token);
  if (!legacy) {
    return;
  }
  if (!tokenStorage.get(STORAGE_KEYS.token)) {
    tokenStorage.set(STORAGE_KEYS.token, legacy);
  }
  pageStorage.removeItem(STORAGE_KEYS.token);
}

function parseMode(raw: string | null): NetworkMode {
  if (raw === "OFF" || raw === "MANUAL" || raw === "ENABLED") {
    return raw;
  }
  return DEFAULT_MODE;
}

export function getServerSettings(
  storage: SettingsStorage = localStorage,
): ServerSettings {
  migrateLegacyToken(storage);
  return {
    baseUrl: storage.getItem(STORAGE_KEYS.baseUrl) ?? "",
    token: tokenStorage.get(STORAGE_KEYS.token) ?? "",
    networkMode: parseMode(storage.getItem(STORAGE_KEYS.networkMode)),
  };
}

export function saveServerSettings(
  patch: Partial<ServerSettings>,
  storage: SettingsStorage = localStorage,
): ServerSettings {
  const current = getServerSettings(storage);
  const next: ServerSettings = {
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl.trim() : current.baseUrl,
    token: patch.token !== undefined ? patch.token.trim() : current.token,
    networkMode: patch.networkMode ?? current.networkMode,
  };
  storage.setItem(STORAGE_KEYS.baseUrl, next.baseUrl);
  storage.setItem(STORAGE_KEYS.networkMode, next.networkMode);
  if (next.token) {
    tokenStorage.set(STORAGE_KEYS.token, next.token);
  } else {
    tokenStorage.remove(STORAGE_KEYS.token);
  }
  // Never persist token on the Studio page origin.
  storage.removeItem(STORAGE_KEYS.token);
  return next;
}

export function clearServerToken(
  storage: SettingsStorage = localStorage,
): void {
  tokenStorage.remove(STORAGE_KEYS.token);
  storage.removeItem(STORAGE_KEYS.token);
}

/** Test helper. */
export function clearServerSettings(
  storage: SettingsStorage = localStorage,
): void {
  storage.removeItem(STORAGE_KEYS.baseUrl);
  storage.removeItem(STORAGE_KEYS.token);
  storage.removeItem(STORAGE_KEYS.networkMode);
  tokenStorage.remove(STORAGE_KEYS.token);
}
