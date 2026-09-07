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
import { createChannelBasicModule } from "../sites/youtube-studio/modules/channel-basic/module.js";
import { createSubtitleMultilangModule } from "../sites/youtube-studio/modules/subtitle-multilang/module.js";
import { detectStudio } from "../sites/youtube-studio/page-detector.js";
import {
  createNavigationService,
  type CancellableNavigationService,
} from "../sites/youtube-studio/navigation.js";
import { createPanelHumanGate } from "../ui/human-gate.js";
import { mountApp } from "../ui/app.js";
import type { LuftballonsModule } from "../runtime/types.js";
import type { Runtime } from "../runtime/runtime.js";
import type { PanelHandle } from "../ui/panel.js";
import type { CollectionService } from "../services/collection-service.js";
import type { Sink } from "../sinks/sink.js";
import type { HumanGateService } from "../runtime/types.js";
import type { PanelHumanGate } from "../ui/human-gate.js";

/**
 * Phase 2+ Studio adapter handles.
 * Dom/Navigation are closed over by site modules at registration (wiring in bootstrap).
 * Core TaskContext stays free of site-specific NavigationService imports (AGENTS.md).
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
  humanGate?: HumanGateService;
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
  /** Override Human Gate (tests inject fakes). */
  humanGate?: HumanGateService | PanelHumanGate;
}

function defaultStudioAdapter(): StudioAdapter {
  const dom = createDomService();
  return {
    detect: detectStudio,
    dom,
    navigation: createNavigationService({ dom }),
  };
}

function defaultModules(adapter: StudioAdapter): LuftballonsModule[] {
  return [
    createChannelBasicModule({
      dom: adapter.dom,
      navigation: adapter.navigation,
    }),
    createSubtitleMultilangModule({
      dom: adapter.dom,
      navigation: adapter.navigation,
    }),
  ];
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

  let studioAdapter: StudioAdapter | undefined;
  if (options.studioAdapter === false) {
    studioAdapter = undefined;
  } else if (options.studioAdapter) {
    studioAdapter = options.studioAdapter;
  } else {
    studioAdapter = defaultStudioAdapter();
  }

  const registry = new ModuleRegistry();
  const modules =
    options.modules ??
    (studioAdapter
      ? defaultModules(studioAdapter)
      : [
          createSubtitleMultilangModule({
            dom: createDomService(),
            navigation: createNavigationService({ dom: createDomService() }),
          }),
        ]);

  for (const module of modules) {
    registry.register(module);
  }

  const collections =
    options.collections ?? new IndexedDbCollectionService();
  const csvSink = options.csvSink ?? new CsvSink();
  const jsonSink = options.jsonSink ?? new JsonSink();

  const humanGate = options.humanGate ?? createPanelHumanGate();

  const taskRunner = new TaskRunner({
    registry,
    logger,
    collectionService: collections,
    humanGate,
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

  let panel: PanelHandle;
  if (options.mount === false) {
    panel = {
      open() {},
      close() {},
      destroy() {},
    };
  } else {
    const panelGate =
      "attach" in humanGate
        ? (humanGate as PanelHumanGate)
        : undefined;
    panel = await mountApp(runtime, {
      ...(panelGate !== undefined ? { humanGate: panelGate } : {}),
    });
  }

  logger.info("Bootstrap complete", {
    moduleCount: registry.list().length,
    studioAdapter: studioAdapter !== undefined,
  });

  const result: BootstrapResult = { runtime, panel, humanGate };
  if (studioAdapter !== undefined) {
    result.studioAdapter = studioAdapter;
  }
  return result;
}
