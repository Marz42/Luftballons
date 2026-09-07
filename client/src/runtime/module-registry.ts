import type { LuftballonsModule, ModuleAvailability } from "./types.js";
import type { DetectContext } from "./types.js";
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
} from "./errors.js";

export interface ModuleAvailabilityEntry {
  module: LuftballonsModule;
  availability: ModuleAvailability;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, LuftballonsModule>();

  register(module: LuftballonsModule): void {
    if (this.modules.has(module.id)) {
      throw new ModuleAlreadyRegisteredError(module.id);
    }
    this.modules.set(module.id, module);
  }

  unregister(moduleId: string): void {
    if (!this.modules.delete(moduleId)) {
      throw new ModuleNotFoundError(moduleId);
    }
  }

  get(moduleId: string): LuftballonsModule | undefined {
    return this.modules.get(moduleId);
  }

  require(moduleId: string): LuftballonsModule {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new ModuleNotFoundError(moduleId);
    }
    return module;
  }

  list(): LuftballonsModule[] {
    return [...this.modules.values()];
  }

  async detectAll(ctx: DetectContext): Promise<ModuleAvailabilityEntry[]> {
    const entries: ModuleAvailabilityEntry[] = [];
    for (const module of this.modules.values()) {
      const availability = await module.detect(ctx);
      entries.push({ module, availability });
    }
    return entries;
  }
}
