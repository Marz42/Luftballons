/**
 * Collections list UI — DocumentFragment batch render (P1-T4).
 * Uses textContent / createElement only (no untrusted innerHTML).
 */

import type { Runtime } from "../runtime/runtime.js";
import type { CollectionSummary } from "../schemas/collection.js";

function text(el: HTMLElement, value: string): void {
  el.textContent = value;
}

function formatSummaryLine(row: CollectionSummary): string {
  const count =
    row.itemCount !== undefined ? `${row.itemCount} 条` : "条目数未知";
  return `${row.capturedAt} · ${row.collector} · ${row.status} · ${count}`;
}

function formatWarnings(row: CollectionSummary): string {
  if (!row.warnings || row.warnings.length === 0) return "";
  return row.warnings.map((w) => `[${w.code}] ${w.message}`).join("; ");
}

export interface CollectionsSectionHandle {
  refresh(): Promise<void>;
  root: HTMLElement;
}

export function createCollectionsSection(
  runtime: Runtime,
): CollectionsSectionHandle {
  const root = document.createElement("div");
  root.className = "lb-collections";

  const title = document.createElement("div");
  title.className = "lb-section-title";
  text(title, "采集记录");

  const listBox = document.createElement("div");
  listBox.className = "lb-collections-list";
  listBox.setAttribute("data-luftballons-collections", "true");

  const empty = document.createElement("div");
  empty.className = "lb-collections-empty";
  text(empty, "暂无采集记录。运行采集任务后，数据将保存在本地。");

  const errorBox = document.createElement("div");
  errorBox.className = "lb-error";
  text(errorBox, "");

  root.append(title, listBox, empty, errorBox);

  const setError = (message: string): void => {
    text(errorBox, message);
    if (message) {
      errorBox.classList.add("lb-error");
    } else {
      errorBox.classList.remove("lb-error");
    }
  };

  const renderRows = (rows: CollectionSummary[]): void => {
    while (listBox.firstChild) {
      listBox.removeChild(listBox.firstChild);
    }

    if (rows.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const block = document.createElement("div");
      block.className = "lb-collection";
      block.setAttribute("data-collection-id", row.collectionId);

      const meta = document.createElement("div");
      meta.className = "lb-collection-meta";
      text(meta, formatSummaryLine(row));

      const actions = document.createElement("div");
      actions.className = "lb-collection-actions";

      const exportCsv = document.createElement("button");
      exportCsv.type = "button";
      exportCsv.className = "lb-btn lb-btn-small";
      text(exportCsv, "导出 CSV");
      exportCsv.addEventListener("click", () => {
        void (async () => {
          setError("");
          const collection = await runtime.collections.get(row.collectionId);
          if (!collection) {
            setError("Collection not found");
            return;
          }
          const result = await runtime.csvSink.write(collection);
          if (result.status === "FAILED") {
            setError(result.message ?? "CSV export failed");
          }
        })();
      });

      const exportJson = document.createElement("button");
      exportJson.type = "button";
      exportJson.className = "lb-btn lb-btn-small";
      text(exportJson, "导出 JSON");
      exportJson.addEventListener("click", () => {
        void (async () => {
          setError("");
          const collection = await runtime.collections.get(row.collectionId);
          if (!collection) {
            setError("Collection not found");
            return;
          }
          const result = await runtime.jsonSink.write(collection);
          if (result.status === "FAILED") {
            setError(result.message ?? "JSON export failed");
          }
        })();
      });

      const syncBtn = document.createElement("button");
      syncBtn.type = "button";
      syncBtn.className = "lb-btn lb-btn-small";
      text(syncBtn, "同步到服务器");
      syncBtn.setAttribute("data-lb-sync", "true");
      syncBtn.addEventListener("click", () => {
        void (async () => {
          setError("");
          if (!runtime.network) {
            setError("网络服务不可用");
            return;
          }
          const collection = await runtime.collections.get(row.collectionId);
          if (!collection) {
            setError("Collection not found");
            return;
          }
          const result = await runtime.network.sendCollection(collection);
          // Local IndexedDB is never deleted on sync success or failure (MVP).
          if (result.status === "FAILED") {
            setError(result.message ?? "同步失败（本地数据已保留）");
            return;
          }
          text(
            errorBox,
            result.alreadyIngested
              ? "服务器已有此数据（幂等），本地已保留"
              : "同步成功，本地已保留",
          );
          errorBox.classList.remove("lb-error");
        })();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "lb-btn lb-btn-small lb-btn-cancel";
      text(deleteBtn, "删除");
      deleteBtn.addEventListener("click", () => {
        void (async () => {
          setError("");
          await runtime.collections.delete(row.collectionId);
          await refresh();
        })();
      });

      actions.append(exportCsv, exportJson, syncBtn, deleteBtn);
      const warnLine = formatWarnings(row);
      if (warnLine) {
        const warnBox = document.createElement("div");
        warnBox.className = "lb-collection-warnings";
        warnBox.setAttribute("data-collection-warnings", "true");
        text(warnBox, warnLine);
        block.append(meta, warnBox, actions);
      } else {
        block.append(meta, actions);
      }
      fragment.appendChild(block);
    }
    listBox.appendChild(fragment);
  };

  const refresh = async (): Promise<void> => {
    setError("");
    const rows = await runtime.collections.list();
    renderRows(rows);
  };

  return { root, refresh };
}
