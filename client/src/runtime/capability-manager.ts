import type { Capability } from "./capability.js";

/**
 * Read-only view of a module's declared capabilities.
 * Runtime must never grant extra capabilities at run time (IMPLEMENTATION §3.1).
 */
export class CapabilityManager {
  constructor(private readonly declared: readonly Capability[]) {
    const unique = new Set(declared);
    if (unique.size !== declared.length) {
      throw new Error("CapabilityManager: duplicate capability declaration");
    }
  }

  list(): readonly Capability[] {
    return this.declared;
  }

  has(capability: Capability): boolean {
    return this.declared.includes(capability);
  }

  require(capability: Capability): void {
    if (!this.has(capability)) {
      throw new Error(`Missing capability: ${capability}`);
    }
  }
}

export type CapabilityContext = CapabilityManager;
