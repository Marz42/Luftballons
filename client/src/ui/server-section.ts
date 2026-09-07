/**
 * Server settings panel — Chinese copy, human-triggered register/sync only.
 */

import type { Runtime } from "../runtime/runtime.js";
import type { NetworkMode } from "../services/network-settings.js";
import { getOrCreateInstallation } from "../schemas/installation.js";

function text(el: HTMLElement, value: string): void {
  el.textContent = value;
}

export interface ServerSectionHandle {
  root: HTMLElement;
  refresh(): void;
}

export function createServerSection(runtime: Runtime): ServerSectionHandle {
  const root = document.createElement("div");
  root.className = "lb-server";
  root.setAttribute("data-luftballons-server", "true");

  const title = document.createElement("div");
  title.className = "lb-section-title";
  text(title, "Server");

  const hint = document.createElement("div");
  hint.className = "lb-server-hint";
  text(
    hint,
    "可选远程汇总。默认 MANUAL：仅在点击同步时上传；OFF 为零网络。",
  );

  const baseLabel = document.createElement("label");
  baseLabel.className = "lb-field";
  const baseCaption = document.createElement("span");
  text(baseCaption, "服务器地址");
  const baseInput = document.createElement("input");
  baseInput.type = "url";
  baseInput.placeholder = "http://192.168.2.10:8000";
  baseInput.setAttribute("data-lb-server-base", "true");
  baseLabel.append(baseCaption, baseInput);

  const tokenLabel = document.createElement("label");
  tokenLabel.className = "lb-field";
  const tokenCaption = document.createElement("span");
  text(tokenCaption, "Installation Token");
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.placeholder = "Bearer token";
  tokenInput.setAttribute("data-lb-server-token", "true");
  tokenLabel.append(tokenCaption, tokenInput);

  const modeLabel = document.createElement("label");
  modeLabel.className = "lb-field";
  const modeCaption = document.createElement("span");
  text(modeCaption, "网络模式");
  const modeSelect = document.createElement("select");
  modeSelect.setAttribute("data-lb-network-mode", "true");
  for (const mode of ["MANUAL", "OFF", "ENABLED"] as NetworkMode[]) {
    const opt = document.createElement("option");
    opt.value = mode;
    text(opt, mode === "MANUAL" ? "MANUAL（手动同步）" : mode === "OFF" ? "OFF（零网络）" : "ENABLED");
    modeSelect.append(opt);
  }
  modeLabel.append(modeCaption, modeSelect);

  const idBox = document.createElement("div");
  idBox.className = "lb-server-id";
  idBox.setAttribute("data-lb-installation-id", "true");

  const msg = document.createElement("div");
  msg.className = "lb-server-msg";
  msg.setAttribute("data-lb-server-msg", "true");

  const tokenOnce = document.createElement("div");
  tokenOnce.className = "lb-server-token-once";
  tokenOnce.setAttribute("data-lb-token-once", "true");
  tokenOnce.hidden = true;

  const actions = document.createElement("div");
  actions.className = "lb-collection-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "lb-btn lb-btn-small";
  text(saveBtn, "保存");

  const registerBtn = document.createElement("button");
  registerBtn.type = "button";
  registerBtn.className = "lb-btn lb-btn-small";
  text(registerBtn, "注册新安装");

  actions.append(saveBtn, registerBtn);
  root.append(
    title,
    hint,
    baseLabel,
    tokenLabel,
    modeLabel,
    idBox,
    actions,
    msg,
    tokenOnce,
  );

  const setMsg = (value: string, isError = false): void => {
    text(msg, value);
    msg.classList.toggle("lb-error", isError);
  };

  const refresh = (): void => {
    const network = runtime.network;
    const settings = network?.getSettings();
    baseInput.value = settings?.baseUrl ?? "";
    tokenInput.value = settings?.token ?? "";
    modeSelect.value = settings?.networkMode ?? runtime.config.networkMode;
    const identity = getOrCreateInstallation();
    text(idBox, `installation_id: ${identity.installationId}`);
  };

  saveBtn.addEventListener("click", () => {
    tokenOnce.hidden = true;
    text(tokenOnce, "");
    if (!runtime.network) {
      setMsg("网络服务不可用", true);
      return;
    }
    runtime.network.saveSettings({
      baseUrl: baseInput.value,
      token: tokenInput.value,
      networkMode: modeSelect.value as NetworkMode,
    });
    setMsg("已保存到本地");
    refresh();
  });

  registerBtn.addEventListener("click", () => {
    void (async () => {
      tokenOnce.hidden = true;
      text(tokenOnce, "");
      setMsg("");
      if (!runtime.network) {
        setMsg("网络服务不可用", true);
        return;
      }
      // Persist URL/mode first so register uses current form values.
      runtime.network.saveSettings({
        baseUrl: baseInput.value,
        networkMode: modeSelect.value as NetworkMode,
      });
      if (modeSelect.value === "OFF") {
        setMsg("网络模式为 OFF，无法注册", true);
        return;
      }
      const result = await runtime.network.registerInstallation();
      if (result.status === "FAILED") {
        setMsg(result.message ?? "注册失败", true);
        return;
      }
      // Show token once in UI; do not rely on logs.
      tokenInput.value = result.token ?? "";
      tokenOnce.hidden = false;
      text(
        tokenOnce,
        `新 token（仅显示一次，请复制保存）：${result.token ?? ""}`,
      );
      setMsg(result.message ?? "注册成功");
      refresh();
      tokenInput.value = result.token ?? "";
    })();
  });

  refresh();
  return { root, refresh };
}
