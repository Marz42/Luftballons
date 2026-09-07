/**
 * NetworkService (IMPLEMENTATION §21) — modules must not call fetch directly.
 * Phase 5b: getConfig + sendError + OFF zero-network.
 */

import type { Collection } from "../schemas/collection.js";
import type { Logger } from "../runtime/types.js";
import {
  getServerSettings,
  saveServerSettings,
  type NetworkMode,
  type ServerSettings,
  type SettingsStorage,
} from "./network-settings.js";
import {
  applyFreshConfig,
  fetchConfig,
  resolveBootstrapConfig,
  type AppliedConfigState,
  type RemoteConfig,
} from "./config-service.js";
import {
  registerInstallation,
  sendCollection,
  sendError,
  type RegisterInstallationResult,
  type RemoteResult,
} from "../sinks/remote-sink.js";
import {
  getOrCreateInstallation,
  setInstallation,
  type InstallationIdentity,
} from "../schemas/installation.js";

export type { RemoteConfig, AppliedConfigState };

export interface ErrorRecord {
  installationId?: string;
  module?: string;
  moduleVersion?: string;
  runtimeVersion?: string;
  page?: string;
  taskState?: string;
  errorCode?: string;
  message: string;
  layoutSignature?: string;
  /** @deprecated use module */
  moduleId?: string;
  capturedAt?: string;
}

export interface NetworkService {
  getNetworkMode(): NetworkMode;
  setNetworkMode(mode: NetworkMode): void;
  getSettings(): ServerSettings;
  saveSettings(patch: Partial<ServerSettings>): ServerSettings;

  /** Applied remote config (defaults / cached / fresh). Never blocks startup. */
  getAppliedConfig(): AppliedConfigState;

  /**
   * Fetch remote config when network allows. On failure keep previous applied.
   * OFF → no network; returns current applied.
   */
  getConfig(): Promise<RemoteConfig | null>;

  /** Human-triggered refresh (SPEC §3.2). OFF → refused, zero fetch. */
  refreshConfig(): Promise<AppliedConfigState>;

  sendCollection(collection: Collection<unknown>): Promise<RemoteResult>;

  sendError(error: ErrorRecord): Promise<RemoteResult>;

  registerInstallation(options?: {
    displayName?: string;
  }): Promise<RegisterInstallationResult>;
}

export interface CreateNetworkServiceOptions {
  storage?: SettingsStorage;
  logger?: Logger;
  runtimeVersion?: string;
  fetchImpl?: typeof fetch;
  persistInstallation?: (identity: InstallationIdentity) => void;
  getInstallationId?: () => string;
  /** Seed applied config (tests / bootstrap after cache load). */
  initialApplied?: AppliedConfigState;
}

/**
 * OFF → zero network from this service.
 * MANUAL (default) → sync/config only when explicitly invoked.
 * ENABLED reserved for later auto-sync.
 */
export function createNetworkService(
  options: CreateNetworkServiceOptions = {},
): NetworkService {
  const storage = options.storage ?? localStorage;
  const logger = options.logger;
  const runtimeVersion = options.runtimeVersion ?? "0.1.0";
  const fetchImpl = options.fetchImpl;

  let applied: AppliedConfigState =
    options.initialApplied ?? resolveBootstrapConfig(storage);

  const persistIdentity = (identity: InstallationIdentity): void => {
    if (options.persistInstallation) {
      options.persistInstallation(identity);
    } else {
      setInstallation(identity, storage);
    }
  };

  const markRefreshFailed = (message: string): AppliedConfigState => {
    const at = new Date().toISOString();
    applied = {
      ...applied,
      lastRefresh: { ok: false, at, message },
    };
    return applied;
  };

  const doRefresh = async (): Promise<AppliedConfigState> => {
    const settings = getServerSettings(storage);
    if (settings.networkMode === "OFF") {
      logger?.warn("Config refresh skipped: network mode OFF");
      return markRefreshFailed("网络模式为 OFF，已跳过配置刷新");
    }
    if (!settings.baseUrl || !settings.token) {
      return markRefreshFailed("未配置服务器地址或 token");
    }

    const result = await fetchConfig({
      baseUrl: settings.baseUrl,
      token: settings.token,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });

    if (result.status === "OK") {
      applied = applyFreshConfig(result.config, storage);
      logger?.info("Remote config refreshed", {
        source: applied.source,
        moduleKeys: Object.keys(result.config.modules),
      });
      return applied;
    }

    logger?.warn("Remote config refresh failed; keeping prior config", {
      message: result.message,
      httpStatus: result.httpStatus,
      source: applied.source,
    });
    return markRefreshFailed(result.message);
  };

  const service: NetworkService = {
    getNetworkMode(): NetworkMode {
      return getServerSettings(storage).networkMode;
    },

    setNetworkMode(mode: NetworkMode): void {
      saveServerSettings({ networkMode: mode }, storage);
      logger?.info("Network mode updated", { networkMode: mode });
    },

    getSettings(): ServerSettings {
      return getServerSettings(storage);
    },

    saveSettings(patch: Partial<ServerSettings>): ServerSettings {
      const keys = Object.keys(patch).filter((k) => k !== "token");
      const saved = saveServerSettings(patch, storage);
      logger?.info("Server settings saved", {
        fields: keys,
        hasToken: Boolean(saved.token),
        baseUrlSet: Boolean(saved.baseUrl),
        networkMode: saved.networkMode,
      });
      return saved;
    },

    getAppliedConfig(): AppliedConfigState {
      return applied;
    },

    async getConfig(): Promise<RemoteConfig | null> {
      const settings = getServerSettings(storage);
      if (settings.networkMode === "OFF") {
        return applied.config;
      }
      const next = await doRefresh();
      return next.source === "fresh" ? next.config : applied.config;
    },

    async refreshConfig(): Promise<AppliedConfigState> {
      return doRefresh();
    },

    async sendCollection(
      collection: Collection<unknown>,
    ): Promise<RemoteResult> {
      const settings = getServerSettings(storage);
      if (settings.networkMode === "OFF") {
        logger?.warn("Sync skipped: network mode OFF");
        return {
          status: "FAILED",
          message: "网络模式为 OFF，已跳过远程同步",
        };
      }

      const result = await sendCollection(collection, {
        baseUrl: settings.baseUrl,
        token: settings.token,
        ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      });

      if (result.status === "OK") {
        logger?.info("Collection sync OK", {
          collectionId: collection.collectionId,
          alreadyIngested: result.alreadyIngested === true,
          httpStatus: result.httpStatus,
        });
      } else {
        logger?.error("Collection sync failed", {
          collectionId: collection.collectionId,
          message: result.message,
          httpStatus: result.httpStatus,
        });
      }
      return result;
    },

    async sendError(error: ErrorRecord): Promise<RemoteResult> {
      const settings = getServerSettings(storage);
      if (settings.networkMode === "OFF") {
        logger?.warn("Error upload skipped: network mode OFF");
        return {
          status: "FAILED",
          message: "网络模式为 OFF，已跳过错误上报",
        };
      }

      const installationId =
        error.installationId ??
        (options.getInstallationId
          ? options.getInstallationId()
          : getOrCreateInstallation(storage).installationId);

      const result = await sendError({
        baseUrl: settings.baseUrl,
        token: settings.token,
        body: {
          installation_id: installationId,
          message: error.message,
          ...(error.module !== undefined
            ? { module: error.module }
            : error.moduleId !== undefined
              ? { module: error.moduleId }
              : {}),
          ...(error.moduleVersion !== undefined
            ? { module_version: error.moduleVersion }
            : {}),
          ...(error.runtimeVersion !== undefined
            ? { runtime_version: error.runtimeVersion }
            : { runtime_version: runtimeVersion }),
          ...(error.page !== undefined ? { page: error.page } : {}),
          ...(error.taskState !== undefined
            ? { task_state: error.taskState }
            : {}),
          ...(error.errorCode !== undefined
            ? { error_code: error.errorCode }
            : {}),
          ...(error.layoutSignature !== undefined
            ? { layout_signature: error.layoutSignature }
            : {}),
        },
        ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      });

      if (result.status === "OK") {
        logger?.info("Error uploaded", { errorCode: error.errorCode });
      } else {
        logger?.warn("Error upload failed", { message: result.message });
      }
      return result;
    },

    async registerInstallation(registerOptions = {}): Promise<RegisterInstallationResult> {
      const settings = getServerSettings(storage);
      if (settings.networkMode === "OFF") {
        return {
          status: "FAILED",
          message: "网络模式为 OFF，无法注册",
        };
      }

      const result = await registerInstallation({
        baseUrl: settings.baseUrl,
        runtimeVersion,
        ...(registerOptions.displayName !== undefined
          ? { displayName: registerOptions.displayName }
          : {}),
        ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      });

      if (result.status === "OK" && result.installationId && result.token) {
        const identity: InstallationIdentity = {
          installationId: result.installationId,
          createdAt: new Date().toISOString(),
          ...(registerOptions.displayName
            ? { displayName: registerOptions.displayName }
            : {}),
        };
        persistIdentity(identity);
        saveServerSettings({ token: result.token }, storage);
        logger?.info("Installation registered", {
          installationId: result.installationId,
          apiVersion: result.apiVersion,
        });
      } else if (result.status === "FAILED") {
        logger?.error("Installation register failed", {
          message: result.message,
        });
      }
      return result;
    },
  };

  if (options.getInstallationId) {
    options.getInstallationId();
  } else {
    getOrCreateInstallation(storage);
  }

  return service;
}
