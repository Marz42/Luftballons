/**
 * Review 2026-10-22 regression probes (REVIEW.md R1–R8). Expected-behavior
 * assertions — each one failed against 527ba7e and pins a fixed defect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomService, resolveDomTarget } from "../../src/services/dom-service.js";
import { resolveLanguageCodeFromLabel } from "../../src/sites/youtube-studio/modules/subtitle-multilang/schema.js";
import { classifyTranslatePhase, editorLanguageBinding, parseLanguageList } from "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js";
import { parseFamilyAVideos, detectContentFamily } from "../../src/sites/youtube-studio/modules/channel-basic/content-adapter.js";
import { DEFAULT_COLLECTOR_DATA, mountStudioFixture, type CollectorFixtureData, type StudioFixtureHandle } from "../fixtures/studio-simulated.js";
import { createFixtureChannelModule } from "./channel-basic-test-utils.js";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import { IndexedDbCollectionService } from "../../src/services/collection-service.js";
import { sendCollection } from "../../src/sinks/remote-sink.js";
import { createFixtureSubtitleModule, createDeferredHumanGate } from "./subtitle-multilang-test-utils.js";
import { getSubtitleTarget } from "../../src/sites/youtube-studio/selectors.js";

function el(tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

let fixture: StudioFixtureHandle | undefined;
afterEach(() => { fixture?.destroy(); fixture = undefined; document.body.replaceChildren(); });

/** DEFAULT_COLLECTOR_DATA without the two subscriber metric controls. */
function collectorWithoutSubscriberMetrics(): CollectorFixtureData {
  return {
    channelName: DEFAULT_COLLECTOR_DATA.channelName,
    periodLabel: DEFAULT_COLLECTOR_DATA.periodLabel,
    ...(DEFAULT_COLLECTOR_DATA.dashboardViews !== undefined
      ? { dashboardViews: DEFAULT_COLLECTOR_DATA.dashboardViews }
      : {}),
    ...(DEFAULT_COLLECTOR_DATA.analyticsViews !== undefined
      ? { analyticsViews: DEFAULT_COLLECTOR_DATA.analyticsViews }
      : {}),
    recentVideos: DEFAULT_COLLECTOR_DATA.recentVideos.map((v) => ({ ...v })),
  };
}

describe("Review expected-behavior probes", () => {
  it.each([["1.2K", 1200], ["1.2万", 12000]])("normalizes Hub metric %s to %s", (raw, wanted) => {
    document.body.append(el("ytcp-section-list-renderer", { "data-target-id": "browse-feedFEcontent_hub" }, [
      el("horizontal-shelf-view-model", {}, [
        el("h2", { class: "ytShelfHeaderLayoutTitle" }, ["视频"]),
        el("yt-lockup-view-model", {}, [
          el("h3", {}, [el("a", { href: "/video/AbCdEf12345/edit", class: "ytLockupMetadataViewModelTitle" }, ["Demo"])]),
          el("div", { class: "ytContentMetadataViewModelMetadataRow" }, [
            el("span", { "aria-label": "观看次数 views" }), el("span", {}, [raw]),
          ]),
        ]),
      ]),
    ]));
    expect(parseFamilyAVideos(document)[0]?.views).toBe(wanted);
  });

  it("does not collapse regional English into generic English", () => {
    expect(resolveLanguageCodeFromLabel("英语（美国）")).not.toBe("en");
  });

  it("keeps pt-BR when Studio appends a video-language annotation", () => {
    expect(resolveLanguageCodeFromLabel("葡萄牙语（巴西） （视频语言）")).toBe("pt-BR");
  });

  it.each([["中文（简体）", "zh-Hans"], ["中文（繁体）", "zh-Hant"], ["葡萄牙语（巴西）", "pt-BR"]])("parses the actual label-only row %s as %s", async (label, code) => {
    document.body.append(el("div", { "data-luftballons-target": "subtitle.languages.list" }, [
      el("ytgn-video-translation-row", {}, [el("span", { class: "language-text" }, [label])]),
    ]));
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    expect("rows" in parsed ? parsed.rows[0]?.code : null).toBe(code);
  });

  it("refuses ambiguous unique targets before trying a more generic fallback", () => {
    document.body.append(el("button", { class: "specific" }, ["first"]), el("button", { class: "specific" }, ["second"]), el("button", { id: "generic" }, ["wrong fallback"]));
    expect(resolveDomTarget({ id: "review.unique", unique: true, selectorFallback: [".specific", "#generic"] }, document)).toBeNull();
  });

  it("refuses two enabled Publish controls even when one has the preferred ID", () => {
    document.body.append(el("button", { id: "publish-button", "aria-label": "Publish" }, ["Publish"]), el("button", { "aria-label": "Publish" }, ["Publish"]));
    expect(resolveDomTarget(getSubtitleTarget("subtitle.publish"), document)).toBeNull();
  });

  it("ignores a retained inactive Hub when the active content is a table", () => {
    document.body.append(
      el("ytcp-animatable", { class: "page", name: "channel.content" }, [el("ytcp-section-list-renderer", { "data-target-id": "browse-feedFEcontent_hub" })]),
      el("ytcp-animatable", { class: "page selected", name: "channel.videos" }, [el("ytcp-video-section-content", { id: "video-list" })]),
    );
    expect(detectContentFamily(document)).toBe("B_TABLE");
  });

  it("rejects a Portuguese editor when the target is Japanese", async () => {
    const panel = el("ytve-captions-editor-options-panel", {}, [
      el("h2", {}, ["Português"]),
      el("ytve-lightweight-textarea", {}, [el("pre", {}, ["Texto em português"])]),
    ]);
    document.body.append(panel);
    const japanese = { code: "ja", label: "日本語" };
    expect.soft(editorLanguageBinding(panel, japanese)).toBe("mismatch");
    expect(await classifyTranslatePhase(createDomService(), japanese)).not.toBe("READY");
  });

  it("does not call collection COMPLETE when both subscriber metric controls are missing", async () => {
    // Setup correction vs. the audit copy (2026-10-22): the original probe only
    // REMOVED the mounted nodes, but mountStudioFixture re-renders the ANALYTICS
    // page on navigation — the removed analytics control came back with "+120",
    // the collection genuinely contained {views:12345, subscriberDelta:120} and
    // COMPLETE was factually correct (verified by scratch run). The probe's own
    // scenario — "both subscriber metric controls missing" — is constructed here
    // by never mounting those controls on ANY page. The assertion is unchanged.
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: collectorWithoutSubscriberMetrics(),
    });
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture, { collectionId: "review-missing-metric" }));
    const collections = new IndexedDbCollectionService({ dbName: `review-missing-${Math.random()}` });
    const runner = new TaskRunner({ registry, collectionService: collections,
      logger: createLogger({ minLevel: "ERROR", sink: () => {} }),
      getLocation: () => ({ hostname: "studio.youtube.com", href: fixture!.href }),
    });
    const task = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => expect(["COMPLETED", "PARTIAL", "FAILED"]).toContain(runner.getState(task)), { timeout: 7000 });
    const result = await collections.get("review-missing-metric");
    expect(result?.status).toBe("PARTIAL");
    expect(result?.warnings?.some((w) => w.code === "METRIC_CONTROL_MISSING")).toBe(true);
  }, 9000);

  it("still completes when a missing Dashboard control is recovered on Analytics", async () => {
    // Companion guard for R5: a missing control is fail-closed only when the
    // data is genuinely unobtainable — a healthy cross-page recovery keeps the
    // COMPLETE semantics (H5) and merely records METRIC_CONTROL_MISSING.
    fixture = mountStudioFixture({
      page: "DASHBOARD",
      layout: "2026_V1",
      collector: {
        ...collectorWithoutSubscriberMetrics(),
        analyticsSubscriberDelta: "+7",
      },
    });
    document.querySelector('[data-luftballons-target="dashboard.subscriberDelta"]')?.remove();
    const registry = new ModuleRegistry();
    registry.register(createFixtureChannelModule(fixture, { collectionId: "review-recovered-metric" }));
    const collections = new IndexedDbCollectionService({ dbName: `review-recovered-${Math.random()}` });
    const runner = new TaskRunner({ registry, collectionService: collections,
      logger: createLogger({ minLevel: "ERROR", sink: () => {} }),
      getLocation: () => ({ hostname: "studio.youtube.com", href: fixture!.href }),
    });
    const task = await runner.start("youtube.channel.basic");
    await vi.waitFor(() => expect(["COMPLETED", "PARTIAL", "FAILED"]).toContain(runner.getState(task)), { timeout: 7000 });
    const result = await collections.get("review-recovered-metric");
    const summary = (result?.data as { summary?: { subscriberDelta?: number } } | undefined)?.summary;
    expect(summary?.subscriberDelta).toBe(7);
    expect(result?.status).toBe("COMPLETE");
  }, 9000);

  it("preserves the newly persisted warning reasons in the remote sync payload", async () => {
    let sent: Record<string, unknown> = {};
    const warnings = [{ code: "VIDEO_SCOPE_PARTIAL", message: "Rendered shelf only" }];
    await sendCollection({ collectionId: "audit-col", installationId: "audit-inst", collector: "youtube.channel.basic", collectorVersion: 1, schemaVersion: 1, capturedAt: "2026-10-22T00:00:00Z", status: "PARTIAL", data: {}, warnings }, {
      baseUrl: "https://example.invalid", token: "audit-fake-token", fetchImpl: async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response('{"already_ingested":false}', { status: 201 });
      },
    });
    expect(sent.warnings).toEqual(warnings);
  });

  it("honors the 90-second translation window when Publish stays disabled for 9 seconds", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", layout: "2026_V1", subtitles: {
      existingLanguages: [{ code: "en", label: "English" }], pickerLanguages: [{ code: "ja", label: "日本語" }], autoTranslateContentDelayMs: 9000,
    } });
    const registry = new ModuleRegistry();
    registry.register(createFixtureSubtitleModule(fixture, { initialLanguages: [{ code: "ja", label: "日本語" }] }));
    const gate = createDeferredHumanGate();
    const runner = new TaskRunner({ registry, humanGate: gate, logger: createLogger({ minLevel: "ERROR", sink: () => {} }), getLocation: () => ({ hostname: "studio.youtube.com", href: fixture!.href }) });
    const task = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(task)).toBe("WAITING_HUMAN"));
    const publish = document.querySelector<HTMLButtonElement>('[data-luftballons-target="subtitle.publish"]')!;
    publish.removeAttribute("data-luftballons-target"); // exercise live disabled filtering
    let timer: ReturnType<typeof setTimeout> | undefined;
    document.querySelector("#choose-auto-translate")!.addEventListener("click", () => {
      publish.disabled = true; publish.setAttribute("aria-disabled", "true");
      timer = setTimeout(() => { publish.disabled = false; publish.setAttribute("aria-disabled", "false"); }, 9000);
    });
    gate.resolve("APPROVED");
    try {
      await vi.waitFor(() => expect(["COMPLETED", "PARTIAL", "FAILED"]).toContain(runner.getState(task)), { timeout: 12000 });
      expect(runner.getSnapshot(task).result?.summary).not.toContain("Publish (发布) did not become available");
      expect(runner.getState(task), runner.getSnapshot(task).result?.summary).toBe("COMPLETED");
    } finally { clearTimeout(timer); await runner.cancel(task); }
  }, 15000);
});
