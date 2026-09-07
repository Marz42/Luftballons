/**
 * Real Human Gate UI (FT-012 / IMPLEMENTATION §12 / SPEC §10).
 * Modal lives inside the panel Shadow DOM — never window.alert.
 * No default approval; no timeout auto-confirm; abort → REJECTED + close.
 */

import type { HumanGateAction, HumanGateService } from "../runtime/types.js";

export interface PanelHumanGate extends HumanGateService {
  /** Bind modal host inside the Luftballons panel shadow root. */
  attach(host: ParentNode): void;
  /** Tear down any open modal (panel destroy). */
  detach(): void;
  /** True while a confirmation modal is visible. */
  isOpen(): boolean;
}

function text(el: HTMLElement, value: string): void {
  el.textContent = value;
}

export function createPanelHumanGate(): PanelHumanGate {
  let host: ParentNode | null = null;
  let overlay: HTMLElement | null = null;
  let settle: ((decision: "APPROVED" | "REJECTED") => void) | null = null;
  let abortHandler: (() => void) | null = null;
  let activeSignal: AbortSignal | null = null;

  const dismiss = (decision: "APPROVED" | "REJECTED"): void => {
    if (activeSignal && abortHandler) {
      activeSignal.removeEventListener("abort", abortHandler);
    }
    activeSignal = null;
    abortHandler = null;
    if (overlay?.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    overlay = null;
    const resolver = settle;
    settle = null;
    resolver?.(decision);
  };

  const buildModal = (action: HumanGateAction): HTMLElement => {
    const root = document.createElement("div");
    root.className = "lb-gate-overlay";
    root.setAttribute("data-luftballons-human-gate", "true");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "lb-gate-card";

    const title = document.createElement("h2");
    title.className = "lb-gate-title";
    text(title, action.title);

    const desc = document.createElement("p");
    desc.className = "lb-gate-desc";
    text(desc, action.description);

    const irrev = document.createElement("p");
    irrev.className = "lb-gate-irreversible";
    text(irrev, "不可撤销 — this WRITE_COMMIT cannot be undone from Luftballons.");

    const listTitle = document.createElement("div");
    listTitle.className = "lb-gate-list-title";
    text(listTitle, "Consequences");

    const list = document.createElement("ul");
    list.className = "lb-gate-list";
    for (const line of action.consequences) {
      const li = document.createElement("li");
      text(li, line);
      list.append(li);
    }

    const actions = document.createElement("div");
    actions.className = "lb-gate-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "lb-btn lb-gate-cancel";
    text(cancelBtn, "取消");
    cancelBtn.addEventListener("click", () => {
      dismiss("REJECTED");
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "lb-btn lb-gate-confirm";
    text(confirmBtn, "确认");
    confirmBtn.addEventListener("click", () => {
      dismiss("APPROVED");
    });

    actions.append(cancelBtn, confirmBtn);
    card.append(title, desc, irrev, listTitle, list, actions);
    root.append(card);
    return root;
  };

  return {
    attach(nextHost: ParentNode): void {
      host = nextHost;
    },

    detach(): void {
      if (settle) {
        dismiss("REJECTED");
      }
      host = null;
    },

    isOpen(): boolean {
      return overlay !== null;
    },

    async request(
      action: HumanGateAction,
      signal?: AbortSignal,
    ): Promise<"APPROVED" | "REJECTED"> {
      if (signal?.aborted) {
        return "REJECTED";
      }
      if (!host) {
        // Fail-closed: never auto-approve when UI is missing.
        return "REJECTED";
      }
      if (settle) {
        // One gate at a time — reject the previous waiter.
        dismiss("REJECTED");
      }

      return new Promise<"APPROVED" | "REJECTED">((resolve) => {
        settle = resolve;
        overlay = buildModal(action);
        host!.appendChild(overlay);

        if (signal) {
          activeSignal = signal;
          abortHandler = (): void => {
            dismiss("REJECTED");
          };
          signal.addEventListener("abort", abortHandler, { once: true });
          if (signal.aborted) {
            dismiss("REJECTED");
          }
        }
      });
    },
  };
}
