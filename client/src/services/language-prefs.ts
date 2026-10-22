/**
 * Local preference: the languages of the LAST successful subtitle publish.
 * Local-first — GM key/value storage (in-memory fallback in tests), never
 * networked. Used to pre-check the panel language selection next run.
 */
import { getTokenStorage, type SecretStorage } from "./network-settings.js";
import type { SubtitleLanguage } from "../sites/youtube-studio/modules/subtitle-multilang/schema.js";

const KEY = "luftballons.lastPublishedLanguages";

function readStore(): SecretStorage | null {
  try {
    return getTokenStorage();
  } catch {
    return null;
  }
}

/** Codes+labels of the last successful publish; null when never saved. */
export function loadLastPublishedLanguages(): SubtitleLanguage[] | null {
  const store = readStore();
  if (!store) {
    return null;
  }
  try {
    const raw = store.get(KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const langs: SubtitleLanguage[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { code?: unknown }).code === "string" &&
        (entry as { code: string }).code.trim().length > 0
      ) {
        const code = (entry as { code: string }).code.trim();
        const labelRaw = (entry as { label?: unknown }).label;
        langs.push({
          code,
          label: typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : code,
        });
      }
    }
    return langs.length > 0 ? langs : null;
  } catch {
    return null;
  }
}

/** Persist the published set (only called for runs with ≥1 SUCCESS). */
export function saveLastPublishedLanguages(langs: SubtitleLanguage[]): void {
  const store = readStore();
  if (!store) {
    return;
  }
  const seen = new Set<string>();
  const clean = langs
    .filter((l) => l.code.trim().length > 0)
    .filter((l) => {
      const key = l.code.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((l) => ({ code: l.code.trim(), label: l.label.trim() || l.code.trim() }));
  if (clean.length === 0) {
    return;
  }
  try {
    store.set(KEY, JSON.stringify(clean));
  } catch {
    // Preference-only: never fail a task over storage.
  }
}
