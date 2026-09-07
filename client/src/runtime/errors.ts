export class LuftballonsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LuftballonsError";
    this.code = code;
  }
}

export class ModuleNotFoundError extends LuftballonsError {
  constructor(moduleId: string) {
    super("MODULE_NOT_FOUND", `Module not found: ${moduleId}`);
    this.name = "ModuleNotFoundError";
  }
}

export class ModuleAlreadyRegisteredError extends LuftballonsError {
  constructor(moduleId: string) {
    super(
      "MODULE_ALREADY_REGISTERED",
      `Module already registered: ${moduleId}`,
    );
    this.name = "ModuleAlreadyRegisteredError";
  }
}

export class TaskBusyError extends LuftballonsError {
  constructor() {
    super(
      "TASK_BUSY",
      "Another UI automation task is already running (one-task rule)",
    );
    this.name = "TaskBusyError";
  }
}

export class TaskNotFoundError extends LuftballonsError {
  constructor(taskId: string) {
    super("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class ModuleUnavailableError extends LuftballonsError {
  constructor(moduleId: string, reason?: string) {
    super(
      "MODULE_UNAVAILABLE",
      reason
        ? `Module unavailable: ${moduleId} (${reason})`
        : `Module unavailable: ${moduleId}`,
    );
    this.name = "ModuleUnavailableError";
  }
}
