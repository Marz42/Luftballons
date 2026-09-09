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

describe("youtube.subtitle.multilang (FT-011 / P4-T1…T5)", () => {
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

  it("detect: WRONG_PAGE unless current page is VIDEO_DETAILS or SUBTITLES", async () => {
    fixture = mountStudioFixture({ page: "DASHBOARD", layout: "2026_V1" });
    const mod = createFixtureSubtitleModule(fixture);
    const avail = await mod.detect({
      hostname: "studio.youtube.com",
      href: fixture.href,
      logger: silentLogger(),
    });
    expect(avail.available).toBe(false);
    expect(avail.reason).toBe("WRONG_PAGE");
    expect(avail.metadata?.page).toBe("DASHBOARD");
  });

  it("detect: available on SUBTITLES (/translations)", async () => {
    fixture = mountStudioFixture({ page: "SUBTITLES", layout: "2026_V1" });
    const mod = createFixtureSubtitleModule(fixture);
    const avail = await mod.detect({
      hostname: "studio.youtube.com",
      href: fixture.href,
      logger: silentLogger(),
    });
    expect(avail.available).toBe(true);
  });

  it("P4-T1 Existing Language: en SKIPPED, ja added; no duplicate en", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        pickerLanguages: [
          { code: "en", label: "English" },
          { code: "ja", label: "日本語" },
          { code: "ko", label: "한국어" },
        ],
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });

    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) SKIPPED/);
    expect(summary).toMatch(/日本語\(ja\) SUCCESS/);
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "en")).toHaveLength(
      1,
    );
    expect(fixture.getSubtitleLanguageCodes()).toContain("ja");
    expect(fixture.clickCounts.publish).toBe(1);
  });

  it("P4-T2 Human Gate: WAITING_HUMAN until resolved; no progress without confirm", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const gate = createDeferredHumanGate();
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, gate);

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("WAITING_HUMAN");
    });
    expect(fixture.clickCounts.publish).toBe(0);
    expect(gate.lastAction?.capability).toBe("WRITE_COMMIT");

    // Still hanging
    await new Promise((r) => setTimeout(r, 30));
    expect(runner.getState(taskId)).toBe("WAITING_HUMAN");
    expect(fixture.clickCounts.publish).toBe(0);

    gate.resolve("APPROVED");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    expect(fixture.clickCounts.publish).toBe(1);
  });

  it("P4-T3 Reject: cancel at gate → no final commit", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ko", label: "한국어" }],
      },
    });
    let publishAttempts = 0;
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ko", label: "한국어" }],
      onPublishAttempt: () => {
        publishAttempts += 1;
      },
    });
    const runner = makeRunner(mod, createAutoRejectGate());

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(["COMPLETED", "CANCELLED"]).toContain(runner.getState(taskId));
    });

    expect(publishAttempts).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    const result = runner.getSnapshot(taskId).result;
    expect(result?.warnings?.some((w) => w.code === "HUMAN_GATE_REJECTED")).toBe(
      true,
    );
    expect(result?.summary).toMatch(/REJECTED|CANCELLED/i);
  });

  it("P4-T4 UI Mismatch: missing languages list → FAILED, no speculative clicks", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        omitLanguagesList: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });

    expect(fixture.clickCounts.addLanguage).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    expect(fixture.clickCounts.option).toBe(0);
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(/UI mismatch/i);
  });

  it("P4-T5 Re-run: second run mostly EXISTS/SKIPPED, no duplicate state", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        pickerLanguages: [
          { code: "en", label: "English" },
          { code: "ja", label: "日本語" },
        ],
      },
    });
    const langs = [
      { code: "en", label: "English" },
      { code: "ja", label: "日本語" },
    ];
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: langs,
    });
    const runner1 = makeRunner(mod, createAutoApproveGate());
    const task1 = await runner1.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner1.getState(task1)).toBe("COMPLETED");
    });

    const codesAfterFirst = fixture.getSubtitleLanguageCodes();
    expect(codesAfterFirst).toEqual(expect.arrayContaining(["en", "ja"]));
    expect(codesAfterFirst.filter((c) => c === "ja")).toHaveLength(1);

    // Return to video details and re-run
    fixture.setPage("VIDEO_DETAILS");
    const runner2 = makeRunner(mod, createAutoApproveGate());
    const task2 = await runner2.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner2.getState(task2)).toBe("COMPLETED");
    });

    const summary2 = runner2.getSnapshot(task2).result?.summary ?? "";
    expect(summary2).toMatch(/EXISTS|SKIPPED/);
    expect(summary2).not.toMatch(/SUCCESS/);
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "en")).toHaveLength(
      1,
    );
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "ja")).toHaveLength(
      1,
    );
    // Second run should not publish again (nothing to add)
    expect(fixture.clickCounts.publish).toBe(1);
  });

  it("single-language failure does not sink other languages", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "en", label: "English" }],
        // ja missing from picker → add fails for ja only
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(["PARTIAL", "COMPLETED", "FAILED"]).toContain(runner.getState(taskId));
    }, { timeout: 5_000 });
    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) SUCCESS/);
    expect(summary).toMatch(/日本語\(ja\) FAILED/);
  });

  it("P1-1a: Human Gate wait switches video → publish recheck fails, no publish click", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const gate = createDeferredHumanGate();
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, gate);

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("WAITING_HUMAN");
    });
    expect(fixture.clickCounts.publish).toBe(0);

    // Switch to another video while Human Gate is open (DOM still video A editor).
    fixture.setHref(
      "https://studio.youtube.com/video/vid_other_999/translations",
    );

    gate.resolve("APPROVED");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });

    expect(fixture.clickCounts.publish).toBe(0);
    const result = runner.getSnapshot(taskId).result;
    expect(result?.warnings?.some((w) =>
      w.code === "VIDEO_SWITCHED" || w.code === "NAV_BINDING_FAILED",
    )).toBe(true);
  });

  it("P1-1b: channel-only subtitles nav → recheck/nav fails, no editor entry", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      omitVideoSubtitlesTab: true,
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());

    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });

    expect(fixture.clickCounts.addLanguage).toBe(0);
    expect(fixture.clickCounts.option).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    const result = runner.getSnapshot(taskId).result;
    expect(
      result?.warnings?.some((w) =>
        [
          "SUBTITLES_NAV_FAILED",
          "VIDEO_SWITCHED",
          "NAV_BINDING_FAILED",
        ].includes(w.code),
      ),
    ).toBe(true);
  });

  it("P1-2a: hidden global Publish twin must not be clicked", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        injectHiddenGlobalPublish: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    // Real editor publish clicked once; hidden twin must stay at 0.
    expect(fixture.clickCounts.publish).toBe(1);
    expect(fixture.clickCounts.hiddenPublish).toBe(0);
  });

  it("P1-2b: picker not open → option lookup fails, stop without publish", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        addLanguageNoOp: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(["FAILED", "PARTIAL"]).toContain(runner.getState(taskId));
    }, { timeout: 5_000 });
    expect(fixture.clickCounts.option).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    const result = runner.getSnapshot(taskId).result;
    expect(
      result?.warnings?.some((w) =>
        ["LANGUAGE_ADD_FAILED", "UI_MISMATCH", "SUBTITLE_UI_MISMATCH", "WAIT_TIMEOUT"].includes(
          w.code,
        ),
      ),
    ).toBe(true);
  });

  it("P1-2c: existing language row must not be treated as picker option", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        injectPickerExistingRowDecoy: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    });
    expect(fixture.clickCounts.option).toBe(1);
    expect(fixture.clickCounts.pickerDecoy).toBe(0);
  });

  it("P1-3a: publish noop (无效) → FAILED, published=false", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        publishMode: "noop",
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    }, { timeout: 15_000 });
    expect(fixture.clickCounts.publish).toBe(1);
    const result = runner.getSnapshot(taskId).result;
    expect(result?.summary).toMatch(/PENDING_PUBLISH|FAILED|PUBLISHED state not observed/i);
    expect(result?.summary).not.toMatch(/published=true/);
  }, 20_000);

  it("P1-3b: publish fail surface → FAILED, published=false", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ko", label: "한국어" }],
        publishMode: "fail",
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ko", label: "한국어" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });
    expect(
      runner.getSnapshot(taskId).result?.warnings?.some(
        (w) => w.code === "PUBLISH_FAILED" || w.code === "UI_MISMATCH",
      ),
    ).toBe(true);
    expect(runner.getSnapshot(taskId).result?.summary).not.toMatch(
      /published=true/,
    );
  });

  it("P1-3c: publish delay → wait for PUBLISHED then SUCCESS", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        publishMode: "delay",
        publishDelayMs: 50,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 5_000 });
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(/published=true/);
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(/SUCCESS/);
  });

  it("P1-3d: REJECTED then re-run → pending not stacked, second publish works", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
      },
    });
    const langs = [{ code: "ja", label: "日本語" }];
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: langs,
    });

    const runner1 = makeRunner(mod, createAutoRejectGate());
    const task1 = await runner1.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(["COMPLETED", "CANCELLED"]).toContain(runner1.getState(task1));
    });
    expect(fixture.clickCounts.publish).toBe(0);
    // Gate-first WRITE path: reject before picker — no pending language row.
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "ja")).toHaveLength(
      0,
    );

    fixture.setPage("VIDEO_DETAILS");
    const runner2 = makeRunner(mod, createAutoApproveGate());
    const task2 = await runner2.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner2.getState(task2)).toBe("COMPLETED");
    });
    expect(fixture.clickCounts.option).toBe(1);
    expect(fixture.clickCounts.publish).toBe(1);
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "ja")).toHaveLength(
      1,
    );
    expect(runner2.getSnapshot(task2).result?.summary).toMatch(/published=true/);
  });

  it("P1-3e: list unreadable after publish → FAILED (cannot verify PUBLISHED)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "es", label: "Español" }],
        omitLanguagesListAfterPublish: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "es", label: "Español" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    }, { timeout: 12_000 });
    const result = runner.getSnapshot(taskId).result;
    expect(result?.summary).not.toMatch(/published=true/);
  }, 15_000);

  it("P2-1a: add menu async delay → wait then succeed", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        pickerOpenDelayMs: 60,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 5_000 });
    expect(fixture.clickCounts.option).toBe(1);
    expect(fixture.clickCounts.publish).toBe(1);
  });

  it("P2-1b: publish async delay → wait for PUBLISHED then SUCCESS", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        publishMode: "delay",
        publishDelayMs: 80,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 5_000 });
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(/published=true/);
  });

  it("waits briefly for auto-translate cues before publish (blank-subtitle race)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "de", label: "Deutsch" }],
        autoTranslateContentDelayMs: 250,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "de", label: "Deutsch" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 8_000 });
    expect(fixture.clickCounts.publish).toBe(1);
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(
      /Deutsch\(de\) SUCCESS/,
    );
    expect(runner.getSnapshot(taskId).result?.summary).toMatch(/published=true/);
  });

  it("P2-1c: menu never appears → timeout stop, no option click", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [
          { code: "ja", label: "日本語" },
          { code: "ko", label: "한국어" },
        ],
        addLanguageNoOp: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "ja", label: "日本語" },
        { code: "ko", label: "한국어" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(["FAILED", "PARTIAL"]).toContain(runner.getState(taskId));
    }, { timeout: 5_000 });
    expect(fixture.clickCounts.option).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/日本語\(ja\) FAILED/);
    // Must not continue to second language after wait timeout
    expect(summary).toMatch(/한국어\(ko\) CANCELLED/);
    expect(
      runner.getSnapshot(taskId).result?.warnings?.some(
        (w) => w.code === "WAIT_TIMEOUT",
      ),
    ).toBe(true);
  });

  it("P2-2a: Chinese label 英语 maps to en — no duplicate add", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "英语" }],
        pickerLanguages: [
          { code: "en", label: "English" },
          { code: "ja", label: "日本語" },
        ],
        labelOnlyExistingRows: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 8_000 });
    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) (SKIPPED|EXISTS)/);
    expect(summary).toMatch(/日本語\(ja\) SUCCESS/);
    expect(fixture.clickCounts.option).toBe(1); // only ja
  }, 10_000);

  it("P2-2a-live: 英语 （视频语言） maps to en (2026-09-08 evidence)", async () => {
    const { resolveLanguageCodeFromLabel } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/schema.js"
    );
    expect(resolveLanguageCodeFromLabel("英语 （视频语言）")).toBe("en");
    expect(resolveLanguageCodeFromLabel("英语 (视频语言)")).toBe("en");
    expect(resolveLanguageCodeFromLabel("English (Video language)")).toBe("en");
    expect(resolveLanguageCodeFromLabel("日语")).toBe("ja");
    expect(resolveLanguageCodeFromLabel("韩语")).toBe("ko");
    expect(resolveLanguageCodeFromLabel("韩语 草稿")).toBe("ko");
    expect(resolveLanguageCodeFromLabel("西班牙语")).toBe("es");
    expect(resolveLanguageCodeFromLabel("德语")).toBe("de");
    expect(resolveLanguageCodeFromLabel("葡萄牙语")).toBe("pt");
    expect(resolveLanguageCodeFromLabel("阿拉伯语")).toBe("ar");
  });

  it("zh-Hans picker labels: add 韩语 after en/ja exist (row wait)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [
          { code: "en", label: "英语" },
          { code: "ja", label: "日语" },
        ],
        pickerLanguages: [
          { code: "en", label: "英语" },
          { code: "ja", label: "日语" },
          { code: "ko", label: "韩语" },
        ],
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
        { code: "ko", label: "한국어" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 8_000 });
    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) (SKIPPED|EXISTS)/);
    expect(summary).toMatch(/日本語\(ja\) (SKIPPED|EXISTS)/);
    expect(summary).toMatch(/한국어\(ko\) SUCCESS/);
    expect(fixture.clickCounts.option).toBe(1);
  }, 10_000);

  it("P2-2b: unknown row structure → UNPARSEABLE stop, no add", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        pickerLanguages: [{ code: "ja", label: "日本語" }],
        injectUnparseableRow: true,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("FAILED");
    });
    expect(fixture.clickCounts.addLanguage).toBe(0);
    expect(
      runner.getSnapshot(taskId).result?.warnings?.some(
        (w) => w.code === "SUBTITLE_LANGUAGE_UNPARSEABLE",
      ),
    ).toBe(true);
  });

  it("P2-2c: rows load after empty container → wait then parse (not treat as empty)", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      layout: "2026_V1",
      subtitles: {
        existingLanguages: [{ code: "en", label: "English" }],
        pickerLanguages: [
          { code: "en", label: "English" },
          { code: "ja", label: "日本語" },
        ],
        languagesListRowsDelayMs: 800,
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "en", label: "English" },
        { code: "ja", label: "日本語" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const taskId = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner.getState(taskId)).toBe("COMPLETED");
    }, { timeout: 5_000 });
    const summary = runner.getSnapshot(taskId).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) (SKIPPED|EXISTS)/);
    expect(summary).toMatch(/日本語\(ja\) SUCCESS/);
    expect(fixture.clickCounts.option).toBe(1);
  });

  it("does not infer empty from a timeout", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", subtitles: {
      existingLanguages: [], omitEmptyState: true,
    }});
    const gate = createDeferredHumanGate();
    const runner = makeRunner(createFixtureSubtitleModule(fixture), gate);
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), { timeout: 4000 });
    expect(fixture.clickCounts.addLanguage).toBe(0);
    expect(gate.lastAction).toBeNull();
    expect(fixture.clickCounts.publish).toBe(0);
  });

  it("stops after gate when a later language is missing from picker", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", subtitles: {
      existingLanguages: [], pickerLanguages: [{ code: "en", label: "English" }],
    }});
    const runner = makeRunner(createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "en", label: "English" }, { code: "ja", label: "日本語" }],
    }), createAutoApproveGate());
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(["FAILED", "PARTIAL"]).toContain(runner.getState(id)), { timeout: 8_000 });
    expect(fixture.clickCounts.publish).toBe(1); // en published
    const summary = runner.getSnapshot(id).result?.summary ?? "";
    expect(summary).toMatch(/English\(en\) SUCCESS/);
    expect(summary).toMatch(/日本語\(ja\) FAILED/);
  });

  it("rejects unknown layout after approval", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", subtitles: {
      existingLanguages: [], pickerLanguages: [{ code: "ja", label: "日本語" }],
    }});
    const gate = createDeferredHumanGate();
    const runner = makeRunner(createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    }), gate);
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("WAITING_HUMAN"));
    document.querySelector("ytcp-navigation-drawer")!.remove();
    gate.resolve("APPROVED");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"));
    expect(fixture.clickCounts.publish).toBe(0);
  });

  it("rechecks video after the picker wait before selecting", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", subtitles: {
      existingLanguages: [], pickerLanguages: [{ code: "ja", label: "日本語" }], pickerOpenDelayMs: 200,
    }});
    const runner = makeRunner(createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    }));
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(fixture!.clickCounts.addLanguage).toBe(1));
    fixture.setHref("https://studio.youtube.com/video/other_video/translations");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"));
    expect(fixture.clickCounts.option).toBe(0);
    expect(fixture.clickCounts.publish).toBe(0);
  });

  it("does not accept a picker option as an added row", async () => {
    fixture = mountStudioFixture({ page: "VIDEO_DETAILS", subtitles: {
      existingLanguages: [], pickerLanguages: [{ code: "ja", label: "日本語" }], pickerOpenDelayMs: 200,
    }});
    const gate = createDeferredHumanGate();
    const runner = makeRunner(createFixtureSubtitleModule(fixture, {
      initialLanguages: [{ code: "ja", label: "日本語" }],
    }), gate);
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("WAITING_HUMAN"));
    // Sabotage before approval so the post-gate picker click cannot add a row.
    const option = document.querySelector("[data-luftballons-subtitle-option]")!;
    const inert = option.cloneNode(true) as HTMLElement;
    option.replaceWith(inert);
    inert.addEventListener("click", () => {
      setTimeout(() => { (inert.parentElement as HTMLElement).hidden = true; }, 50);
    });
    gate.resolve("APPROVED");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), { timeout: 10_000 });
    expect(fixture.clickCounts.publish).toBe(0);
  }, 12_000);

  it("P1-live: captions cell 已发布 without data attrs → SKIPPED/EXISTS", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      subtitles: {
        existingLanguages: [
          {
            code: "ja",
            label: "日语",
            state: "PUBLISHED",
            omitDataStateAttrs: true,
            captionsStatus: "published",
            metadataPublished: true,
          },
        ],
        pickerLanguages: [{ code: "ja", label: "日语" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "ja", label: "日本語" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"));
    const summary = runner.getSnapshot(id).result?.summary ?? "";
    expect(summary).toMatch(/EXISTS|SKIPPED/);
    expect(fixture.clickCounts.publish).toBe(0);
  });

  it("P1-live: metadata 已发布 + captions – must not skip", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      subtitles: {
        existingLanguages: [
          {
            code: "fr",
            label: "法语",
            state: "PENDING_PUBLISH",
            omitDataStateAttrs: true,
            captionsStatus: "dash",
            metadataPublished: true,
          },
        ],
        pickerLanguages: [{ code: "fr", label: "法语" }],
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "fr", label: "Français" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"), {
      timeout: 10_000,
    });
    expect(fixture.clickCounts.publish).toBe(1);
    expect(runner.getSnapshot(id).result?.summary).toMatch(/Français\(fr\) SUCCESS/);
  }, 12_000);

  it("P1-live: translate delay beyond READY budget → zero publish clicks", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "de", label: "Deutsch" }],
        // Beyond CAPTIONS_READY_TIMEOUT + human ready-confirm recheck window.
        autoTranslateContentDelayMs: 25_000,
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "de", label: "Deutsch" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("FAILED"), {
      timeout: 35_000,
    });
    expect(fixture.clickCounts.publish).toBe(0);
    expect(runner.getSnapshot(id).result?.warnings?.some((w) => w.code === "WAIT_TIMEOUT")).toBe(
      true,
    );
  }, 40_000);

  it("P1-live: hidden leftover cues must not mark current language READY", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      subtitles: {
        existingLanguages: [],
        pickerLanguages: [{ code: "de", label: "Deutsch" }],
        leftoverReadyLanguageCode: "en",
        autoTranslateContentDelayMs: 200,
      },
    });
    const runner = makeRunner(
      createFixtureSubtitleModule(fixture, {
        initialLanguages: [{ code: "de", label: "Deutsch" }],
      }),
      createAutoApproveGate(),
    );
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"), {
      timeout: 10_000,
    });
    expect(fixture.clickCounts.publish).toBe(1);
  }, 12_000);

  it("P1-live: re-run resumes captions-missing then continues to next language", async () => {
    fixture = mountStudioFixture({
      page: "VIDEO_DETAILS",
      subtitles: {
        existingLanguages: [
          {
            code: "ja",
            label: "日语",
            state: "PENDING_PUBLISH",
            omitDataStateAttrs: true,
            captionsStatus: "dash",
            metadataPublished: false,
          },
        ],
        pickerLanguages: [
          { code: "ja", label: "日语" },
          { code: "ko", label: "韩语" },
        ],
      },
    });
    const mod = createFixtureSubtitleModule(fixture, {
      initialLanguages: [
        { code: "ja", label: "日本語" },
        { code: "ko", label: "한국어" },
      ],
    });
    const runner = makeRunner(mod, createAutoApproveGate());
    const id = await runner.start("youtube.subtitle.multilang");
    await vi.waitFor(() => expect(runner.getState(id)).toBe("COMPLETED"), {
      timeout: 15_000,
    });
    const summary = runner.getSnapshot(id).result?.summary ?? "";
    expect(summary).toMatch(/日本語\(ja\) SUCCESS/);
    expect(summary).toMatch(/한국어\(ko\) SUCCESS/);
    expect(fixture.clickCounts.publish).toBe(2);
  }, 20_000);

  it("P1-live: ytgn-video-translations-list host parses captions without failing whole list", async () => {
    // Live list host is often ytgn-video-translations-list (not HTMLTableElement).
    const list = document.createElement("ytgn-video-translations-list");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    list.setAttribute("aria-label", "翻译");
    const rowHost = document.createElement("ytgn-video-translation-row");
    const tr = document.createElement("tr");
    tr.id = "row-container";
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "日语";
    const captions = document.createElement("ytgn-video-translation-cell-captions");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = "已发布";
    captions.append(status);
    const meta = document.createElement("ytgn-video-translation-cell-metadata");
    const metaStatus = document.createElement("div");
    metaStatus.id = "status-info";
    metaStatus.textContent = "已发布";
    meta.append(metaStatus);
    tr.append(lang, captions, meta);
    rowHost.append(tr);
    list.append(rowHost);
    const editor = document.createElement("main");
    editor.setAttribute("data-luftballons-target", "subtitle.editor");
    editor.append(list);
    const page = document.createElement("main");
    page.setAttribute("data-page", "SUBTITLES");
    page.append(editor);
    document.body.replaceChildren(page);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        code: "ja",
        state: "CAPTIONS_PUBLISHED",
      }),
    ]);
  });

  it("P1-live: edit/delete alone is not published (no status text)", async () => {
    const list = document.createElement("ytgn-video-translations-list");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    list.setAttribute("aria-label", "翻译");
    const rowHost = document.createElement("ytgn-video-translation-row");
    const tr = document.createElement("tr");
    tr.id = "row-container";
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "日语";
    const captions = document.createElement("ytgn-video-translation-cell-captions");
    captions.className = "tablecell-captions";
    // Hover chrome only — must not skip as CAPTIONS_PUBLISHED.
    const edit = document.createElement("button");
    edit.setAttribute("aria-label", "编辑");
    const del = document.createElement("button");
    del.setAttribute("aria-label", "删除");
    captions.append(edit, del);
    const meta = document.createElement("ytgn-video-translation-cell-metadata");
    const metaStatus = document.createElement("div");
    metaStatus.id = "status-info";
    metaStatus.textContent = "已发布";
    meta.append(metaStatus);
    tr.append(lang, captions, meta);
    rowHost.append(tr);
    list.append(rowHost);
    document.body.replaceChildren(list);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows[0]).toMatchObject({
      code: "ja",
      state: "UNPARSEABLE",
    });
  });

  it("P1-live: draft text + edit is CAPTIONS_DRAFT not published", async () => {
    const list = document.createElement("ytgn-video-translations-list");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    const rowHost = document.createElement("ytgn-video-translation-row");
    const tr = document.createElement("tr");
    tr.id = "row-container";
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "法语";
    const captions = document.createElement("ytgn-video-translation-cell-captions");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = "草稿";
    const edit = document.createElement("button");
    edit.setAttribute("aria-label", "编辑");
    captions.append(status, edit);
    tr.append(lang, captions);
    rowHost.append(tr);
    list.append(rowHost);
    document.body.replaceChildren(list);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows[0]).toMatchObject({
      code: "fr",
      state: "CAPTIONS_DRAFT",
    });
  });

  it("P1-live: Unpublished / Not published must not match published parser", async () => {
    const list = document.createElement("ytgn-video-translations-list");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    const rowHost = document.createElement("ytgn-video-translation-row");
    const tr = document.createElement("tr");
    tr.id = "row-container";
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "English";
    const captions = document.createElement("ytgn-video-translation-cell-captions");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = "Not published";
    captions.append(status);
    tr.append(lang, captions);
    rowHost.append(tr);
    list.append(rowHost);
    document.body.replaceChildren(list);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows[0]?.state).not.toBe("CAPTIONS_PUBLISHED");
    expect(parsed.rows[0]?.state).toBe("UNPARSEABLE");
  });

  it("P1-live: zero-harness TRANSLATING + publish enabled is not READY", async () => {
    const editor = document.createElement("ytve-captions-editor");
    editor.textContent = "正在翻译字幕，请稍候";
    const publish = document.createElement("button");
    publish.setAttribute("aria-label", "发布");
    publish.setAttribute("role", "button");
    document.body.replaceChildren(editor, publish);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { classifyTranslatePhase } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const phase = await classifyTranslatePhase(createDomService(), {
      code: "de",
      label: "Deutsch",
    });
    expect(phase).toBe("TRANSLATING");
  });

  it("P1-live: zero-harness cue-text READY without data-luftballons captions attrs", async () => {
    const editor = document.createElement("ytve-timedtext-editor");
    const cue = document.createElement("div");
    cue.className = "cue-text";
    cue.textContent = "Hallo Welt aus echten Cues";
    editor.append(cue);
    const publish = document.createElement("button");
    publish.setAttribute("aria-label", "发布");
    publish.setAttribute("role", "button");
    document.body.replaceChildren(editor, publish);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { classifyTranslatePhase } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const phase = await classifyTranslatePhase(createDomService(), {
      code: "de",
      label: "Deutsch",
    });
    expect(phase).toBe("READY");
  });

  it("P1-live: zero-harness publish-enabled alone stays UNKNOWN (not READY)", async () => {
    const editor = document.createElement("ytve-captions-editor-options-panel");
    editor.textContent = "自动翻译";
    const publish = document.createElement("button");
    publish.setAttribute("aria-label", "发布");
    publish.setAttribute("role", "button");
    document.body.replaceChildren(editor, publish);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { classifyTranslatePhase } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const phase = await classifyTranslatePhase(createDomService(), {
      code: "ja",
      label: "日本語",
    });
    expect(phase).toBe("UNKNOWN");
  });

  it("P1-live: waitUntilCaptionsReady refuses publish-stable shortcut (zero harness)", async () => {
    const editor = document.createElement("ytve-captions-editor");
    editor.textContent = "正在翻译";
    const publish = document.createElement("button");
    publish.setAttribute("aria-label", "发布");
    publish.setAttribute("role", "button");
    document.body.replaceChildren(editor, publish);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { waitUntilCaptionsReady } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const ac = new AbortController();
    await expect(
      waitUntilCaptionsReady(
        createDomService(),
        { code: "de", label: "Deutsch" },
        ac.signal,
        2_500,
      ),
    ).rejects.toThrow(/Captions not READY/);
  }, 8_000);

  it("P1-live: empty captions cell without add → UNPARSEABLE", async () => {
    const list = document.createElement("ytgn-video-translations-list");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    const rowHost = document.createElement("ytgn-video-translation-row");
    const tr = document.createElement("tr");
    tr.id = "row-container";
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "韩语";
    const captions = document.createElement("ytgn-video-translation-cell-captions");
    captions.className = "tablecell-captions";
    // Empty cell — no #status-info, no #captions-add.
    tr.append(lang, captions);
    rowHost.append(tr);
    list.append(rowHost);
    document.body.replaceChildren(list);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { parseLanguageList } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const parsed = await parseLanguageList(createDomService());
    expect(parsed.kind).toBe("READABLE");
    if (parsed.kind !== "READABLE") {
      return;
    }
    expect(parsed.rows[0]).toMatchObject({
      code: "ko",
      state: "UNPARSEABLE",
    });
  });

  it("P1-live: publish verify requires editor exit (published row alone insufficient)", async () => {
    const list = document.createElement("div");
    list.setAttribute("data-luftballons-target", "subtitle.languages.list");
    list.setAttribute("aria-label", "Subtitle languages");
    const row = document.createElement("div");
    row.setAttribute("data-luftballons-subtitle-row", "true");
    row.setAttribute("data-language-code", "de");
    const lang = document.createElement("span");
    lang.className = "language-text";
    lang.textContent = "Deutsch";
    const captions = document.createElement("div");
    captions.className = "tablecell-captions";
    captions.setAttribute("data-luftballons-captions-cell", "true");
    const status = document.createElement("div");
    status.id = "status-info";
    status.textContent = "已发布";
    captions.append(status);
    row.append(lang, captions);
    list.append(row);
    const editor = document.createElement("div");
    editor.setAttribute("data-luftballons-captions-editor", "true");
    editor.textContent = "still editing";
    document.body.replaceChildren(list, editor);

    const { createDomService } = await import("../../src/services/dom-service.js");
    const { waitForPublishedRow } = await import(
      "../../src/sites/youtube-studio/modules/subtitle-multilang/workflow.js"
    );
    const ac = new AbortController();
    const whileEditorOpen = await waitForPublishedRow(
      createDomService(),
      { code: "de", label: "Deutsch" },
      ac.signal,
      () => undefined,
      400,
    );
    expect(whileEditorOpen).toBe(false);

    editor.remove();
    const afterExit = await waitForPublishedRow(
      createDomService(),
      { code: "de", label: "Deutsch" },
      ac.signal,
      () => undefined,
      800,
    );
    expect(afterExit).toBe(true);
  }, 8_000);
});
