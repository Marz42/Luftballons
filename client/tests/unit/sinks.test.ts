import { describe, expect, it } from "vitest";
import type { Collection } from "../../src/schemas/collection.js";
import type { ChannelBasicData } from "../../src/schemas/channel-basic.js";
import { CsvSink, escapeCsvCell } from "../../src/sinks/csv-sink.js";
import { JsonSink } from "../../src/sinks/json-sink.js";
import { LUFTBALLONS_SCHEMA_VERSION } from "../../src/services/collection-service.js";

function channelCollection(
  overrides: Partial<Collection<ChannelBasicData>> = {},
): Collection<ChannelBasicData> {
  return {
    collectionId: "col-csv-1",
    installationId: "inst-csv-1",
    collector: "youtube.channel.basic",
    collectorVersion: 1,
    schemaVersion: LUFTBALLONS_SCHEMA_VERSION,
    capturedAt: "2026-09-07T12:00:00.000Z",
    status: "COMPLETE",
    data: {
      channel: { channelName: "测试频道", channelId: "UC_cn" },
      period: { label: "近28天", start: "2026-08-01", end: "2026-08-28" },
      summary: { views: 999, subscriberDelta: -3 },
      recentVideos: [
        {
          videoId: "v1",
          title: "中文标题",
          views: 10,
          capturedAt: "2026-09-07T12:00:00.000Z",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          title: "=1+1",
          views: 0,
          capturedAt: "2026-09-07T12:00:00.000Z",
        },
        {
          title: "+cmd|'/C calc'!A0",
          views: 1,
          capturedAt: "2026-09-07T12:00:00.000Z",
        },
        {
          title: "@SUM(A1:A2)",
          views: 2,
          capturedAt: "2026-09-07T12:00:00.000Z",
        },
        {
          title: "-2+3",
          views: 3,
          capturedAt: "2026-09-07T12:00:00.000Z",
        },
        {
          title: "\tTABBED",
          views: 4,
          capturedAt: "2026-09-07T12:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("CSV injection escape", () => {
  it("prefixes = + - @ and tab with a single quote", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+x")).toBe("'+x");
    expect(escapeCsvCell("-x")).toBe("'-x");
    expect(escapeCsvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(escapeCsvCell("\tTAB")).toBe("'\tTAB");
    expect(escapeCsvCell("safe")).toBe("safe");
    expect(escapeCsvCell("中文")).toBe("中文");
  });
});

describe("CsvSink (P1-T2)", () => {
  it("exports UTF-8 BOM CSV with correct headers, fields, and injection defense", async () => {
    const downloaded: Array<{ filename: string; content: string }> = [];
    const sink = new CsvSink({
      download: (filename, content) => {
        downloaded.push({ filename, content });
      },
      now: () => new Date("2026-09-07T15:00:00.000Z"),
    });

    expect(await sink.available()).toBe(true);
    expect(sink.capability).toBe("LOCAL_EXPORT");

    const result = await sink.write(channelCollection());
    expect(result.status).toBe("OK");
    expect(downloaded).toHaveLength(2);

    const summary = downloaded.find((f) =>
      f.filename.includes("channel_summary"),
    );
    const videos = downloaded.find((f) =>
      f.filename.includes("recent_videos"),
    );
    expect(summary?.filename).toBe("Luftballons_channel_summary_20260907.csv");
    expect(videos?.filename).toBe("Luftballons_recent_videos_20260907.csv");

    expect(summary?.content.charCodeAt(0)).toBe(0xfeff);
    expect(summary?.content).toContain("collectionId");
    expect(summary?.content).toContain("installationId");
    expect(summary?.content).toContain("capturedAt");
    expect(summary?.content).toContain("collector");
    expect(summary?.content).toContain("测试频道");
    expect(summary?.content).toContain("近28天");
    expect(summary?.content).toContain("col-csv-1");
    expect(summary?.content).toContain("inst-csv-1");

    expect(videos?.content.charCodeAt(0)).toBe(0xfeff);
    expect(videos?.content).toContain("中文标题");
    expect(videos?.content).toContain("'=1+1");
    expect(videos?.content).toContain("'+cmd|'/C calc'!A0");
    expect(videos?.content).toContain("'@SUM(A1:A2)");
    expect(videos?.content).toContain("'-2+3");
    expect(videos?.content).toContain("'\tTABBED");
  });

  it("fails available()-gated write when Blob is missing", async () => {
    const originalBlob = globalThis.Blob;
    // @ts-expect-error intentional
    globalThis.Blob = undefined;
    try {
      const sink = new CsvSink({ download: () => {} });
      expect(await sink.available()).toBe(false);
      const result = await sink.write(channelCollection());
      expect(result.status).toBe("FAILED");
    } finally {
      globalThis.Blob = originalBlob;
    }
  });
});

describe("JsonSink (P1-T3)", () => {
  it("roundtrips full Collection envelope with deep-equal data", async () => {
    const downloaded: Array<{ filename: string; content: string }> = [];
    const sink = new JsonSink({
      download: (filename, content) => {
        downloaded.push({ filename, content });
      },
      now: () => new Date("2026-09-07T15:00:00.000Z"),
    });

    const original = channelCollection();
    const result = await sink.write(original);
    expect(result.status).toBe("OK");
    expect(downloaded).toHaveLength(1);

    const parsed = JSON.parse(downloaded[0]!.content) as Collection<ChannelBasicData>;
    expect(parsed.schemaVersion).toBe(original.schemaVersion);
    expect(parsed.collectionId).toBe(original.collectionId);
    expect(parsed.installationId).toBe(original.installationId);
    expect(parsed.collector).toBe(original.collector);
    expect(parsed.capturedAt).toBe(original.capturedAt);
    expect(parsed.status).toBe(original.status);
    expect(parsed.data).toEqual(original.data);
  });
});
