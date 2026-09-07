/**
 * Display-metric parse layer (IMPLEMENTATION §42).
 * Returns MetricValue; ChannelBasicData still stores plain numbers (schema v1).
 *
 * Documented rounding rules (UI abbreviation → number):
 * - Suffix K / k → × 1_000
 * - Suffix M / m → × 1_000_000
 * - Suffix B / b → × 1_000_000_000
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

const ABBREV =
  /^([+-]?)(\d+(?:\.\d+)?)\s*([KMB])\b/i;

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
    const suffix = abbrev[3]!.toUpperCase();
    if (!Number.isFinite(num)) {
      return undefined;
    }
    const mult =
      suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : 1_000_000_000;
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
