import type { Runtime } from "../runtime/runtime.js";
import type {
  LuftballonsModule,
  ModuleAvailability,
  TaskSnapshot,
} from "../runtime/types.js";
import { TaskBusyError } from "../runtime/errors.js";
import { PANEL_STYLES } from "./styles.js";
import { createCollectionsSection } from "./collections-section.js";
import { createServerSection } from "./server-section.js";
import type { PanelHumanGate } from "./human-gate.js";
import {
  isSubtitleControls,
  type SubtitleMultilangModule,
} from "../sites/youtube-studio/modules/subtitle-multilang/module.js";
import {
  PRESET_SUBTITLE_LANGUAGES,
  resolveLanguage,
} from "../sites/youtube-studio/modules/subtitle-multilang/schema.js";

export interface PanelHandle {
  destroy(): void;
  open(): void;
  close(): void;
}

export interface MountPanelOptions {
  /** Real Human Gate; attached into this panel's shadow DOM. */
  humanGate?: PanelHumanGate;
}

interface ModuleRow {
  id: string;
  name: string;
  availability: ModuleAvailability;
  module: LuftballonsModule;
}

function text(el: HTMLElement, value: string): void {
  el.textContent = value;
}

/** Red balloon brand mark (2026-10-22 requirement). */
function balloonIcon(size = 18): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "lb-balloon");
  const body = document.createElementNS(NS, "path");
  body.setAttribute(
    "d",
    "M12 2.2c-3.4 0-6.1 2.9-6.1 6.6 0 3.3 2.2 6.1 4.5 7.6h3.2c2.3-1.5 4.5-4.3 4.5-7.6 0-3.7-2.7-6.6-6.1-6.6z",
  );
  body.setAttribute("fill", "#d93025");
  const knot = document.createElementNS(NS, "path");
  knot.setAttribute("d", "M10.7 16.4h2.6L12 18.3z");
  knot.setAttribute("fill", "#a50e0e");
  const string = document.createElementNS(NS, "path");
  string.setAttribute("d", "M12 18.3c1.3 1.2 1.3 2.5 0 3.7");
  string.setAttribute("stroke", "#a50e0e");
  string.setAttribute("stroke-width", "1.3");
  string.setAttribute("stroke-linecap", "round");
  string.setAttribute("fill", "none");
  svg.append(body, knot, string);
  return svg;
}

/** Balloon + brand text as the toggle/title content. */
function brandLabel(host: HTMLElement, suffix = ""): void {
  host.replaceChildren();
  host.append(
    balloonIcon(),
    document.createTextNode(`Luftballons${suffix}`),
  );
}

/** 任务状态的中文显示名（内部状态码保持英文）。 */
const STATE_LABELS: Record<string, string> = {
  IDLE: "空闲",
  RUNNING: "运行中",
  WAITING: "等待中",
  WAITING_HUMAN: "等待人工确认",
  COMPLETED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export async function mountLuftballonsPanel(
  runtime: Runtime,
  mountParent: ParentNode = document.documentElement,
  options: MountPanelOptions = {},
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
  brandLabel(toggle);

  const panel = document.createElement("div");
  panel.className = "lb-panel";
  panel.hidden = true;

  const title = document.createElement("h1");
  title.className = "lb-title";
  brandLabel(title);

  const sub = document.createElement("p");
  sub.className = "lb-sub";
  text(sub, `运行时 ${runtime.version} · 本地优先 · 人工触发`);

  const modulesTitle = document.createElement("div");
  modulesTitle.className = "lb-section-title";
  text(modulesTitle, "模块");

  const modulesBox = document.createElement("div");

  const taskTitle = document.createElement("div");
  taskTitle.className = "lb-section-title";
  text(taskTitle, "任务");

  const statusBox = document.createElement("div");
  statusBox.className = "lb-status";
  text(statusBox, "空闲 — 暂无任务");

  const errorBox = document.createElement("div");
  errorBox.className = "lb-error";
  text(errorBox, "");

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "lb-btn lb-btn-cancel";
  text(cancelBtn, "取消");
  cancelBtn.disabled = true;

  const collections = createCollectionsSection(runtime);
  const server = createServerSection(runtime);

  panel.append(
    title,
    sub,
    modulesTitle,
    modulesBox,
    taskTitle,
    statusBox,
    cancelBtn,
    errorBox,
    collections.root,
    server.root,
  );
  root.append(toggle, panel);
  shadow.appendChild(root);
  mountParent.appendChild(host);

  options.humanGate?.attach(panel);

  let open = false;
  let activeTaskId: string | null = null;
  let rows: ModuleRow[] = [];

  const setError = (message: string): void => {
    text(errorBox, message);
  };

  const renderStatus = (snapshot: TaskSnapshot | null): void => {
    if (!snapshot) {
      text(statusBox, "空闲 — 暂无任务");
      cancelBtn.disabled = true;
      activeTaskId = null;
      return;
    }
    activeTaskId = snapshot.taskId;
    const progress = snapshot.progressMessage ?? "";
    const stateText = STATE_LABELS[snapshot.state] ?? snapshot.state;
    text(
      statusBox,
      [
        `模块：${snapshot.moduleId}`,
        `状态：${stateText}`,
        progress ? `进度：${progress}` : "",
        snapshot.result ? `结果：${snapshot.result.summary}` : "",
        ...(snapshot.result?.warnings?.map(
          (w) => `警告 [${w.code}]：${w.message}`,
        ) ?? []),
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

  const applySubtitleSelection = (mod: SubtitleMultilangModule, block: HTMLElement): void => {
    const checked = [
      ...block.querySelectorAll<HTMLInputElement>(
        'input[data-lb-lang]:checked',
      ),
    ].map((input) => resolveLanguage(input.value, input.getAttribute("data-lb-label") ?? undefined));

    const customCode = block.querySelector<HTMLInputElement>(
      'input[data-lb-custom-code]',
    )?.value.trim();
    const customLabel = block.querySelector<HTMLInputElement>(
      'input[data-lb-custom-label]',
    )?.value.trim();
    if (customCode) {
      checked.push(resolveLanguage(customCode, customLabel || undefined));
    }
    mod.setTargetLanguages(checked);
  };

  const renderSubtitleLanguagePicker = (
    block: HTMLElement,
    mod: SubtitleMultilangModule,
  ): void => {
    const selected = new Set(
      mod.getTargetLanguages().map((l) => l.code.toLowerCase()),
    );

    const list = document.createElement("div");
    list.className = "lb-lang-list";

    for (const lang of PRESET_SUBTITLE_LANGUAGES) {
      const row = document.createElement("label");
      row.className = "lb-lang-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-lb-lang", "true");
      cb.setAttribute("data-lb-label", lang.label);
      cb.value = lang.code;
      cb.checked = selected.has(lang.code.toLowerCase());
      const label = document.createElement("span");
      text(label, `${lang.label} (${lang.code})`);
      row.append(cb, label);
      list.append(row);
    }

    const custom = document.createElement("div");
    custom.className = "lb-lang-custom";
    const codeInput = document.createElement("input");
    codeInput.setAttribute("data-lb-custom-code", "true");
    codeInput.placeholder = "语言代码";
    const labelInput = document.createElement("input");
    labelInput.setAttribute("data-lb-custom-label", "true");
    labelInput.placeholder = "显示名称";
    custom.append(codeInput, labelInput);

    block.append(list, custom);
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
      let availText: string;
      if (row.availability.available) {
        availText = `可用 · ${row.id}`;
      } else if (row.availability.reason === "DISABLED") {
        const detail =
          typeof row.availability.metadata?.detail === "string"
            ? row.availability.metadata.detail
            : typeof row.availability.metadata?.cause === "string"
              ? String(row.availability.metadata.cause)
              : "远端禁用";
        availText = `已禁用（${detail}） · ${row.id}`;
      } else {
        availText = `不可用（${row.availability.reason ?? "未知原因"}） · ${row.id}`;
      }
      text(meta, availText);

      block.append(nameEl, meta);

      if (isSubtitleControls(row.module)) {
        renderSubtitleLanguagePicker(block, row.module);
      }

      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "lb-btn";
      text(
        startBtn,
        row.id === "youtube.channel.basic"
          ? "采集频道数据"
          : row.id === "youtube.subtitle.multilang"
            ? "添加多语言字幕"
            : "开始",
      );
      startBtn.disabled = !row.availability.available || isBusy();
      startBtn.addEventListener("click", () => {
        void (async () => {
          setError("");
          try {
            if (isSubtitleControls(row.module)) {
              applySubtitleSelection(row.module, block);
            }
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

      block.append(startBtn);
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
      module: entry.module,
    }));
    renderModules();
  };

  toggle.addEventListener("click", () => {
    open = !open;
    panel.hidden = !open;
    brandLabel(toggle, open ? " ▾" : "");
    if (open) {
      void refreshAvailability();
      void collections.refresh();
      server.refresh();
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
    if (
      snapshot.state === "COMPLETED" ||
      snapshot.state === "PARTIAL" ||
      snapshot.state === "FAILED" ||
      snapshot.state === "CANCELLED"
    ) {
      void collections.refresh();
    }
  });

  await refreshAvailability();
  await collections.refresh();
  renderStatus(null);

  return {
    open(): void {
      open = true;
      panel.hidden = false;
      brandLabel(toggle, " ▾");
      void refreshAvailability();
      void collections.refresh();
      server.refresh();
    },
    close(): void {
      open = false;
      panel.hidden = true;
      brandLabel(toggle);
    },
    destroy(): void {
      unsubscribe();
      options.humanGate?.detach();
      host.remove();
    },
  };
}
