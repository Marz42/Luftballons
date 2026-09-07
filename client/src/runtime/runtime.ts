import type { ModuleRegistry } from "./module-registry.js";
import type { TaskRunner } from "./task-runner.js";
import type { Logger } from "./types.js";

export interface BundledDefaults {
  runtimeVersion: string;
  networkMode: "OFF" | "MANUAL" | "ENABLED";
}

export const BUNDLED_DEFAULTS: BundledDefaults = {
  runtimeVersion: "0.1.0",
  networkMode: "OFF",
};

export interface Runtime {
  readonly version: string;
  readonly registry: ModuleRegistry;
  readonly taskRunner: TaskRunner;
  readonly logger: Logger;
  readonly config: BundledDefaults;
}

export function createRuntime(options: {
  registry: ModuleRegistry;
  taskRunner: TaskRunner;
  logger: Logger;
  config?: BundledDefaults;
}): Runtime {
  const config = options.config ?? BUNDLED_DEFAULTS;
  return {
    version: config.runtimeVersion,
    registry: options.registry,
    taskRunner: options.taskRunner,
    logger: options.logger,
    config,
  };
}
