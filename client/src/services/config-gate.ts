/**
 * Wrap module.detect with remote-config kill switch / minRuntimeVersion
 * (SPEC §28 / §53). Existing module interfaces unchanged.
 *
 * Kill switch / enabled=false only apply when source is cached|fresh
 * (i.e. a remote config was successfully obtained at least once).
 */

import type {
  LuftballonsModule,
  ModuleAvailability,
  DetectContext,
} from "../runtime/types.js";
import type { AppliedConfigState } from "./config-service.js";
import { isRuntimeAtLeast } from "./config-service.js";

export function withRemoteConfigGate(
  module: LuftballonsModule,
  getApplied: () => AppliedConfigState,
  runtimeVersion: string,
): LuftballonsModule {
  const detect = async (ctx: DetectContext): Promise<ModuleAvailability> => {
    const base = await module.detect(ctx);
    if (!base.available) {
      return base;
    }

    const applied = getApplied();
    const { config, source } = applied;

    if (
      config.minRuntimeVersion &&
      (source === "cached" || source === "fresh") &&
      !isRuntimeAtLeast(runtimeVersion, config.minRuntimeVersion)
    ) {
      return {
        available: false,
        reason: "DISABLED",
        metadata: {
          cause: "minRuntimeVersion",
          required: config.minRuntimeVersion,
          runtimeVersion,
          source,
        },
      };
    }

    // SPEC §28: kill switch only after successful remote config obtain.
    if (source !== "cached" && source !== "fresh") {
      return base;
    }

    const modCfg = config.modules[module.id];
    if (!modCfg) {
      return base;
    }
    if (modCfg.killSwitch === true) {
      return {
        available: false,
        reason: "DISABLED",
        metadata: {
          cause: "killSwitch",
          source,
          detail: "远端禁用",
        },
      };
    }
    if (modCfg.enabled === false) {
      return {
        available: false,
        reason: "DISABLED",
        metadata: {
          cause: "enabled",
          source,
          detail: "远端禁用",
        },
      };
    }
    return base;
  };

  if (module.cleanup) {
    const cleanup = module.cleanup.bind(module);
    return {
      id: module.id,
      name: module.name,
      version: module.version,
      site: module.site,
      capabilities: module.capabilities,
      cleanup,
      run: (ctx) => module.run(ctx),
      detect,
    };
  }

  return {
    id: module.id,
    name: module.name,
    version: module.version,
    site: module.site,
    capabilities: module.capabilities,
    run: (ctx) => module.run(ctx),
    detect,
  };
}
