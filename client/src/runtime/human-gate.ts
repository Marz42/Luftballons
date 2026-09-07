import type { HumanGateAction, HumanGateService } from "./types.js";

/**
 * Phase 0 placeholder — real interactive Human Gate lands in Phase 4.
 * Always rejects so WRITE_COMMIT cannot silently proceed.
 */
export class PlaceholderHumanGate implements HumanGateService {
  async request(_action: HumanGateAction): Promise<"APPROVED" | "REJECTED"> {
    return "REJECTED";
  }
}
