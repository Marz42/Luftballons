import { afterEach, describe, expect, it } from "vitest";
import { createRuntime } from "../../src/runtime/runtime.js";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import { IndexedDbCollectionService } from "../../src/services/collection-service.js";
import { CsvSink } from "../../src/sinks/csv-sink.js";
import { JsonSink } from "../../src/sinks/json-sink.js";
import { mountLuftballonsPanel } from "../../src/ui/panel.js";
import type { PanelHandle } from "../../src/ui/panel.js";
import type { Collection } from "../../src/schemas/collection.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import { createCollectionsSection } from "../../src/ui/collections-section.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

function makeCollection(
  index: number,
): Collection<ChannelBasicData> {
  const capturedAt = new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString();
  return {
    collectionId: `col-${index}`,
    installationId: "inst-ui",
    collector: "youtube.channel.basic",
    collectorVersion: 1,
    schemaVersion: 1,
    capturedAt,
    status: index % 2 === 0 ? "COMPLETE" : "PARTIAL",
    data: {
      channel: { channelName: `Channel ${index}` },
      period: { label: "28d" },
      summary: { views: index },
      recentVideos: [
        {
          title: `Video ${index}`,
          views: index,
          capturedAt,
        },
      ],
    },
  };
}

describe("Collections UI (P1-T4)", () => {
  let panel: PanelHandle | undefined;
  const dbNames: string[] = [];

  afterEach(async () => {
    panel?.destroy();
    panel = undefined;
    document.documentElement
      .querySelectorAll("[data-luftballons-root]")
      .forEach((el) => el.remove());
    while (dbNames.length > 0) {
      const name = dbNames.pop();
      if (!name) {
        break;
      }
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    }
  });

  it("renders 100 collections via DocumentFragment without empty-state", async () => {
    const dbName = `luftballons-ui-100-${Math.random().toString(16).slice(2)}`;
    dbNames.push(dbName);
    const collections = new IndexedDbCollectionService({ dbName });
    for (let i = 0; i < 100; i++) {
      await collections.save(makeCollection(i));
    }

    const registry = new ModuleRegistry();
    const logger = silentLogger();
    const taskRunner = new TaskRunner({
      registry,
      logger,
      collectionService: collections,
    });
    const runtime = createRuntime({
      registry,
      taskRunner,
      logger,
      collections,
      csvSink: new CsvSink({ download: () => {} }),
      jsonSink: new JsonSink({ download: () => {} }),
    });

    panel = await mountLuftballonsPanel(runtime);
    panel.open();

    const host = document.documentElement.querySelector(
      "[data-luftballons-root]",
    );
    const shadow = host?.shadowRoot;
    const list = shadow?.querySelector("[data-luftballons-collections]");
    const items = list?.querySelectorAll(".lb-collection") ?? [];
    expect(items.length).toBe(100);

    const empty = shadow?.querySelector(".lb-collections-empty") as
      | HTMLElement
      | null;
    expect(empty?.hidden).toBe(true);

    const first = items[0];
    expect(first?.querySelectorAll("button").length).toBe(3);
    expect(first?.textContent).toMatch(/导出 CSV/);
    expect(first?.textContent).toMatch(/导出 JSON/);
    expect(first?.textContent).toMatch(/删除/);
  });

  it("shows empty-state copy when no collections", async () => {
    const dbName = `luftballons-ui-empty-${Math.random().toString(16).slice(2)}`;
    dbNames.push(dbName);
    const collections = new IndexedDbCollectionService({ dbName });
    const registry = new ModuleRegistry();
    const logger = silentLogger();
    const runtime = createRuntime({
      registry,
      taskRunner: new TaskRunner({
        registry,
        logger,
        collectionService: collections,
      }),
      logger,
      collections,
    });

    const section = createCollectionsSection(runtime);
    document.body.appendChild(section.root);
    await section.refresh();
    const empty = section.root.querySelector(
      ".lb-collections-empty",
    ) as HTMLElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("No collections yet");
    section.root.remove();
  });
});
