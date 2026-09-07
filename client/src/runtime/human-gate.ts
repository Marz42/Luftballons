import type { HumanGateAction, HumanGateService } from "./types.js";

/**
 * Placeholder — always rejects so WRITE_COMMIT cannot silently proceed
 * if bootstrap forgets to inject the real UI Human Gate.
 * Real interactive gate: `ui/human-gate.ts` (FT-012).
 */
export class PlaceholderHumanGate implements HumanGateService {
  async request(
    _action: HumanGateAction,
    signal?: AbortSignal,
  ): Promise<"APPROVED" | "REJECTED"> {
    if (signal?.aborted) {
      return "REJECTED";
    }
    return "REJECTED";
  }
}
