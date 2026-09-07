import { describe, expect, it } from "vitest";
import { isCapability, ALL_CAPABILITIES } from "../../src/runtime/capability.js";
import { CapabilityManager } from "../../src/runtime/capability-manager.js";

describe("Capability", () => {
  it("accepts the SPEC v0.1 capability set", () => {
    expect(ALL_CAPABILITIES).toEqual([
      "READ",
      "NAVIGATE",
      "WRITE_REVERSIBLE",
      "WRITE_COMMIT",
      "NETWORK_SEND",
      "LOCAL_EXPORT",
    ]);
    for (const cap of ALL_CAPABILITIES) {
      expect(isCapability(cap)).toBe(true);
    }
    expect(isCapability("EXECUTE_REMOTE")).toBe(false);
  });

  it("CapabilityManager is read-only over declared caps", () => {
    const mgr = new CapabilityManager(["READ", "NAVIGATE"]);
    expect(mgr.has("READ")).toBe(true);
    expect(mgr.has("NETWORK_SEND")).toBe(false);
    expect(() => mgr.require("NETWORK_SEND")).toThrow(/Missing capability/);
    expect(mgr.list()).toEqual(["READ", "NAVIGATE"]);
  });

  it("rejects duplicate capability declarations", () => {
    expect(() => new CapabilityManager(["READ", "READ"])).toThrow(/duplicate/);
  });
});
