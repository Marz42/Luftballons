import { describe, expect, it } from "vitest";
import { parseDisplayMetric } from "../../src/sites/youtube-studio/modules/channel-basic/metrics.js";

describe("parseDisplayMetric (§42)", () => {
  it("parses K/M/B abbreviations as DISPLAY_ROUNDED", () => {
    expect(parseDisplayMetric("12.3K")).toEqual({
      value: 12_300,
      precision: "DISPLAY_ROUNDED",
    });
    expect(parseDisplayMetric("1.2M")).toEqual({
      value: 1_200_000,
      precision: "DISPLAY_ROUNDED",
    });
    expect(parseDisplayMetric("4.5K")).toEqual({
      value: 4_500,
      precision: "DISPLAY_ROUNDED",
    });
    expect(parseDisplayMetric("+1.2K")).toEqual({
      value: 1_200,
      precision: "DISPLAY_ROUNDED",
    });
    expect(parseDisplayMetric("-1.2K")).toEqual({
      value: -1_200,
      precision: "DISPLAY_ROUNDED",
    });
  });

  it("parses exact integers and comma groups as EXACT", () => {
    expect(parseDisplayMetric("120")).toEqual({
      value: 120,
      precision: "EXACT",
    });
    expect(parseDisplayMetric("+120")).toEqual({
      value: 120,
      precision: "EXACT",
    });
    expect(parseDisplayMetric("12,345")).toEqual({
      value: 12_345,
      precision: "EXACT",
    });
  });

  it("returns undefined for placeholders (no invented zero)", () => {
    expect(parseDisplayMetric("—")).toBeUndefined();
    expect(parseDisplayMetric("–")).toBeUndefined();
    expect(parseDisplayMetric("-")).toBeUndefined();
    expect(parseDisplayMetric("N/A")).toBeUndefined();
    expect(parseDisplayMetric("")).toBeUndefined();
    expect(parseDisplayMetric(null)).toBeUndefined();
  });
});
