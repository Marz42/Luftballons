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
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ar", label: "العربية" },
  { code: "ko", label: "한국어" },
  { code: "zh-Hans", label: "中文（简体）" },
  { code: "pt", label: "Português" },
] as const;

/**
 * Default panel checkboxes / module targets:
 * 德、日、法、英、西、阿拉伯、韩、中 (pt remains optional, unchecked).
 */
export const DEFAULT_TARGET_LANGUAGE_CODES: readonly string[] = [
  "de",
  "ja",
  "fr",
  "en",
  "es",
  "ar",
  "ko",
  "zh-Hans",
] as const;

export function defaultTargetLanguages(): SubtitleLanguage[] {
  const wanted = new Set(
    DEFAULT_TARGET_LANGUAGE_CODES.map((c) => c.toLowerCase()),
  );
  return PRESET_SUBTITLE_LANGUAGES.filter((l) =>
    wanted.has(l.code.toLowerCase()),
  ).map((l) => ({ ...l }));
}

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
 *
 * zh-Hans Studio picker/table uses Chinese names (日语 / 韩语 / …); native
 * and English labels remain for fixtures and other locales.
 */
export const SUBTITLE_LABEL_TO_CODE: Readonly<Record<string, string>> = {
  English: "en",
  英语: "en",
  日本語: "ja",
  /** zh-Hans Studio picker / table label (2026-09-08). */
  日语: "ja",
  한국어: "ko",
  /** zh-Hans Studio — WAIT_TIMEOUT on ko without this (2026-09-08). */
  韩语: "ko",
  Korean: "ko",
  Español: "es",
  西班牙语: "es",
  Spanish: "es",
  Français: "fr",
  /** zh-Hans Studio picker label (2026-09-08 screenshots). */
  法语: "fr",
  French: "fr",
  Deutsch: "de",
  德语: "de",
  German: "de",
  العربية: "ar",
  阿拉伯语: "ar",
  Arabic: "ar",
  Português: "pt",
  葡萄牙语: "pt",
  Portuguese: "pt",
  "中文（简体）": "zh-Hans",
  "中文（繁体）": "zh-Hant",
};

/** Preferred picker search / display aliases per code (zh-Hans first). */
export function labelAliasesForLanguage(lang: SubtitleLanguage): string[] {
  const aliases = new Set<string>([
    lang.label.replace(/\s+/g, " ").trim(),
    lang.code,
  ]);
  switch (lang.code.toLowerCase()) {
    case "en":
      aliases.add("英语");
      aliases.add("English");
      break;
    case "ja":
      aliases.add("日语");
      aliases.add("日本語");
      break;
    case "ko":
      aliases.add("韩语");
      aliases.add("한국어");
      aliases.add("Korean");
      break;
    case "es":
      aliases.add("西班牙语");
      aliases.add("Español");
      aliases.add("Spanish");
      break;
    case "fr":
      aliases.add("法语");
      aliases.add("Français");
      aliases.add("French");
      break;
    case "de":
      aliases.add("德语");
      aliases.add("Deutsch");
      aliases.add("German");
      break;
    case "ar":
      aliases.add("阿拉伯语");
      aliases.add("العربية");
      aliases.add("Arabic");
      break;
    case "pt":
      aliases.add("葡萄牙语");
      aliases.add("Português");
      aliases.add("Portuguese");
      break;
    case "zh-hans":
      aliases.add("中文（简体）");
      break;
    default:
      break;
  }
  return [...aliases].filter(Boolean);
}

/** zh-Hans Studio filter box query (live catalogs are Chinese-labeled). */
export function pickerFilterQueryForLanguage(lang: SubtitleLanguage): string {
  const code = lang.code.toLowerCase();
  const zh: Record<string, string> = {
    en: "英语",
    ja: "日语",
    ko: "韩语",
    es: "西班牙语",
    fr: "法语",
    de: "德语",
    ar: "阿拉伯语",
    pt: "葡萄牙语",
    "zh-hans": "中文（简体）",
  };
  return zh[code] ?? (lang.label.replace(/\s+/g, " ").trim() || lang.code);
}

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

  // Table rows often append status chrome after the language name
  // (e.g. "韩语 草稿"). Prefer longest known label as prefix.
  const keys = Object.keys(SUBTITLE_LABEL_TO_CODE).sort(
    (a, b) => b.length - a.length,
  );
  for (const trimmed of candidates) {
    const lower = trimmed.toLowerCase();
    for (const k of keys) {
      const kl = k.toLowerCase();
      if (
        trimmed.startsWith(k) &&
        (trimmed.length === k.length ||
          /[\s（(]/.test(trimmed.charAt(k.length)))
      ) {
        return SUBTITLE_LABEL_TO_CODE[k]!;
      }
      if (
        lower.startsWith(kl) &&
        (lower.length === kl.length ||
          /[\s（(]/.test(lower.charAt(kl.length)))
      ) {
        return SUBTITLE_LABEL_TO_CODE[k]!;
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
