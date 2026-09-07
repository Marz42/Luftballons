/**
 * Remote Config service (IMPLEMENTATION §23–§25, SPEC §26–§28).
 *
 * Validation policy (documented):
 * - Unknown root keys → ignored
 * - Forbidden execution keys (script/selector/url/…) → reject entire payload
 * - Wrong types → reject entire payload
 * - Any validation failure → keep applied cached/defaults; never block Runtime start
 *
 * Refresh strategy: single background attempt after bootstrap + human-triggered
 * [立即刷新]. No automatic retry storm / unbounded backoff.
 */

import {
  assertHttpBaseUrl,
  ENDPOINT_PATHS,
  resolveEndpoint,
} from "../sinks/remote-sink.js";
import type { Logger } from "../runtime/types.js";
import type { SettingsStorage } from "./network-settings.js";

export interface RemoteConfig {
  schemaVersion: 1;
  modules: Record<
    string,
    {
      enabled: boolean;
      killSwitch?: boolean;
    }
  >;
  minRuntimeVersion?: string;
  features?: Record<string, boolean>;
}

export type ConfigSource = "defaults" | "cached" | "fresh";

export interface AppliedConfigState {
  source: ConfigSource;
  config: RemoteConfig;
  fetchedAt?: string;
  revision?: number;
  lastRefresh?: {
    ok: boolean;
    at: string;
    message?: string;
  };
}

export interface CachedRemoteConfig {
  payload: RemoteConfig;
  fetchedAt: string;
  revision?: number;
}

export const REMOTE_CONFIG_STORAGE_KEY = "luftballons.remoteConfig";

export const BUNDLED_REMOTE_CONFIG: RemoteConfig = {
  schemaVersion: 1,
  modules: {},
};

const FORBIDDEN_KEYS = new Set([
  "script",
  "javascript",
  "selector",
  "url",
  "request",
  "command",
  "action",
  "xpath",
  "html",
  "cookie",
  "cookies",
  "eval",
  "code",
]);

const ALLOWED_ROOT = new Set([
  "schemaVersion",
  "modules",
  "minRuntimeVersion",
  "features",
]);

function isForbiddenKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (FORBIDDEN_KEYS.has(lowered)) {
    return true;
  }
  for (const bad of ["script", "javascript", "selector", "xpath", "eval"]) {
    if (lowered.includes(bad)) {
      return true;
    }
  }
  return false;
}

export type ValidateResult =
  | { ok: true; config: RemoteConfig }
  | { ok: false; reason: string };

/**
 * Strict runtime validation. Returns rejected reason on failure.
 */
export function validateRemoteConfig(raw: unknown): ValidateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "config is not an object" };
  }
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (isForbiddenKey(key)) {
      return { ok: false, reason: `forbidden key: ${key}` };
    }
  }

  if (!("schemaVersion" in obj) || obj.schemaVersion !== 1) {
    return { ok: false, reason: "schemaVersion must be 1" };
  }

  if (!("modules" in obj) || typeof obj.modules !== "object" || obj.modules === null || Array.isArray(obj.modules)) {
    return { ok: false, reason: "modules must be an object" };
  }

  const modulesIn = obj.modules as Record<string, unknown>;
  const modules: RemoteConfig["modules"] = {};

  for (const [modId, entry] of Object.entries(modulesIn)) {
    if (typeof modId !== "string" || !modId) {
      return { ok: false, reason: "module id must be a non-empty string" };
    }
    if (isForbiddenKey(modId)) {
      return { ok: false, reason: `forbidden module id: ${modId}` };
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `module ${modId}: entry must be object` };
    }
    const e = entry as Record<string, unknown>;
    for (const ek of Object.keys(e)) {
      if (isForbiddenKey(ek)) {
        return { ok: false, reason: `forbidden key in module ${modId}: ${ek}` };
      }
      if (ek !== "enabled" && ek !== "killSwitch") {
        // Unknown module fields ignored (same policy as unknown root keys).
        continue;
      }
    }
    if (!("enabled" in e) || typeof e.enabled !== "boolean") {
      return { ok: false, reason: `module ${modId}: enabled must be boolean` };
    }
    const clean: { enabled: boolean; killSwitch?: boolean } = {
      enabled: e.enabled,
    };
    if ("killSwitch" in e) {
      if (typeof e.killSwitch !== "boolean") {
        return {
          ok: false,
          reason: `module ${modId}: killSwitch must be boolean`,
        };
      }
      clean.killSwitch = e.killSwitch;
    }
    modules[modId] = clean;
  }

  const out: RemoteConfig = { schemaVersion: 1, modules };

  if ("minRuntimeVersion" in obj && obj.minRuntimeVersion !== undefined) {
    if (typeof obj.minRuntimeVersion !== "string") {
      return { ok: false, reason: "minRuntimeVersion must be string" };
    }
    out.minRuntimeVersion = obj.minRuntimeVersion;
  }

  if ("features" in obj && obj.features !== undefined) {
    if (
      typeof obj.features !== "object" ||
      obj.features === null ||
      Array.isArray(obj.features)
    ) {
      return { ok: false, reason: "features must be an object" };
    }
    const features: Record<string, boolean> = {};
    for (const [fk, fv] of Object.entries(
      obj.features as Record<string, unknown>,
    )) {
      if (isForbiddenKey(fk)) {
        return { ok: false, reason: `forbidden feature key: ${fk}` };
      }
      if (typeof fv !== "boolean") {
        return { ok: false, reason: `feature ${fk}: must be boolean` };
      }
      features[fk] = fv;
    }
    out.features = features;
  }

  // Unknown root keys already skipped by only reading allowlist fields above;
  // ensure we did not require them. Document: ignored.
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_ROOT.has(key) && !isForbiddenKey(key)) {
      // ignored intentionally
    }
  }

  return { ok: true, config: out };
}

/** Compare dotted semver-like strings (major.minor.patch); non-numeric → 0. */
export function isRuntimeAtLeast(current: string, minimum: string): boolean {
  const parse = (v: string): number[] =>
    v.split(".").map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const a = parse(current);
  const b = parse(minimum);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) {
      return true;
    }
    if (x < y) {
      return false;
    }
  }
  return true;
}

export function loadCachedRemoteConfig(
  storage: SettingsStorage = localStorage,
): CachedRemoteConfig | null {
  const raw = storage.getItem(REMOTE_CONFIG_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const bag = parsed as Record<string, unknown>;
    const validated = validateRemoteConfig(bag.payload);
    if (!validated.ok) {
      return null;
    }
    if (typeof bag.fetchedAt !== "string") {
      return null;
    }
    const cached: CachedRemoteConfig = {
      payload: validated.config,
      fetchedAt: bag.fetchedAt,
    };
    if (typeof bag.revision === "number") {
      cached.revision = bag.revision;
    }
    return cached;
  } catch {
    return null;
  }
}

export function saveCachedRemoteConfig(
  cached: CachedRemoteConfig,
  storage: SettingsStorage = localStorage,
): void {
  storage.setItem(REMOTE_CONFIG_STORAGE_KEY, JSON.stringify(cached));
}

export function clearCachedRemoteConfig(
  storage: SettingsStorage = localStorage,
): void {
  storage.removeItem(REMOTE_CONFIG_STORAGE_KEY);
}

export interface FetchConfigOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export type FetchConfigResult =
  | { status: "OK"; config: RemoteConfig; httpStatus: number }
  | { status: "FAILED"; message: string; httpStatus?: number };

/**
 * GET /api/v1/config — sole config network egress (uses fetch).
 */
export async function fetchConfig(
  options: FetchConfigOptions,
): Promise<FetchConfigResult> {
  let url: string;
  try {
    // Keep path construction via bundled ENDPOINT_PATHS only.
    void ENDPOINT_PATHS.configV1;
    url = resolveEndpoint(options.baseUrl, "configV1");
  } catch (error) {
    return {
      status: "FAILED",
      message: error instanceof Error ? error.message : "无效的服务器地址",
    };
  }

  if (!options.token) {
    return { status: "FAILED", message: "未配置 Installation Token" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      return {
        status: "FAILED",
        httpStatus: 401,
        message: "鉴权失败（token 无效或已禁用）",
      };
    }
    if (!response.ok) {
      return {
        status: "FAILED",
        httpStatus: response.status,
        message: `配置拉取失败（HTTP ${response.status}）`,
      };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return {
        status: "FAILED",
        httpStatus: response.status,
        message: "配置响应不是合法 JSON",
      };
    }

    const validated = validateRemoteConfig(json);
    if (!validated.ok) {
      return {
        status: "FAILED",
        httpStatus: response.status,
        message: `配置校验失败：${validated.reason}`,
      };
    }

    return {
      status: "OK",
      config: validated.config,
      httpStatus: response.status,
    };
  } catch {
    return { status: "FAILED", message: "配置拉取失败（网络错误）" };
  }
}

export function createInitialAppliedState(): AppliedConfigState {
  return {
    source: "defaults",
    config: { ...BUNDLED_REMOTE_CONFIG, modules: {} },
  };
}

/**
 * Resolve bootstrap config: Defaults → Cached (if valid). Fresh is separate.
 */
export function resolveBootstrapConfig(
  storage: SettingsStorage = localStorage,
): AppliedConfigState {
  const cached = loadCachedRemoteConfig(storage);
  if (cached) {
    return {
      source: "cached",
      config: cached.payload,
      fetchedAt: cached.fetchedAt,
      ...(cached.revision !== undefined ? { revision: cached.revision } : {}),
    };
  }
  return createInitialAppliedState();
}

export function applyFreshConfig(
  config: RemoteConfig,
  storage: SettingsStorage = localStorage,
  revision?: number,
): AppliedConfigState {
  const fetchedAt = new Date().toISOString();
  const cached: CachedRemoteConfig = { payload: config, fetchedAt };
  if (revision !== undefined) {
    cached.revision = revision;
  }
  saveCachedRemoteConfig(cached, storage);
  return {
    source: "fresh",
    config,
    fetchedAt,
    ...(revision !== undefined ? { revision } : {}),
    lastRefresh: { ok: true, at: fetchedAt, message: "刷新成功" },
  };
}

/** Re-export for callers that only need URL checks. */
export { assertHttpBaseUrl };

export interface ConfigRefreshLogger {
  warn?: Logger["warn"];
  info?: Logger["info"];
}
