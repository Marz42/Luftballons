import type { Runtime } from "../runtime/runtime.js";
import type {
  ModuleAvailability,
  TaskSnapshot,
} from "../runtime/types.js";
import { TaskBusyError } from "../runtime/errors.js";
import { PANEL_STYLES } from "./styles.js";

export interface PanelHandle {
  destroy(): void;
  open(): void;
  close(): void;
}

interface ModuleRow {
  id: string;
  name: string;
  availability: ModuleAvailability;
}

function text(el: HTMLElement, value: string): void {
  el.textContent = value;
}

export async function mountLuftballonsPanel(
  runtime: Runtime,
  mountParent: ParentNode = document.documentElement,
): Promise<PanelHandle> {
  const host = document.createElement("div");
  host.setAttribute("data-luftballons-root", "true");
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  text(style, PANEL_STYLES);
  shadow.appendChild(style);

  const root = document.createElement("div");
  root.className = "lb-root";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lb-toggle";
  text(toggle, "Luftballons");

  const panel = document.createElement("div");
  panel.className = "lb-panel";
  panel.hidden = true;

  const title = document.createElement("h1");
  title.className = "lb-title";
  text(title, "Luftballons");

  const sub = document.createElement("p");
  sub.className = "lb-sub";
  text(sub, `Runtime ${runtime.version} · local-first · human-triggered`);

  const modulesTitle = document.createElement("div");
  modulesTitle.className = "lb-section-title";
  text(modulesTitle, "Modules");

  const modulesBox = document.createElement("div");

  const taskTitle = document.createElement("div");
  taskTitle.className = "lb-section-title";
  text(taskTitle, "Task");

  const statusBox = document.createElement("div");
  statusBox.className = "lb-status";
  text(statusBox, "Idle — no task running");

  const errorBox = document.createElement("div");
  errorBox.className = "lb-error";
  text(errorBox, "");

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "lb-btn lb-btn-cancel";
  text(cancelBtn, "Cancel");
  cancelBtn.disabled = true;

  panel.append(
    title,
    sub,
    modulesTitle,
    modulesBox,
    taskTitle,
    statusBox,
    cancelBtn,
    errorBox,
  );
  root.append(toggle, panel);
  shadow.appendChild(root);
  mountParent.appendChild(host);

  let open = false;
  let activeTaskId: string | null = null;
  let rows: ModuleRow[] = [];

  const setError = (message: string): void => {
    text(errorBox, message);
  };

  const renderStatus = (snapshot: TaskSnapshot | null): void => {
    if (!snapshot) {
      text(statusBox, "Idle — no task running");
      cancelBtn.disabled = true;
      activeTaskId = null;
      return;
    }
    activeTaskId = snapshot.taskId;
    const progress = snapshot.progressMessage ?? "";
    text(
      statusBox,
      [
        `Module: ${snapshot.moduleId}`,
        `State: ${snapshot.state}`,
        progress ? `Progress: ${progress}` : "",
        snapshot.result ? `Result: ${snapshot.result.summary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const running =
      snapshot.state === "RUNNING" ||
      snapshot.state === "WAITING" ||
      snapshot.state === "WAITING_HUMAN";
    cancelBtn.disabled = !running;
  };

  const isBusy = (): boolean => {
    const id = runtime.taskRunner.getActiveTaskId();
    if (!id) {
      return false;
    }
    const state = runtime.taskRunner.getState(id);
    return (
      state === "RUNNING" || state === "WAITING" || state === "WAITING_HUMAN"
    );
  };

  const renderModules = (): void => {
    while (modulesBox.firstChild) {
      modulesBox.removeChild(modulesBox.firstChild);
    }
    for (const row of rows) {
      const block = document.createElement("div");
      block.className = "lb-module";

      const nameEl = document.createElement("div");
      nameEl.className = "lb-module-name";
      text(nameEl, row.name);

      const meta = document.createElement("div");
      meta.className = "lb-module-meta";
      text(
        meta,
        row.availability.available
          ? `available · ${row.id}`
          : `unavailable (${row.availability.reason ?? "unknown"}) · ${row.id}`,
      );

      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "lb-btn";
      text(startBtn, "Start (simulated)");
      startBtn.disabled = !row.availability.available || isBusy();
      startBtn.addEventListener("click", () => {
        void (async () => {
          setError("");
          try {
            const taskId = await runtime.taskRunner.start(row.id);
            activeTaskId = taskId;
            renderModules();
          } catch (error) {
            if (error instanceof TaskBusyError) {
              setError(error.message);
            } else if (error instanceof Error) {
              setError(error.message);
            } else {
              setError("Failed to start task");
            }
          }
        })();
      });

      block.append(nameEl, meta, startBtn);
      modulesBox.appendChild(block);
    }
  };

  const refreshAvailability = async (): Promise<void> => {
    const location =
      typeof window !== "undefined"
        ? {
            hostname: window.location.hostname,
            href: window.location.href,
          }
        : { hostname: "", href: "" };
    const entries = await runtime.registry.detectAll({
      hostname: location.hostname,
      href: location.href,
      logger: runtime.logger,
    });
    rows = entries.map((entry) => ({
      id: entry.module.id,
      name: entry.module.name,
      availability: entry.availability,
    }));
    renderModules();
  };

  toggle.addEventListener("click", () => {
    open = !open;
    panel.hidden = !open;
    text(toggle, open ? "Luftballons ▾" : "Luftballons");
    if (open) {
      void refreshAvailability();
    }
  });

  cancelBtn.addEventListener("click", () => {
    const id = runtime.taskRunner.getActiveTaskId() ?? activeTaskId;
    if (!id) {
      return;
    }
    void runtime.taskRunner.cancel(id).then(() => {
      renderModules();
    });
  });

  const unsubscribe = runtime.taskRunner.subscribe((snapshot) => {
    renderStatus(snapshot);
    renderModules();
  });

  await refreshAvailability();
  renderStatus(null);

  return {
    open(): void {
      open = true;
      panel.hidden = false;
      text(toggle, "Luftballons ▾");
      void refreshAvailability();
    },
    close(): void {
      open = false;
      panel.hidden = true;
      text(toggle, "Luftballons");
    },
    destroy(): void {
      unsubscribe();
      host.remove();
    },
  };
}
