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
import { RemoteSink } from "../sinks/remote-sink.js";
import { createNetworkService } from "../services/network-service.js";
import type { NetworkService } from "../services/network-service.js";
import { resolveBootstrapConfig } from "../services/config-service.js";
import { withRemoteConfigGate } from "../services/config-gate.js";
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
  remoteSink?: Sink;
  network?: NetworkService;
  /** Skip creating Dom/Navigation services (rare). */
  studioAdapter?: false | StudioAdapter;
  /** Override Human Gate (tests inject fakes). */
  humanGate?: HumanGateService | PanelHumanGate;
  /**
   * When true (default), attempt a single background config refresh after UI
   * render if network mode is not OFF and credentials exist. Failures warn +
   * continue — no retry storm (IMPLEMENTATION §25).
   */
  backgroundConfigRefresh?: boolean;
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
 * Bootstrap (SPEC §6 / IMPLEMENTATION §25):
 * Bundled Defaults → Local Settings → Cached Remote → Init Runtime →
 * Render UI → Optional Background Config Refresh.
 * No eval, no remote JS. Remote config errors never block startup.
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

  // §25: Load Cached Remote Config before Initialize Runtime.
  const initialApplied = resolveBootstrapConfig();

  let studioAdapter: StudioAdapter | undefined;
  if (options.studioAdapter === false) {
    studioAdapter = undefined;
  } else if (options.studioAdapter) {
    studioAdapter = options.studioAdapter;
  } else {
    studioAdapter = defaultStudioAdapter();
  }

  const network =
    options.network ??
    createNetworkService({
      logger,
      runtimeVersion: BUNDLED_DEFAULTS.runtimeVersion,
      initialApplied,
    });

  const registry = new ModuleRegistry();
  const rawModules =
    options.modules ??
    (studioAdapter
      ? defaultModules(studioAdapter)
      : [
          createSubtitleMultilangModule({
            dom: createDomService(),
            navigation: createNavigationService({ dom: createDomService() }),
          }),
        ]);

  // Wrap detect with remote-config gate (interfaces unchanged).
  for (const module of rawModules) {
    registry.register(
      withRemoteConfigGate(
        module,
        () => network.getAppliedConfig(),
        BUNDLED_DEFAULTS.runtimeVersion,
      ),
    );
  }

  const collections =
    options.collections ?? new IndexedDbCollectionService();
  const csvSink = options.csvSink ?? new CsvSink();
  const jsonSink = options.jsonSink ?? new JsonSink();

  const remoteSink =
    options.remoteSink ??
    new RemoteSink({
      getBaseUrl: () => network.getSettings().baseUrl,
      getToken: () => network.getSettings().token,
      isSendAllowed: () => network.getNetworkMode() !== "OFF",
    });

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
    remoteSink,
    network,
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

  // §25 Optional Background Config Refresh — single attempt, no retry storm.
  const doBackground = options.backgroundConfigRefresh !== false;
  if (doBackground && network.getNetworkMode() !== "OFF") {
    const settings = network.getSettings();
    if (settings.baseUrl && settings.token) {
      void network.refreshConfig().then((state) => {
        if (state.lastRefresh && !state.lastRefresh.ok) {
          logger.warn("Background config refresh failed; continuing", {
            message: state.lastRefresh.message,
          });
        }
      });
    }
  }

  logger.info("Bootstrap complete", {
    moduleCount: registry.list().length,
    studioAdapter: studioAdapter !== undefined,
    configSource: network.getAppliedConfig().source,
  });

  const result: BootstrapResult = { runtime, panel, humanGate };
  if (studioAdapter !== undefined) {
    result.studioAdapter = studioAdapter;
  }
  return result;
}
