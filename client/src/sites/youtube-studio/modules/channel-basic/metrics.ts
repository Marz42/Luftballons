/**
 * Display-metric parse layer (IMPLEMENTATION §42).
 * Returns MetricValue; ChannelBasicData still stores plain numbers (schema v1).
 *
 * Documented rounding rules (UI abbreviation → number):
 * - Suffix K / k → × 1_000
 * - Suffix M / m → × 1_000_000
 * - Suffix B / b → × 1_000_000_000
 * - Suffix 万 → × 10_000, 亿 → × 100_000_000, 万亿 → × 1_000_000_000_000
 *   (review R4: Chinese multipliers were previously dropped, 1.2万 → 1.2)
 * - Value = round(parsedFloat * multiplier) toward nearest integer
 *   (12.3K → 12300; 1.2M → 1200000). Marked DISPLAY_ROUNDED.
 * - Plain integers / comma-grouped integers (12,345) → EXACT.
 * - Unparseable / placeholder ("—", "–", "-", "N/A", empty) → undefined
 *   (never invent 0).
 */

export type MetricPrecision = "EXACT" | "DISPLAY_ROUNDED";

export interface MetricValue {
  value: number;
  precision: MetricPrecision;
}

const PLACEHOLDER = /^(?:—|–|−|-|n\/?a|null|none|\.{3}|…)?$/i;

/**
 * Studio "no value" markers that are NOT parse failures (H5).
 * A leading dash glyph (—/–/−/-) marks an absent value, optionally followed by
 * chrome like「无法比较」; bare placeholders and empty strings count too.
 */
export function isDisplayPlaceholder(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0 || PLACEHOLDER.test(text)) return true;
  return /^[—–−-]/.test(text);
}

/**
 * Display abbreviations. review R4 (2026-10-22): Chinese multipliers 万/亿/万亿
 * are first-class suffixes — `1.2万` is 12000, never 1.2.
 */
const ABBREV =
  /^([+-]?)(\d+(?:\.\d+)?)(?:\s*([KMB])\b|\s*(万亿|亿|万))/i;

const ABBREV_MULTIPLIER: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
  万: 10_000,
  亿: 100_000_000,
  万亿: 1_000_000_000_000,
};

const EXACT_INT =
  /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.0+)?$/;

const EXACT_DECIMAL = /^([+-]?)(\d+\.\d+)$/;

function applySign(sign: string, n: number): number {
  return sign === "-" ? -n : n;
}

/**
 * Parse a visible Studio metric string into MetricValue.
 * Does not guess: unknown shapes return undefined.
 */
export function parseDisplayMetric(raw: string | null | undefined): MetricValue | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0 || PLACEHOLDER.test(text)) {
    return undefined;
  }

  const abbrev = text.match(ABBREV);
  if (abbrev) {
    const sign = abbrev[1] ?? "";
    const num = Number.parseFloat(abbrev[2]!);
    const suffix = (abbrev[3] ?? abbrev[4] ?? "").toUpperCase();
    if (!Number.isFinite(num)) {
      return undefined;
    }
    const mult = ABBREV_MULTIPLIER[suffix];
    if (mult === undefined) {
      return undefined;
    }
    const value = applySign(sign, Math.round(num * mult));
    return { value, precision: "DISPLAY_ROUNDED" };
  }

  const exactInt = text.match(EXACT_INT);
  if (exactInt) {
    const sign = exactInt[1] ?? "";
    const digits = exactInt[2]!.replace(/,/g, "");
    const value = applySign(sign, Number.parseInt(digits, 10));
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return { value, precision: "EXACT" };
  }

  const exactDec = text.match(EXACT_DECIMAL);
  if (exactDec) {
    const sign = exactDec[1] ?? "";
    const value = applySign(sign, Number.parseFloat(exactDec[2]!));
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return { value, precision: "EXACT" };
  }

  return undefined;
}
