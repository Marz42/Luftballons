/**
 * Network / server settings persistence (IMPLEMENTATION §22 / §26).
 * Token stored separately from installation_id; never log token plaintext.
 */

export type NetworkMode = "OFF" | "MANUAL" | "ENABLED";

export interface ServerSettings {
  baseUrl: string;
  /** Installation Bearer token — localStorage only; never log. */
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

function parseMode(raw: string | null): NetworkMode {
  if (raw === "OFF" || raw === "MANUAL" || raw === "ENABLED") {
    return raw;
  }
  return DEFAULT_MODE;
}

export function getServerSettings(
  storage: SettingsStorage = localStorage,
): ServerSettings {
  return {
    baseUrl: storage.getItem(STORAGE_KEYS.baseUrl) ?? "",
    token: storage.getItem(STORAGE_KEYS.token) ?? "",
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
  storage.setItem(STORAGE_KEYS.token, next.token);
  storage.setItem(STORAGE_KEYS.networkMode, next.networkMode);
  return next;
}

export function clearServerToken(
  storage: SettingsStorage = localStorage,
): void {
  storage.removeItem(STORAGE_KEYS.token);
}

/** Test helper. */
export function clearServerSettings(
  storage: SettingsStorage = localStorage,
): void {
  storage.removeItem(STORAGE_KEYS.baseUrl);
  storage.removeItem(STORAGE_KEYS.token);
  storage.removeItem(STORAGE_KEYS.networkMode);
}
