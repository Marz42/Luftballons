/**
 * Abort-aware step wait for Phase 0 demo modules.
 * Default wait is abortableDelay (real, cancellable wall delay for device demos).
 * Tests inject immediateWait (or a controllable clock) — no fixed wall sleeps in CI.
 */
export async function waitForAbortableStep(
  signal: AbortSignal,
  ms: number,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = abortableDelay,
): Promise<void> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  await wait(ms, signal);
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Test helper: resolve immediately (or on next microtask) unless aborted. */
export function immediateWait(
  _ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return Promise.resolve();
}
