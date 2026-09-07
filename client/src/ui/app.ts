import { mountLuftballonsPanel } from "./panel.js";
import type { Runtime } from "../runtime/runtime.js";
import type { PanelHandle } from "./panel.js";

export async function mountApp(runtime: Runtime): Promise<PanelHandle> {
  return mountLuftballonsPanel(runtime);
}
