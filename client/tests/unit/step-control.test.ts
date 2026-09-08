import { describe, expect, it, vi } from "vitest";
import { abortableDelay } from "../../src/modules/step-control.js";

describe("abortableDelay", () => {
  it("resolves after delay and removes abort listener", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const addSpy = vi.spyOn(ac.signal, "addEventListener");
    const removeSpy = vi.spyOn(ac.signal, "removeEventListener");
    const pending = abortableDelay(40, ac.signal);
    await vi.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toBeUndefined();
    expect(addSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects on abort and clears timer", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const pending = abortableDelay(5_000, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  });

  it("supports repeated polling without leaking listeners", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, "removeEventListener");
    for (let i = 0; i < 5; i += 1) {
      const pending = abortableDelay(20, ac.signal);
      await vi.advanceTimersByTimeAsync(20);
      await pending;
    }
    expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
    vi.useRealTimers();
  });
});
