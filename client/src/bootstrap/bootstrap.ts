import { createRuntime, BUNDLED_DEFAULTS } from "../runtime/runtime.js";
import { ModuleRegistry } from "../runtime/module-registry.js";
import { TaskRunner } from "../runtime/task-runner.js";
import { createLogger } from "../services/logger.js";
import { IndexedDbCollectionService } from "../services/collection-service.js";
import {
  createDomService,
  type CancellableDomService,
} from "../services/dom-service.js";
import { CsvSink } from "../sinks/csv-sink.js";
import { JsonSink } from "../sinks/json-sink.js";
import {
  createChannelBasicStub,
  createSubtitleMultilangStub,
} from "../modules/youtube-studio-stubs.js";
import { detectStudio } from "../sites/youtube-studio/page-detector.js";
import {
  createNavigationService,
  type CancellableNavigationService,
} from "../sites/youtube-studio/navigation.js";
import { mountApp } from "../ui/app.js";
import type { LuftballonsModule } from "../runtime/types.js";
import type { Runtime } from "../runtime/runtime.js";
import type { PanelHandle } from "../ui/panel.js";
import type { CollectionService } from "../services/collection-service.js";
import type { Sink } from "../sinks/sink.js";

/**
 * Phase 2 Studio adapter handles — optional on the bootstrap container.
 * Not injected into TaskContext until Phase 3 (keeps P0/P1 TaskContext stable).
 */
export interface StudioAdapter {
  detect: typeof detectStudio;
  dom: CancellableDomService;
  navigation: CancellableNavigationService;
}

export interface BootstrapResult {
  runtime: Runtime;
  panel: PanelHandle;
  /** Present when Studio adapter wiring is enabled (default on). */
  studioAdapter?: StudioAdapter;
}

export interface BootstrapOptions {
  modules?: LuftballonsModule[];
  mount?: boolean;
  /** Override collection storage (tests). Defaults to IndexedDB. */
  collections?: CollectionService;
  csvSink?: Sink;
  jsonSink?: Sink;
  /** Skip creating Dom/Navigation services (rare). */
  studioAdapter?: false | StudioAdapter;
}

/**
 * Bootstrap (SPEC §6): init Runtime → check host → register modules →
 * load bundled defaults → render UI. No eval, no remote JS.
 */
export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const logger = createLogger({ minLevel: "INFO" });
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";

  logger.info("Bootstrap starting", {
    hostname,
    runtimeVersion: BUNDLED_DEFAULTS.runtimeVersion,
  });

  const registry = new ModuleRegistry();
  const modules =
    options.modules ??
    [createChannelBasicStub(), createSubtitleMultilangStub()];

  for (const module of modules) {
    registry.register(module);
  }

  const collections =
    options.collections ?? new IndexedDbCollectionService();
  const csvSink = options.csvSink ?? new CsvSink();
  const jsonSink = options.jsonSink ?? new JsonSink();

  const taskRunner = new TaskRunner({
    registry,
    logger,
    collectionService: collections,
  });

  const runtime = createRuntime({
    registry,
    taskRunner,
    logger,
    config: BUNDLED_DEFAULTS,
    collections,
    csvSink,
    jsonSink,
  });

  let studioAdapter: StudioAdapter | undefined;
  if (options.studioAdapter === false) {
    studioAdapter = undefined;
  } else if (options.studioAdapter) {
    studioAdapter = options.studioAdapter;
  } else {
    const dom = createDomService();
    studioAdapter = {
      detect: detectStudio,
      dom,
      navigation: createNavigationService({ dom }),
    };
  }

  let panel: PanelHandle;
  if (options.mount === false) {
    panel = {
      open() {},
      close() {},
      destroy() {},
    };
  } else {
    panel = await mountApp(runtime);
  }

  logger.info("Bootstrap complete", {
    moduleCount: registry.list().length,
    studioAdapter: studioAdapter !== undefined,
  });

  const result: BootstrapResult = { runtime, panel };
  if (studioAdapter !== undefined) {
    result.studioAdapter = studioAdapter;
  }
  return result;
}
