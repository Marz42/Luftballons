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
 * 德、日、法、英、西、阿拉伯、韩 (pt / zh-Hans remain optional, unchecked).
 * 2026-10-22 product decision: a Chinese channel does not need zh-Hans as a
 * DEFAULT translate target — it stays available as an opt-in checkbox.
 */
export const DEFAULT_TARGET_LANGUAGE_CODES: readonly string[] = [
  "de",
  "ja",
  "fr",
  "en",
  "es",
  "ar",
  "ko",
] as const;

export function defaultTargetLanguages(): SubtitleLanguage[] {
  const wanted = new Set(
    DEFAULT_TARGET_LANGUAGE_CODES.map((c) => c.toLowerCase()),
  );
  return PRESET_SUBTITLE_LANGUAGES.filter((l) =>
    wanted.has(l.code.toLowerCase()),
  ).map((l) => ({ ...l }));
}

/**
 * True when captions for this language are already published (skip).
 */
export function isCaptionsPublishedState(state: SubtitleRowState): boolean {
  return state === "CAPTIONS_PUBLISHED" || state === "PUBLISHED";
}

/**
 * Row exists but captions still need entry / translate / publish resume.
 */
export function needsCaptionsResume(state: SubtitleRowState): boolean {
  return (
    state === "CAPTIONS_MISSING" ||
    state === "CAPTIONS_DRAFT" ||
    state === "PENDING_PUBLISH"
  );
}

export type LanguageOutcomeStatus =
  | "SUCCESS"
  | "EXISTS"
  | "SKIPPED"
  | "FAILED"
  | "CANCELLED"
  | "UNCONFIRMED";

/**
 * Observed captions state for a language row (Layout A: captions cell only).
 * Metadata cell「已发布」must never be treated as captions published.
 *
 * Fixture shortcuts:
 * - data-subtitle-state=PUBLISHED → CAPTIONS_PUBLISHED
 * - data-subtitle-state=PENDING_PUBLISH → CAPTIONS_MISSING (needs captions entry)
 */
export type SubtitleRowState =
  | "CAPTIONS_MISSING"
  | "CAPTIONS_DRAFT"
  | "CAPTIONS_PUBLISHED"
  | "UNPARSEABLE"
  /** @deprecated fixture alias — mapped to CAPTIONS_MISSING */
  | "PENDING_PUBLISH"
  /** @deprecated fixture alias — mapped to CAPTIONS_PUBLISHED */
  | "PUBLISHED"
  /** @deprecated never skip on live unmarked rows */
  | "EXISTS";

export type CaptionsTranslatePhase =
  | "TRANSLATING"
  | "READY"
  | "ERROR"
  | "UNKNOWN";

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
 *
 * audit #15 (2026-10-21): unmapped row labels make the WHOLE list UNPARSEABLE
 * and fail the task — so cover the common Studio catalog (en + zh names).
 * Bare「中文」/`Chinese` is intentionally NOT mapped: the picker carries seven
 * zh variants (zh / zh-Hans / zh-Hant / zh-CN / zh-TW / zh-HK / zh-SG,
 * docs/layout-family-a.md §4) and guessing one would violate fail-closed.
 */
export const SUBTITLE_LABEL_TO_CODE: Readonly<Record<string, string>> = {
  English: "en",
  英语: "en",
  日本語: "ja",
  Japanese: "ja",
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
  "Chinese (Simplified)": "zh-Hans",
  "中文(简体)": "zh-Hans",
  "中文（繁体）": "zh-Hant",
  "Chinese (Traditional)": "zh-Hant",
  "中文(繁体)": "zh-Hant",
  Hindi: "hi",
  印地语: "hi",
  Italian: "it",
  Italiano: "it",
  意大利语: "it",
  Russian: "ru",
  Русский: "ru",
  俄语: "ru",
  Vietnamese: "vi",
  越南语: "vi",
  Thai: "th",
  ไทย: "th",
  泰语: "th",
  Turkish: "tr",
  Türkçe: "tr",
  土耳其语: "tr",
  Indonesian: "id",
  印度尼西亚语: "id",
  印尼语: "id",
  Polish: "pl",
  Polski: "pl",
  波兰语: "pl",
  Dutch: "nl",
  Nederlands: "nl",
  荷兰语: "nl",
  /** Studio catalogs distinguish pt-BR from generic pt. */
  "Portuguese (Brazil)": "pt-BR",
  "Português (Brasil)": "pt-BR",
  "葡萄牙语（巴西）": "pt-BR",
  "葡萄牙语(巴西)": "pt-BR",
  /**
   * review R2 (2026-10-22): regional variants keep their region identity —
   * 英语（美国）must NOT collapse into en (Studio treats the rows as distinct).
   */
  "英语（美国）": "en-US",
  "英语(美国)": "en-US",
  "English (US)": "en-US",
  "English (United States)": "en-US",
  "英语（英国）": "en-GB",
  "英语(英国)": "en-GB",
  "English (UK)": "en-GB",
  "English (United Kingdom)": "en-GB",
};

/**
 * True when two Studio language codes identify the same captions language for
 * matching purposes: equal (case-insensitive) or base↔variant (en ↔ en-US,
 * pt ↔ pt-BR, zh ↔ zh-Hans). Distinct variants (zh-Hans vs zh-Hant,
 * en-US vs en-GB) never match.
 *
 * review R2: row parsing preserves region identity (pt-BR, en-US), so every
 * code comparison in the workflow must accept base↔variant — otherwise a
 * 英语（美国）row would stop matching an `en` target.
 */
export function languageCodeMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}

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
    case "en-us":
      aliases.add("英语（美国）");
      aliases.add("English (US)");
      break;
    case "en-gb":
      aliases.add("英语（英国）");
      aliases.add("English (UK)");
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
    case "pt-br":
      aliases.add("葡萄牙语（巴西）");
      aliases.add("Português (Brasil)");
      aliases.add("Portuguese (Brazil)");
      break;
    case "zh-hans":
      aliases.add("中文（简体）");
      aliases.add("Chinese (Simplified)");
      break;
    case "zh-hant":
      aliases.add("中文（繁体）");
      aliases.add("Chinese (Traditional)");
      break;
    case "hi":
      aliases.add("印地语");
      aliases.add("Hindi");
      break;
    case "it":
      aliases.add("意大利语");
      aliases.add("Italian");
      aliases.add("Italiano");
      break;
    case "ru":
      aliases.add("俄语");
      aliases.add("Russian");
      aliases.add("Русский");
      break;
    case "vi":
      aliases.add("越南语");
      aliases.add("Vietnamese");
      break;
    case "th":
      aliases.add("泰语");
      aliases.add("Thai");
      aliases.add("ไทย");
      break;
    case "tr":
      aliases.add("土耳其语");
      aliases.add("Turkish");
      aliases.add("Türkçe");
      break;
    case "id":
      aliases.add("印度尼西亚语");
      aliases.add("印尼语");
      aliases.add("Indonesian");
      break;
    case "pl":
      aliases.add("波兰语");
      aliases.add("Polish");
      aliases.add("Polski");
      break;
    case "nl":
      aliases.add("荷兰语");
      aliases.add("Dutch");
      aliases.add("Nederlands");
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
    "pt-br": "葡萄牙语（巴西）",
    "zh-hans": "中文（简体）",
    "zh-hant": "中文（繁体）",
    hi: "印地语",
    it: "意大利语",
    ru: "俄语",
    vi: "越南语",
    th: "泰语",
    tr: "土耳其语",
    id: "印度尼西亚语",
    pl: "波兰语",
    nl: "荷兰语",
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

/**
 * Studio STATUS annotations appended to a language name — never identity.
 * review R2 (2026-10-22): only these are strippable. Identity qualifiers
 * （简体）（繁体）（巴西）（美国）… carry script/region identity and must survive.
 */
const STATUS_ANNOTATION =
  /\s*[（(](?:视频语言|video language|草稿|draft|已发布|published|pending)[）)]\s*$/iu;

/**
 * Strip Studio status chrome e.g. `英语 （视频语言）` → `英语`,
 * `韩语（草稿）` → `韩语`. Identity parens are never touched (review R2 —
 * the old code stripped ANY trailing parenthetical and collapsed
 * 中文（简体）→ 中文 / 葡萄牙语（巴西）→ 葡萄牙语).
 */
export function normalizeSubtitleLanguageLabel(label: string): string {
  let text = label.replace(/\s+/g, " ").trim();
  for (;;) {
    const next = text.replace(STATUS_ANNOTATION, "").trim();
    if (next === text) {
      return text;
    }
    text = next;
  }
}

function lookupLabelExact(label: string): string | null {
  const hit = SUBTITLE_LABEL_TO_CODE[label];
  if (hit) return hit;
  const lower = label.toLowerCase();
  for (const [k, v] of Object.entries(SUBTITLE_LABEL_TO_CODE)) {
    if (k.toLowerCase() === lower) {
      return v;
    }
  }
  return null;
}

export function resolveLanguageCodeFromLabel(label: string): string | null {
  const primary = label.replace(/\s+/g, " ").trim();
  if (!primary) {
    return null;
  }
  const exact = lookupLabelExact(primary);
  if (exact) {
    return exact;
  }
  // Strip trailing STATUS chrome (视频语言 / 草稿 / …) and retry — identity
  // qualifiers stay part of the label (中文（简体）, 葡萄牙语（巴西）, 英语（美国）).
  const stripped = normalizeSubtitleLanguageLabel(primary);
  if (stripped !== primary) {
    const afterStrip = lookupLabelExact(stripped);
    if (afterStrip) {
      return afterStrip;
    }
  }
  // Table rows may append status TEXT after the name ("韩语 草稿",
  // "韩语 已发布2026年10月21日"). Longest known label as prefix, whitespace
  // boundary ONLY — a following （…） is identity (简体/繁体/地区), so
  // 英语（美国）must not collapse into en (review R2).
  const keys = Object.keys(SUBTITLE_LABEL_TO_CODE).sort(
    (a, b) => b.length - a.length,
  );
  for (const k of keys) {
    const kl = k.toLowerCase();
    const lower = primary.toLowerCase();
    const isPrefix =
      primary.startsWith(k) || (lower.startsWith(kl) && kl.length === k.length);
    if (!isPrefix) {
      continue;
    }
    const boundary = primary.charAt(k.length);
    if (primary.length === k.length || /\s/.test(boundary)) {
      return SUBTITLE_LABEL_TO_CODE[k]!;
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
