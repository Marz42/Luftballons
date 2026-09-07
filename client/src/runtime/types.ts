import type { Capability } from "./capability.js";
import type { CapabilityContext } from "./capability-manager.js";
import type { CollectionService } from "../services/collection-service.js";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface ModuleAvailability {
  available: boolean;
  reason?:
    | "WRONG_SITE"
    | "UNSUPPORTED_LAYOUT"
    | "WRONG_PAGE"
    | "DISABLED"
    | "MISSING_REQUIREMENT";
  metadata?: Record<string, unknown>;
}

export interface DetectContext {
  hostname: string;
  href: string;
  logger: Logger;
}

export interface TaskWarning {
  code: string;
  message: string;
}

export interface TaskResult {
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  summary: string;
  collectionIds?: string[];
  warnings?: TaskWarning[];
}

export interface HumanGateAction {
  capability: "WRITE_COMMIT";
  title: string;
  description: string;
  consequences: string[];
  reversible: false;
}

export interface HumanGateService {
  request(action: HumanGateAction): Promise<"APPROVED" | "REJECTED">;
}

/**
 * TaskContext (IMPLEMENTATION §6).
 * Phase 1 adds collections. DOM / navigation / config arrive in later phases.
 */
export interface TaskContext {
  taskId: string;
  capabilities: CapabilityContext;
  logger: Logger;
  signal: AbortSignal;
  humanGate: HumanGateService;
  collections: CollectionService;
}

export interface LuftballonsModule {
  id: string;
  name: string;
  version: string;
  site: "youtube-studio";
  capabilities: Capability[];
  detect(ctx: DetectContext): Promise<ModuleAvailability>;
  run(ctx: TaskContext): Promise<TaskResult>;
  cleanup?(): Promise<void>;
}

export type TaskState =
  | "IDLE"
  | "RUNNING"
  | "WAITING"
  | "WAITING_HUMAN"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

export interface TaskSnapshot {
  taskId: string;
  moduleId: string;
  state: TaskState;
  progressMessage?: string;
  result?: TaskResult;
  errorMessage?: string;
}

export type TaskListener = (snapshot: TaskSnapshot) => void;
