/**
 * NetworkService (IMPLEMENTATION §21) — modules must not call fetch directly.
 * Phase 5a: sendCollection + register; getConfig/sendError are P5b stubs.
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
  registerInstallation,
  sendCollection,
  type RegisterInstallationResult,
  type RemoteResult,
} from "../sinks/remote-sink.js";
import {
  getOrCreateInstallation,
  setInstallation,
  type InstallationIdentity,
} from "../schemas/installation.js";

/** P5b placeholder — not fetched in Phase 5a. */
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

export interface ErrorRecord {
  moduleId?: string;
  message: string;
  capturedAt: string;
}

export interface NetworkService {
  getNetworkMode(): NetworkMode;
  setNetworkMode(mode: NetworkMode): void;
  getSettings(): ServerSettings;
  saveSettings(patch: Partial<ServerSettings>): ServerSettings;

  /** P5b: returns null (no Config API this phase). */
  getConfig(): Promise<RemoteConfig | null>;

  sendCollection(collection: Collection<unknown>): Promise<RemoteResult>;

  /** P5b stub — does not network. */
  sendError?(error: ErrorRecord): Promise<RemoteResult>;

  registerInstallation(options?: {
    displayName?: string;
  }): Promise<RegisterInstallationResult>;
}

export interface CreateNetworkServiceOptions {
  storage?: SettingsStorage;
  logger?: Logger;
  runtimeVersion?: string;
  fetchImpl?: typeof fetch;
  /**
   * After successful server register, persist installation_id locally.
   * Token is saved via saveSettings by the caller/UI (or here).
   */
  persistInstallation?: (identity: InstallationIdentity) => void;
  getInstallationId?: () => string;
}

/**
 * OFF → zero network from this service.
 * MANUAL (default) → sendCollection only when explicitly invoked (sync button).
 * ENABLED reserved for later auto-sync; Phase 5a collectors never call this service.
 */
export function createNetworkService(
  options: CreateNetworkServiceOptions = {},
): NetworkService {
  const storage = options.storage ?? localStorage;
  const logger = options.logger;
  const runtimeVersion = options.runtimeVersion ?? "0.1.0";
  const fetchImpl = options.fetchImpl;

  const persistIdentity = (identity: InstallationIdentity): void => {
    if (options.persistInstallation) {
      options.persistInstallation(identity);
    } else {
      setInstallation(identity, storage);
    }
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
      // Never put token into logger context.
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

    async getConfig(): Promise<RemoteConfig | null> {
      // Phase 5b — Config API not implemented.
      return null;
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

    async sendError(_error: ErrorRecord): Promise<RemoteResult> {
      return {
        status: "FAILED",
        message: "Error API 尚未实现（Phase 5b）",
      };
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
        // Log success without token.
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

  // Touch local installation so identity exists before optional register.
  if (options.getInstallationId) {
    options.getInstallationId();
  } else {
    getOrCreateInstallation(storage);
  }

  return service;
}
