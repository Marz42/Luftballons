import { mountLuftballonsPanel } from "./panel.js";
import type { Runtime } from "../runtime/runtime.js";
import type { PanelHandle } from "./panel.js";
import type { PanelHumanGate } from "./human-gate.js";

export async function mountApp(
  runtime: Runtime,
  options: { humanGate?: PanelHumanGate } = {},
): Promise<PanelHandle> {
  return mountLuftballonsPanel(runtime, document.documentElement, options);
}
