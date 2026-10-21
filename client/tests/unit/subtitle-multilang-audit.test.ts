/**
 * Regression tests for the 2026-10-21 audit fixes (audit #1–#7, #15).
 * Scope: subtitle-multilang workflow/schema only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/runtime/module-registry.js";
import { TaskRunner } from "../../src/runtime/task-runner.js";
import { createLogger } from "../../src/services/logger.js";
import {
  mountStudioFixture,
  type StudioFixtureHandle,
} from "../fixtures/studio-simulated.js";
import {
  createAutoApproveGate,
  createAutoRejectGate,
  createDeferredHumanGate,
  createFixtureSubtitleModule,
} from "./subtitle-multilang-test-utils.js";

function silentLogger() {
  return createLogger({ minLevel: "ERROR", sink: () => {} });
}

describe("subtitle-multilang audit fixes (2026-10-21)", () => {
  let fixture: StudioFixtureHandle | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    document.body.replaceChildren();
  });

  function makeRunner(
    module: ReturnType<typeof createFixtureSubtitleModule>,
    humanGate = createAutoApproveGate(),
  ) {
    const registry = new ModuleRegistry();
    registry.register(module);
    return new TaskRunner({
      registry,
      logger: silentLogger(),
      humanGate,
      getLocation: () => ({
        hostname: "studio.youtube.com",
        href: fixture!.href,
      }),
    });
  }

  /** Mount a Layout-B style 手动字幕 row whose Add control we can count. */
  function mountManualCaptionsRow(options: {
    labelText: string;
    codeAttr?: string;
  }): { clicks: () => number } {
    let clicks = 0;
    const row = document.createElement("tr");
    row.className = "manual-subtitles-row";
    if (options.codeAttr) {
      row.setAttribute("data-language-code", options.codeAttr);
    }
    const langCell = document.createElement("td");
    const langText = document.createElement("span");
    langText.className = "language-text";
    langText.textContent = options.labelText;
    langCell.append(langText);
    const btnCell = document.createElement("td");
    const btn = document.createElement("button");
    btn.id = "language-details-text-button-subtitles";
    btn.textContent = "添加";
    btn.addEventListener("click", () => {
      clicks += 1;
    });
    btnCell.append(btn);
    row.append(langCell, btnCell);
    document.body.append(row);
    return { clicks: () => clicks };
  }

  // ---------------------------------------------------------------------
  // audit #1 — single-language failure must not abort the queue
  // ---------------------------------------------------------------------

  it("audit#1: failure of the FIRST language does not abort the queue (PARTIAL)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        // ja missing from the picker → ja fails; en must still be processed.
        pickerLanguages: [{ code: "en", label: "English" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [
          { code: "ja", label: "日本語" },
          { code: "en", label: "English" },
        ],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("PARTIAL"), {
      timeout: 15_000,
    });
    const result = runner.getSnapshot(id).result;
    const summary = result?.summary ?? "";
    expect(summary).toMatch(/日本語\(ja\) FAILED/);
    expect(summary).toMatch(/English\(en\) SUCCESS/);
    expect(fixture.clickCounts.option).toBe(1); // en still processed
    expect(fixture.clickCounts.publish).toBe(1);
  }, 20_000);

  it("audit#1: all languages failing ends FAILED via buildResult", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "en", label: "English" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [
          { code: "ja", label: "日本語" },
          { code: "ko", label: "한국어" },
        ],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), {
      timeout: 15_000,
    });
    const summary = runner.getSnapshot(id).result?.summary ?? "";
    expect(summary).toMatch(/日本語\(ja\) FAILED/);
    expect(summary).toMatch(/한국어\(ko\) FAILED/);
    expect(fixture.clickCounts.publish).toBe(0);
  }, 20_000);

  // ---------------------------------------------------------------------
  // audit #5 — Human Gate rejection is CANCELLED, not COMPLETED
  // ---------------------------------------------------------------------

  it("audit#5: Human Gate rejection → CANCELLED with HUMAN_GATE_REJECTED", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      createAutoRejectGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("CANCELLED"));
    const result = runner.getSnapshot(id).result;
    expect(result?.status).toBe("CANCELLED");
    expect(result?.warnings?.some((w) => w.code === "HUMAN_GATE_REJECTED")).toBe(
      true,
    );
    expect(result?.summary).toMatch(/REJECTED/i);
    expect(fixture.clickCounts.publish).toBe(0);
  });

  // ---------------------------------------------------------------------
  // audit #7 — empty language list confirmation
  // ---------------------------------------------------------------------

  it("audit#7a: quiet zero-row list without loading chrome confirms EMPTY and proceeds", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        // No fixture marker (audit #7b) — the real empty-state signal must do.
        omitEmptyState: true,
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"), {
      timeout: 15_000,
    });
    expect(fixture.clickCounts.addLanguage).toBe(1);
    expect(fixture.clickCounts.publish).toBe(1);
    expect(runner.getSnapshot(id).result?.summary).toMatch(
      /日本語\(ja\) SUCCESS/,
    );
  }, 20_000);

  it("audit#7c: zero rows with loading chrome stays fail-closed and says why", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        omitEmptyState: true,
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const gate = createDeferredHumanGate();
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      gate,
    );
    const id = await runner.start("youtube.subtitle.multilang");
    // Real "still loading" evidence keeps zero rows unconfirmed (audit #7(a)).
    await vi.waitFor(() => {
      const list = document.querySelector(
        '[data-luftballons-target="subtitle.languages.list"]',
      );
      expect(list).not.toBeNull();
      list!.setAttribute("aria-busy", "true");
      const spinner = document.createElement("div");
      spinner.className = "loading-spinner";
      list!.append(spinner);
    });
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), {
      timeout: 8_000,
    });
    expect(fixture.clickCounts.addLanguage).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    expect(gate.lastAction).toBeNull();
    const detail =
      runner
        .getSnapshot(id)
        .result?.warnings?.map((w) => w.message)
        .join(" ") ?? "";
    expect(detail).toMatch(/could not be confirmed/i);
    expect(detail).toMatch(/fail-closed/i);
  }, 12_000);

  // ---------------------------------------------------------------------
  // audit #6 — header row filter must work for Chinese
  // ---------------------------------------------------------------------

  it("audit#6: zh header row「语言 音频 字幕」is not parsed as a data row", async () => {
    const list = document.createElement("div");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    const header = document.createElement("div");
    header.setAttribute("data-luftballons-subtitle-row", "true");
    header.textContent = "语言 音频 字幕";
    const row = document.createElement("div");
    row.setAttribute("data-luftballons-subtitle-row", "true");
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "日语";
    const captions = document.createElement("div");
    captions.className = "tablecell-captions";
    captions.setAttribute("data-luftballons-captions-cell", "true");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = "已发布";
    captions.append(status);
    row.append(lang, captions);
    list.append(header, row);
    document.body.replaceChildren(list);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList, isLanguageHeaderRowLabel } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    // The old /^语言\b/ never matched CJK (audit #6) — direct coverage too.
    expect(isLanguageHeaderRowLabel("语言")).toBe(true);
    expect(isLanguageHeaderRowLabel("  语言  ")).toBe(true);
    expect(isLanguageHeaderRowLabel("语言 音频 字幕")).toBe(true);
    expect(isLanguageHeaderRowLabel("语言学概论")).toBe(false);
    expect(isLanguageHeaderRowLabel("日语")).toBe(false);

    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ code: "ja" });
  });

  // ---------------------------------------------------------------------
  // audit #3 — editorLanguageBinding codes + alias word boundaries
  // ---------------------------------------------------------------------

  it("audit#3: mixed observed codes → mismatch; all-target codes → match", async () => {
    const { editorLanguageBinding } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const root = document.createElement("div");
    root.setAttribute("data-language-code", "ja");
    const child = document.createElement("div");
    child.setAttribute("data-language-code", "fr");
    root.append(child);
    document.body.replaceChildren(root);
    // Old code returned "match" whenever the target code was present (audit #3).
    expect(
      editorLanguageBinding(root, { code: "ja", label: "日本語" }),
    ).toBe("mismatch");

    const pure = document.createElement("div");
    pure.setAttribute("data-language-code", "ja");
    const pureChild = document.createElement("div");
    pureChild.setAttribute("data-luftballons-subtitle-lang", "ja");
    pure.append(pureChild);
    expect(
      editorLanguageBinding(pure, { code: "ja", label: "日本語" }),
    ).toBe("match");
    expect(
      editorLanguageBinding(pure, { code: "ko", label: "한국어" }),
    ).toBe("mismatch");
  });

  it("audit#3: two-letter code aliases never match ordinary words", async () => {
    const { editorLanguageBinding, aliasMatchesText } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    // "Frenzy Content Settings" contains "en" as a substring — never evidence.
    const root = document.createElement("div");
    root.setAttribute("aria-label", "Frenzy Content Settings");
    document.body.replaceChildren(root);
    expect(
      editorLanguageBinding(root, { code: "en", label: "English" }),
    ).toBe("unknown");

    expect(aliasMatchesText("Frenzy Content Settings", "en")).toBe(false);
    expect(aliasMatchesText("Editor Settings", "de")).toBe(false);
    // Word-boundary ASCII aliases still work.
    expect(aliasMatchesText("English captions", "English")).toBe(true);
    expect(aliasMatchesText("Englishmen", "English")).toBe(false);

    const bound = document.createElement("div");
    bound.setAttribute("aria-label", "English captions");
    expect(
      editorLanguageBinding(bound, { code: "en", label: "English" }),
    ).toBe("match");
    const unbound = document.createElement("div");
    unbound.setAttribute("aria-label", "Englishmen");
    expect(
      editorLanguageBinding(unbound, { code: "en", label: "English" }),
    ).toBe("unknown");
  });

  it("audit#3: other-language label detection uses word boundaries too", async () => {
    const { editorLanguageBinding } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const root = document.createElement("div");
    root.setAttribute("aria-label", "Deutsch Untertitel");
    document.body.replaceChildren(root);
    expect(
      editorLanguageBinding(root, { code: "en", label: "English" }),
    ).toBe("mismatch");
    // CJK alias: token boundary required (exact/bounded match only).
    expect(
      editorLanguageBinding(root, { code: "de", label: "Deutsch" }),
    ).toBe("match");
  });

  it("audit#3: CJK aliases match bounded labels only (fail-closed)", async () => {
    const { aliasMatchesText } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    expect(aliasMatchesText("日语 （视频语言）", "日语")).toBe(true);
    expect(aliasMatchesText("日语", "日语")).toBe(true);
    // Embedded inside another word run — not word-boundary evidence.
    expect(aliasMatchesText("字幕日语编辑器", "日语")).toBe(false);
  });

  // ---------------------------------------------------------------------
  // audit #2 — no blind page-level 手动字幕 fallback
  // ---------------------------------------------------------------------

  it("audit#2: binding/assertion failures rethrow; generic errors rethrow (no click)", async () => {
    const { createDomService } = await import("../../src/services/dom-service.js");
    const {
      fallbackToManualCaptionsAdd,
      UiMismatchError,
      VideoBindingError,
    } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const manual = mountManualCaptionsRow({ labelText: "日语" });
    const dom = createDomService();
    const ac = new AbortController();

    const uiError = new UiMismatchError("captions cell missing");
    await expect(
      fallbackToManualCaptionsAdd(
        dom,
        { code: "ja", label: "日本語" },
        ac.signal,
        uiError,
      ),
    ).rejects.toBe(uiError);

    const bindingError = new VideoBindingError(
      "VIDEO_SWITCHED",
      "video switched",
    );
    await expect(
      fallbackToManualCaptionsAdd(
        dom,
        { code: "ja", label: "日本語" },
        ac.signal,
        bindingError,
      ),
    ).rejects.toBe(bindingError);

    const other = new Error("unexpected crash");
    await expect(
      fallbackToManualCaptionsAdd(
        dom,
        { code: "ja", label: "日本語" },
        ac.signal,
        other,
      ),
    ).rejects.toBe(other);

    expect(manual.clicks()).toBe(0);
  });

  it("audit#2: control-missing fallback only with proven language binding", async () => {
    const { createDomService } = await import("../../src/services/dom-service.js");
    const { fallbackToManualCaptionsAdd, WaitTimeoutError } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const dom = createDomService();
    const ac = new AbortController();

    // (1) No manual control at all → original failure stands.
    const missing = new WaitTimeoutError(
      "Captions add (#captions-add) not found for ja after hover",
    );
    await expect(
      fallbackToManualCaptionsAdd(
        dom,
        { code: "ja", label: "日本語" },
        ac.signal,
        missing,
      ),
    ).rejects.toBe(missing);

    // (2) Manual control bound to ANOTHER language → refused, never clicked.
    const foreign = mountManualCaptionsRow({ labelText: "韩语" });
    await expect(
      fallbackToManualCaptionsAdd(
        dom,
        { code: "ja", label: "日本語" },
        ac.signal,
        new WaitTimeoutError("captions add not found"),
      ),
    ).rejects.toThrow(/fallback refused/i);
    expect(foreign.clicks()).toBe(0);

    // (3) Manual control provably bound to the target → fallback allowed.
    document.body.replaceChildren();
    const bound = mountManualCaptionsRow({
      labelText: "日语",
      codeAttr: "ja",
    });
    await fallbackToManualCaptionsAdd(
      dom,
      { code: "ja", label: "日本語" },
      ac.signal,
      new WaitTimeoutError("captions add not found"),
    );
    expect(bound.clicks()).toBe(1);
    expect(foreign.clicks()).toBe(0);
  });

  it("audit#2: manualControlLanguageBinding proves code and label evidence", async () => {
    const { manualControlLanguageBinding } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const byCode = mountManualCaptionsRow({
      labelText: "???",
      codeAttr: "ja",
    });
    const codeBtn = document.querySelector(
      "#language-details-text-button-subtitles",
    )!;
    expect(
      manualControlLanguageBinding(codeBtn, { code: "ja", label: "日本語" }),
    ).toBe("match");
    expect(
      manualControlLanguageBinding(codeBtn, { code: "ko", label: "한국어" }),
    ).toBe("mismatch");
    expect(byCode.clicks()).toBe(0);

    document.body.replaceChildren();
    const bare = document.createElement("button");
    bare.id = "language-details-text-button-subtitles";
    bare.textContent = "添加";
    document.body.append(bare);
    expect(
      manualControlLanguageBinding(bare, { code: "ja", label: "日本語" }),
    ).toBe("unknown");
  });

  it("audit#2: resume_captions never clicks a foreign manual Add fallback", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [
          {
            code: "ja",
            label: "日语",
            state: "PENDING_PUBLISH",
            captionsStatus: "dash",
          },
        ],
        pickerLanguages: [{ code: "ja", label: "日语" }],
      },
    });
    const gate = createDeferredHumanGate();
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      gate,
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("WAITING_HUMAN"));

    // Sabotage the unique #captions-add lookup (duplicate candidates) so the
    // hover path cannot act and the fallback path becomes reachable.
    const cell = document.querySelector(
      "[data-luftballons-subtitle-row] [data-luftballons-captions-cell]",
    )!;
    for (let i = 0; i < 2; i += 1) {
      const dupe = document.createElement("button");
      dupe.setAttribute("data-luftballons-target", "subtitle.captions_add");
      cell.append(dupe);
    }
    // A leftover 手动字幕 Add control belonging to ANOTHER language.
    const foreign = mountManualCaptionsRow({ labelText: "韩语" });

    gate.resolve("APPROVED");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), {
      timeout: 20_000,
    });
    expect(foreign.clicks()).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    const detail =
      runner
        .getSnapshot(id)
        .result?.warnings?.map((w) => w.message)
        .join(" ") ?? "";
    expect(detail).toMatch(/bound to another language/i);
  }, 25_000);

  it("audit#2: language-bound manual Add fallback is still allowed", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [
          {
            code: "ja",
            label: "日语",
            state: "PENDING_PUBLISH",
            captionsStatus: "dash",
          },
        ],
        pickerLanguages: [{ code: "ja", label: "日语" }],
      },
    });
    const gate = createDeferredHumanGate();
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      gate,
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("WAITING_HUMAN"));

    const cell = document.querySelector(
      "[data-luftballons-subtitle-row] [data-luftballons-captions-cell]",
    )!;
    for (let i = 0; i < 2; i += 1) {
      const dupe = document.createElement("button");
      dupe.setAttribute("data-luftballons-target", "subtitle.captions_add");
      cell.append(dupe);
    }
    const bound = mountManualCaptionsRow({
      labelText: "日语",
      codeAttr: "ja",
    });

    gate.resolve("APPROVED");
    await vi.waitFor(() => expect(bound.clicks()).toBe(1), { timeout: 20_000 });
    expect(fixture.clickCounts.publish).toBe(0);
    // The fallback clicked a manual Add with no auto-translate behind it, so
    // the language still ends FAILED — but never via a blind wrong click.
    await vi.waitFor(() =>
      expect(["FAILED", "PARTIAL"]).toContain(runner.getState(id)),
    { timeout: 15_000 });
  }, 30_000);

  // ---------------------------------------------------------------------
  // audit #4 — manual_dialog surface requires language binding
  // ---------------------------------------------------------------------

  it("audit#4: waitCaptionsEntrySurface accepts manual_dialog only when bound", async () => {
    const { createDomService } = await import("../../src/services/dom-service.js");
    const { waitCaptionsEntrySurface } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const ac = new AbortController();

    const bound = mountManualCaptionsRow({
      labelText: "日语",
      codeAttr: "ja",
    });
    await expect(
      waitCaptionsEntrySurface(
        createDomService(),
        createDomService(),
        { code: "ja", label: "日本語" },
        ac.signal,
      ),
    ).resolves.toBe("manual_dialog");
    expect(bound.clicks()).toBe(0);
    document.body.replaceChildren();

    // Manual control of ANOTHER language → hard mismatch, never accepted.
    mountManualCaptionsRow({ labelText: "韩语" });
    await expect(
      waitCaptionsEntrySurface(
        createDomService(),
        createDomService(),
        { code: "ja", label: "日本語" },
        ac.signal,
      ),
    ).rejects.toThrow(/bound to another language/i);
    document.body.replaceChildren();

    // Manual control without any language evidence → keep waiting, then fail.
    const bare = document.createElement("button");
    bare.id = "language-details-text-button-subtitles";
    bare.textContent = "添加";
    document.body.append(bare);
    await expect(
      waitCaptionsEntrySurface(
        createDomService(),
        createDomService(),
        { code: "ja", label: "日本語" },
        ac.signal,
      ),
    ).rejects.toThrow(/not provably bound/i);
  }, 15_000);

  // ---------------------------------------------------------------------
  // audit #15 — language label mapping gaps (schema.ts)
  // ---------------------------------------------------------------------

  it("audit#15: common Studio language labels map to codes (en + zh)", async () => {
    const { resolveLanguageCodeFromLabel, labelAliasesForLanguage } =
      await import(
        "../../src/sites/youtube-studio/modules/subtitle-multilang/schema.js"
      );
    expect(resolveLanguageCodeFromLabel("Japanese")).toBe("ja");
    expect(resolveLanguageCodeFromLabel("日语 （视频语言）")).toBe("ja");
    expect(resolveLanguageCodeFromLabel("Chinese (Simplified)")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromLabel("Chinese (Traditional)")).toBe(
      "zh-Hant",
    );
    expect(resolveLanguageCodeFromLabel("中文（简体）")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromLabel("中文（繁体）")).toBe("zh-Hant");
    expect(resolveLanguageCodeFromLabel("Hindi")).toBe("hi");
    expect(resolveLanguageCodeFromLabel("印地语")).toBe("hi");
    expect(resolveLanguageCodeFromLabel("Italian")).toBe("it");
    expect(resolveLanguageCodeFromLabel("意大利语")).toBe("it");
    expect(resolveLanguageCodeFromLabel("Russian")).toBe("ru");
    expect(resolveLanguageCodeFromLabel("俄语 （视频语言）")).toBe("ru");
    expect(resolveLanguageCodeFromLabel("Vietnamese")).toBe("vi");
    expect(resolveLanguageCodeFromLabel("越南语")).toBe("vi");
    expect(resolveLanguageCodeFromLabel("Thai")).toBe("th");
    expect(resolveLanguageCodeFromLabel("泰语")).toBe("th");
    expect(resolveLanguageCodeFromLabel("Turkish")).toBe("tr");
    expect(resolveLanguageCodeFromLabel("土耳其语")).toBe("tr");
    expect(resolveLanguageCodeFromLabel("Indonesian")).toBe("id");
    expect(resolveLanguageCodeFromLabel("印度尼西亚语")).toBe("id");
    expect(resolveLanguageCodeFromLabel("印尼语")).toBe("id");
    expect(resolveLanguageCodeFromLabel("Polish")).toBe("pl");
    expect(resolveLanguageCodeFromLabel("波兰语")).toBe("pl");
    expect(resolveLanguageCodeFromLabel("Dutch")).toBe("nl");
    expect(resolveLanguageCodeFromLabel("荷兰语")).toBe("nl");
    expect(resolveLanguageCodeFromLabel("Portuguese (Brazil)")).toBe("pt-BR");
    expect(resolveLanguageCodeFromLabel("葡萄牙语（巴西）")).toBe("pt-BR");
    // Trailing status chrome on row labels still resolves.
    expect(resolveLanguageCodeFromLabel("意大利语 草稿")).toBe("it");
    // Bare 中文/Chinese is ambiguous across the 7 picker variants — no guess.
    expect(resolveLanguageCodeFromLabel("中文")).toBeNull();
    expect(resolveLanguageCodeFromLabel("Chinese")).toBeNull();
    // zh-Hant finally has a labelAliasesForLanguage branch.
    expect(
      labelAliasesForLanguage({ code: "zh-Hant", label: "中文（繁体）" }),
    ).toContain("中文（繁体）");
    expect(
      labelAliasesForLanguage({ code: "zh-Hant", label: "中文（繁体）" }),
    ).toContain("Chinese (Traditional)");
  });

  it("audit#15: an unmapped row no longer appears once the label is mapped", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        // Live zh label that used to be unmapped → whole list UNPARSEABLE.
        existingLanguages: [{ code: "it", label: "意大利语" }],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        labelOnlyExistingRows: true,
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"), {
      timeout: 10_000,
    });
    const snapshot = runner.getSnapshot(id).result;
    const summary = snapshot?.summary ?? "";
    expect(summary).not.toMatch(/UNPARSEABLE/i);
    expect(summary).toMatch(/日本語\(ja\) SUCCESS/);
    expect(
      snapshot?.warnings?.some(
        (w) => w.code === "SUBTITLE_LANGUAGE_UNPARSEABLE",
      ) ?? false,
    ).toBe(false);
    expect(fixture.clickCounts.publish).toBe(1);
  }, 15_000);
});
