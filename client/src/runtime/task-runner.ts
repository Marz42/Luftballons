import { CapabilityManager } from "./capability-manager.js";
import {
  ModuleUnavailableError,
  TaskBusyError,
  TaskNotFoundError,
} from "./errors.js";
import { PlaceholderHumanGate } from "./human-gate.js";
import type { ModuleRegistry } from "./module-registry.js";
import type {
  HumanGateService,
  Logger,
  TaskContext,
  TaskListener,
  TaskResult,
  TaskSnapshot,
  TaskState,
} from "./types.js";
import {
  NoopCollectionService,
  type CollectionService,
} from "../services/collection-service.js";

export interface TaskRunnerOptions {
  registry: ModuleRegistry;
  logger: Logger;
  humanGate?: HumanGateService;
  /** Defaults to NoopCollectionService for Phase 0 backward compatibility. */
  collectionService?: CollectionService;
  createTaskId?: () => string;
  /**
   * Hostname used when modules re-check availability at start.
   * Defaults to window.location when available.
   */
  getLocation?: () => { hostname: string; href: string };
}

interface InternalTask {
  taskId: string;
  moduleId: string;
  state: TaskState;
  progressMessage?: string;
  result?: TaskResult;
  errorMessage?: string;
  controller: AbortController;
}

function defaultTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultLocation(): { hostname: string; href: string } {
  if (typeof window !== "undefined" && window.location) {
    return {
      hostname: window.location.hostname,
      href: window.location.href,
    };
  }
  return { hostname: "", href: "" };
}

export class TaskRunner {
  private readonly registry: ModuleRegistry;
  private readonly logger: Logger;
  private readonly humanGate: HumanGateService;
  private readonly collectionService: CollectionService;
  private readonly createTaskId: () => string;
  private readonly getLocation: () => { hostname: string; href: string };
  private readonly tasks = new Map<string, InternalTask>();
  private readonly listeners = new Set<TaskListener>();
  private activeTaskId: string | null = null;

  constructor(options: TaskRunnerOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
    this.humanGate = options.humanGate ?? new PlaceholderHumanGate();
    this.collectionService =
      options.collectionService ?? new NoopCollectionService();
    this.createTaskId = options.createTaskId ?? defaultTaskId;
    this.getLocation = options.getLocation ?? defaultLocation;
  }

  /** Exposed for UI / tests — same instance injected into TaskContext. */
  getCollections(): CollectionService {
    return this.collectionService;
  }

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  getState(taskId: string): TaskState {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task.state;
  }

  getSnapshot(taskId: string): TaskSnapshot {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return this.toSnapshot(task);
  }

  listSnapshots(): TaskSnapshot[] {
    return [...this.tasks.values()].map((task) => this.toSnapshot(task));
  }

  async start(moduleId: string): Promise<string> {
    // Ownership is activeTaskId, not UI TaskState — claim before any await.
    if (this.activeTaskId !== null) {
      throw new TaskBusyError();
    }

    const module = this.registry.require(moduleId);
    const taskId = this.createTaskId();
    const controller = new AbortController();
    const task: InternalTask = {
      taskId,
      moduleId,
      state: "RUNNING",
      progressMessage: "Starting…",
      controller,
    };
    this.tasks.set(taskId, task);
    this.activeTaskId = taskId;
    this.emit(task);

    const location = this.getLocation();
    let availability;
    try {
      availability = await module.detect({
        hostname: location.hostname,
        href: location.href,
        logger: this.logger,
      });
    } catch (error) {
      this.releaseStartLock(task);
      throw error;
    }

    if (task.state === "CANCELLED" || controller.signal.aborted) {
      this.finalizeCancelled(task);
      return taskId;
    }

    if (!availability.available) {
      this.releaseStartLock(task);
      throw new ModuleUnavailableError(moduleId, availability.reason);
    }

    this.logger.info("Task started", { taskId, moduleId });

    const capabilities = new CapabilityManager(module.capabilities);
    const ctx: TaskContext = {
      taskId,
      capabilities,
      logger: this.logger.child({ taskId, moduleId }),
      signal: controller.signal,
      humanGate: this.humanGate,
      collections: this.collectionService,
      setProgress: (message, state = "RUNNING") => {
        this.setProgress(taskId, message, state);
      },
    };

    void this.runModule(task, module.run.bind(module), ctx);
    return taskId;
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    if (
      task.state !== "RUNNING" &&
      task.state !== "WAITING" &&
      task.state !== "WAITING_HUMAN"
    ) {
      return;
    }
    task.controller.abort();
    task.state = "CANCELLED";
    task.progressMessage = "Cancelled";
    task.result = {
      status: "CANCELLED",
      summary: "Cancelled by user",
    };
    // Keep activeTaskId until runModule / detect path settles.
    this.logger.info("Task cancelled", { taskId, moduleId: task.moduleId });
    this.emit(task);
  }

  /** Drop a reserved task that never entered runModule (detect failure). */
  private releaseStartLock(task: InternalTask): void {
    this.tasks.delete(task.taskId);
    if (this.activeTaskId === task.taskId) {
      this.activeTaskId = null;
    }
  }

  setProgress(taskId: string, message: string, state: TaskState = "RUNNING"): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }
    if (
      task.state === "CANCELLED" ||
      task.state === "COMPLETED" ||
      task.state === "FAILED" ||
      task.state === "PARTIAL"
    ) {
      return;
    }
    task.state = state;
    task.progressMessage = message;
    this.emit(task);
  }

  private async runModule(
    task: InternalTask,
    run: (ctx: TaskContext) => Promise<TaskResult>,
    ctx: TaskContext,
  ): Promise<void> {
    try {
      const result = await run(ctx);
      if (task.state === "CANCELLED" || ctx.signal.aborted) {
        this.finalizeCancelled(task);
        return;
      }
      task.result = result;
      task.state =
        result.status === "COMPLETED"
          ? "COMPLETED"
          : result.status === "PARTIAL"
            ? "PARTIAL"
            : result.status === "CANCELLED"
              ? "CANCELLED"
              : "FAILED";
      task.progressMessage = result.summary;
      if (this.activeTaskId === task.taskId) {
        this.activeTaskId = null;
      }
      this.logger.info("Task finished", {
        taskId: task.taskId,
        state: task.state,
      });
      this.emit(task);
    } catch (error) {
      if (task.state === "CANCELLED" || ctx.signal.aborted) {
        this.finalizeCancelled(task);
        return;
      }
      const message =
        error instanceof Error ? error.message : "Unknown task failure";
      task.state = "FAILED";
      task.errorMessage = message;
      task.result = {
        status: "FAILED",
        summary: message,
      };
      task.progressMessage = message;
      if (this.activeTaskId === task.taskId) {
        this.activeTaskId = null;
      }
      this.logger.error("Task failed", {
        taskId: task.taskId,
        message,
      });
      this.emit(task);
    }
  }

  private finalizeCancelled(task: InternalTask): void {
    if (task.state !== "CANCELLED") {
      task.state = "CANCELLED";
      task.progressMessage = "Cancelled";
      task.result = {
        status: "CANCELLED",
        summary: "Cancelled by user",
      };
    }
    if (this.activeTaskId === task.taskId) {
      this.activeTaskId = null;
    }
    this.emit(task);
  }

  private toSnapshot(task: InternalTask): TaskSnapshot {
    return {
      taskId: task.taskId,
      moduleId: task.moduleId,
      state: task.state,
      ...(task.progressMessage !== undefined
        ? { progressMessage: task.progressMessage }
        : {}),
      ...(task.result !== undefined ? { result: task.result } : {}),
      ...(task.errorMessage !== undefined
        ? { errorMessage: task.errorMessage }
        : {}),
    };
  }

  private emit(task: InternalTask): void {
    const snapshot = this.toSnapshot(task);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
