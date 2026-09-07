import { describe, expect, it } from "vitest";
import {
  clearInstallation,
  getOrCreateInstallation,
} from "../../src/schemas/installation.js";

describe("installation identity (§26)", () => {
  it("generates UUID on first run and reuses on subsequent calls", () => {
    const store = new Map<string, string>();
    const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    };

    clearInstallation(storage);
    const first = getOrCreateInstallation(storage);
    expect(first.installationId.length).toBeGreaterThan(8);
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = getOrCreateInstallation(storage);
    expect(second.installationId).toBe(first.installationId);
    expect(second.createdAt).toBe(first.createdAt);
  });
});
