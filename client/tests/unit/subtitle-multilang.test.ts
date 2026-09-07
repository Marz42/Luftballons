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

  it("detect: WRONG_PAGE unless current page is VIDEO_DETAILS", async () => {
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
    }, { timeout: 5_000 });
    expect(fixture.clickCounts.publish).toBe(1);
    const result = runner.getSnapshot(taskId).result;
    expect(result?.summary).toMatch(/PENDING_PUBLISH|FAILED/i);
    expect(result?.summary).not.toMatch(/published=true/);
  });

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
        (w) => w.code === "PUBLISH_FAILED",
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
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "ja")).toHaveLength(
      1,
    );

    fixture.setPage("VIDEO_DETAILS");
    const runner2 = makeRunner(mod, createAutoApproveGate());
    const task2 = await runner2.start("youtube.subtitle.multilang");
    await vi.waitFor(() => {
      expect(runner2.getState(task2)).toBe("COMPLETED");
    });
    expect(fixture.clickCounts.option).toBe(1); // not re-added
    expect(fixture.clickCounts.publish).toBe(1);
    expect(fixture.getSubtitleLanguageCodes().filter((c) => c === "ja")).toHaveLength(
      1,
    );
    expect(runner2.getSnapshot(task2).result?.summary).toMatch(/published=true/);
  });

  it("P1-3e: list unreadable after publish → PARTIAL + PUBLISH_UNCONFIRMED", async () => {
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
      expect(runner.getState(taskId)).toBe("PARTIAL");
    }, { timeout: 5_000 });
    const result = runner.getSnapshot(taskId).result;
    expect(
      result?.warnings?.some((w) => w.code === "PUBLISH_UNCONFIRMED"),
    ).toBe(true);
    expect(result?.summary).toMatch(/UNCONFIRMED|unconfirmed/i);
    expect(result?.summary).not.toMatch(/published=true/);
  });

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
});
