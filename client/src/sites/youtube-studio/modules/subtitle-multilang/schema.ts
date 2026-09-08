/**
 * youtube.subtitle.multilang schema (SPEC §34–§37, Phase 4).
 * Language codes are BCP-47-ish Studio tags (en / ja / ko / es …).
 */

export interface SubtitleLanguage {
  /** Studio language code, e.g. en, ja, ko, es */
  code: string;
  /** Display label for UI / Human Gate */
  label: string;
}

/** MVP preset list — user may also supply one custom entry via UI. */
export const PRESET_SUBTITLE_LANGUAGES: readonly SubtitleLanguage[] = [
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "zh-Hans", label: "中文（简体）" },
] as const;

export type LanguageOutcomeStatus =
  | "SUCCESS"
  | "EXISTS"
  | "SKIPPED"
  | "FAILED"
  | "CANCELLED"
  | "UNCONFIRMED";

/**
 * Observed row state in the subtitle languages list (assumption fixture).
 * EXISTS is treated like PUBLISHED for skip logic (already on video).
 */
export type SubtitleRowState =
  | "EXISTS"
  | "PENDING_PUBLISH"
  | "PUBLISHED";

export interface SubtitleLanguageRow {
  code: string;
  label?: string;
  state: SubtitleRowState;
}

export interface LanguageOutcome {
  code: string;
  label: string;
  status: LanguageOutcomeStatus;
  detail?: string;
}

export interface SubtitleMultilangInput {
  /** Languages the user asked to ensure on the current video. */
  targetLanguages: SubtitleLanguage[];
}

export interface SubtitleMultilangSummary {
  videoId: string;
  outcomes: LanguageOutcome[];
  /**
   * True only when Human Gate approved AND publish postcondition observed
   * PUBLISHED for pending languages. Never true for UNCONFIRMED.
   */
  published: boolean;
  /** True when Human Gate returned REJECTED (no WRITE_COMMIT). */
  humanRejected: boolean;
}

/**
 * Verified label→code map for rows lacking data-language-code.
 * Live 2026-09-08: Studio may show `英语 （视频语言）` — strip parentheticals
 * in resolveLanguageCodeFromLabel before lookup. Unknown bare labels → UNPARSEABLE.
 */
export const SUBTITLE_LABEL_TO_CODE: Readonly<Record<string, string>> = {
  English: "en",
  英语: "en",
  日本語: "ja",
  /** zh-Hans Studio picker / table label (2026-09-08). */
  日语: "ja",
  한국어: "ko",
  Español: "es",
  Français: "fr",
  /** zh-Hans Studio picker label (2026-09-08 screenshots). */
  法语: "fr",
  Deutsch: "de",
  Português: "pt",
  "中文（简体）": "zh-Hans",
  "中文（繁体）": "zh-Hant",
};

export type LanguageListParseKind = "EMPTY" | "READABLE" | "UNPARSEABLE";

export interface LanguageListParseResult {
  kind: LanguageListParseKind;
  rows: SubtitleLanguageRow[];
  /** Present when kind === UNPARSEABLE */
  detail?: string;
}

/** Strip Studio parentheticals e.g. `英语 （视频语言）` → `英语`. */
export function normalizeSubtitleLanguageLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[（(][^）)]*[）)]\s*$/u, "")
    .trim();
}

export function resolveLanguageCodeFromLabel(label: string): string | null {
  const candidates = [label, normalizeSubtitleLanguageLabel(label)]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);

  for (const trimmed of candidates) {
    if (SUBTITLE_LABEL_TO_CODE[trimmed]) {
      return SUBTITLE_LABEL_TO_CODE[trimmed]!;
    }
    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(SUBTITLE_LABEL_TO_CODE)) {
      if (k.toLowerCase() === lower) {
        return v;
      }
    }
  }
  return null;
}

export function findPresetLanguage(code: string): SubtitleLanguage | undefined {
  const normalized = code.trim();
  return PRESET_SUBTITLE_LANGUAGES.find(
    (l) => l.code.toLowerCase() === normalized.toLowerCase(),
  );
}

export function resolveLanguage(code: string, label?: string): SubtitleLanguage {
  const preset = findPresetLanguage(code);
  if (preset) {
    return preset;
  }
  const trimmed = code.trim();
  return {
    code: trimmed,
    label: label?.trim() || trimmed,
  };
}

export function formatOutcomesSummary(outcomes: LanguageOutcome[]): string {
  return outcomes
    .map((o) => `${o.label}(${o.code}) ${o.status}`)
    .join("; ");
}
