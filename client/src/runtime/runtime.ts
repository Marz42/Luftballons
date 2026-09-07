import type { ModuleRegistry } from "./module-registry.js";
import type { TaskRunner } from "./task-runner.js";
import type { Logger } from "./types.js";
import type { CollectionService } from "../services/collection-service.js";
import { NoopCollectionService } from "../services/collection-service.js";
import type { Sink } from "../sinks/sink.js";
import { CsvSink } from "../sinks/csv-sink.js";
import { JsonSink } from "../sinks/json-sink.js";

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
  readonly collections: CollectionService;
  readonly csvSink: Sink;
  readonly jsonSink: Sink;
}

export function createRuntime(options: {
  registry: ModuleRegistry;
  taskRunner: TaskRunner;
  logger: Logger;
  config?: BundledDefaults;
  collections?: CollectionService;
  csvSink?: Sink;
  jsonSink?: Sink;
}): Runtime {
  const config = options.config ?? BUNDLED_DEFAULTS;
  return {
    version: config.runtimeVersion,
    registry: options.registry,
    taskRunner: options.taskRunner,
    logger: options.logger,
    config,
    collections: options.collections ?? new NoopCollectionService(),
    csvSink: options.csvSink ?? new CsvSink(),
    jsonSink: options.jsonSink ?? new JsonSink(),
  };
}
