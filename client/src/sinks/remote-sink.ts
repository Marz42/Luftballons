/**
 * RemoteSink (IMPLEMENTATION §20) — sole network egress for collection ingest.
 *
 * Endpoint = user-configured base URL + bundled relative path map.
 * Remote config (future) may only enable/disable aliases — never change URLs.
 */

import type { Capability } from "../runtime/capability.js";
import type { Collection } from "../schemas/collection.js";
import type { Sink, SinkResult } from "./sink.js";

/** Bundled path map — not remotely overridable. */
export const ENDPOINT_PATHS = {
  ingestV1: "/api/v1/collections",
  registerV1: "/api/v1/installations/register",
} as const;

export type EndpointAlias = keyof typeof ENDPOINT_PATHS;

export interface RemoteResult {
  status: "OK" | "FAILED";
  message?: string;
  alreadyIngested?: boolean;
  httpStatus?: number;
}

export interface SendCollectionOptions {
  baseUrl: string;
  token: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface RegisterInstallationOptions {
  baseUrl: string;
  displayName?: string;
  runtimeVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface RegisterInstallationResult {
  status: "OK" | "FAILED";
  message?: string;
  installationId?: string;
  /** Shown once to the user — caller must not log this. */
  token?: string;
  apiVersion?: string;
}

/**
 * Reject non-http(s). Allows LAN IPs (http://192.168.x.x:8000).
 */
export function assertHttpBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("服务器地址不能为空");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("服务器地址无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址仅支持 http 或 https");
  }
  // Drop path/query/hash from "base" — paths come from ENDPOINT_PATHS only.
  // If user includes a path prefix (reverse proxy), keep pathname (no trailing slash).
  const prefix = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${prefix === "/" ? "" : prefix}`;
}

export function resolveEndpoint(baseUrl: string, alias: EndpointAlias): string {
  const base = assertHttpBaseUrl(baseUrl);
  const path = ENDPOINT_PATHS[alias];
  return `${base}${path}`;
}

function collectionToIngestBody(collection: Collection<unknown>): Record<string, unknown> {
  return {
    collection_id: collection.collectionId,
    installation_id: collection.installationId,
    collector: collection.collector,
    collector_version: collection.collectorVersion,
    schema_version: collection.schemaVersion,
    captured_at: collection.capturedAt,
    status: collection.status,
    data: collection.data,
  };
}

/**
 * POST collection to ingestV1. Only network egress for sync (besides register).
 */
export async function sendCollection(
  collection: Collection<unknown>,
  options: SendCollectionOptions,
): Promise<RemoteResult> {
  let url: string;
  try {
    url = resolveEndpoint(options.baseUrl, "ingestV1");
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify(collectionToIngestBody(collection)),
    });

    if (response.status === 201 || response.status === 200) {
      let alreadyIngested = response.status === 200;
      try {
        const json: unknown = await response.json();
        if (
          typeof json === "object" &&
          json !== null &&
          "already_ingested" in json &&
          typeof (json as { already_ingested: unknown }).already_ingested ===
            "boolean"
        ) {
          alreadyIngested = (json as { already_ingested: boolean })
            .already_ingested;
        }
      } catch {
        // Body optional for success semantics.
      }
      return {
        status: "OK",
        alreadyIngested,
        httpStatus: response.status,
        message: alreadyIngested ? "已存在（幂等）" : "同步成功",
      };
    }

    if (response.status === 401) {
      return {
        status: "FAILED",
        httpStatus: 401,
        message: "鉴权失败（token 无效或已禁用）",
      };
    }

    return {
      status: "FAILED",
      httpStatus: response.status,
      message: `同步失败（HTTP ${response.status}）`,
    };
  } catch {
    return {
      status: "FAILED",
      message: "同步失败（网络错误）",
    };
  }
}

/**
 * POST register — returns plaintext token once. Caller must not log token.
 */
export async function registerInstallation(
  options: RegisterInstallationOptions,
): Promise<RegisterInstallationResult> {
  let url: string;
  try {
    url = resolveEndpoint(options.baseUrl, "registerV1");
  } catch (error) {
    return {
      status: "FAILED",
      message: error instanceof Error ? error.message : "无效的服务器地址",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, string> = {};
  if (options.displayName) {
    body.display_name = options.displayName;
  }
  if (options.runtimeVersion) {
    body.runtime_version = options.runtimeVersion;
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return {
        status: "FAILED",
        message: `注册失败（HTTP ${response.status}）`,
      };
    }
    const json: unknown = await response.json();
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { installation_id?: unknown }).installation_id !==
        "string" ||
      typeof (json as { token?: unknown }).token !== "string"
    ) {
      return { status: "FAILED", message: "注册响应无效" };
    }
    const data = json as {
      installation_id: string;
      token: string;
      api_version?: string;
    };
    return {
      status: "OK",
      installationId: data.installation_id,
      token: data.token,
      ...(data.api_version !== undefined
        ? { apiVersion: data.api_version }
        : {}),
      message: "注册成功（请妥善保存 token，仅显示一次）",
    };
  } catch {
    return { status: "FAILED", message: "注册失败（网络错误）" };
  }
}

export interface RemoteSinkOptions {
  getBaseUrl: () => string;
  getToken: () => string;
  /** When false, write() fails closed without fetch. */
  isSendAllowed: () => boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Sink adapter — capability NETWORK_SEND. Does not accept arbitrary URLs.
 */
export class RemoteSink implements Sink {
  readonly id = "remote";
  readonly capability: Capability = "NETWORK_SEND";

  private readonly getBaseUrl: () => string;
  private readonly getToken: () => string;
  private readonly isSendAllowed: () => boolean;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: RemoteSinkOptions) {
    this.getBaseUrl = options.getBaseUrl;
    this.getToken = options.getToken;
    this.isSendAllowed = options.isSendAllowed;
    this.fetchImpl = options.fetchImpl;
  }

  async available(): Promise<boolean> {
    if (!this.isSendAllowed()) {
      return false;
    }
    try {
      assertHttpBaseUrl(this.getBaseUrl());
    } catch {
      return false;
    }
    return this.getToken().length > 0;
  }

  async write(collection: Collection<unknown>): Promise<SinkResult> {
    if (!this.isSendAllowed()) {
      return {
        status: "FAILED",
        message: "网络模式为 OFF，已跳过远程同步",
      };
    }
    const result = await sendCollection(collection, {
      baseUrl: this.getBaseUrl(),
      token: this.getToken(),
      ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (result.status === "OK") {
      return {
        status: "OK",
        ...(result.message !== undefined ? { message: result.message } : {}),
      };
    }
    return {
      status: "FAILED",
      message: result.message ?? "远程同步失败",
    };
  }
}
