/**
 * Content surface adapter — layout family A (Content Hub) vs classic table.
 * Evidence: docs/layout-family-a.md §1 (hub shelves + lockup cards).
 *
 * Family A: `ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]`
 * with `horizontal-shelf-view-model` shelves (视频 / 短视频 / 播放列表) of
 * `yt-lockup-view-model` cards. No table, no pagination, no sort header.
 * Family B: classic `ytcp-video-section-content#video-list` table (existing path).
 */

import { isActiveElement } from "../../selectors.js";

export type ContentFamily = "A_HUB" | "B_TABLE" | "UNKNOWN";

export const HUB_FEED_SELECTOR =
  'ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]';
export const CLASSIC_LIST_SELECTOR = "ytcp-video-section-content#video-list";
const CONTENT_ROW_SELECTOR =
  '[data-luftballons-video-row], ytcp-video-row, tr[data-video-id]';

/** One rendered video card / table row reduced to the dataset fields. */
export interface ParsedContentVideo {
  videoId?: string;
  title: string;
  /** Raw display text (family A/B date cell) — never invented. */
  publishedAt?: string;
  /** Display-parsed views; undefined when unreadable (never 0-as-unknown). */
  views?: number;
  viewsRounded?: boolean;
  /** Set when the row itself is unusable (no title / views unreadable). */
  skipReason?: string;
}

export function detectContentFamily(root: ParentNode = document): ContentFamily {
  if (root.querySelector(HUB_FEED_SELECTOR)) return "A_HUB";
  if (root.querySelector(CLASSIC_LIST_SELECTOR)) return "B_TABLE";
  return "UNKNOWN";
}

function textOf(el: Element | null): string | null {
  if (!el) return null;
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

/** Host class `content-id-<ID>` is stable on family A cards (video=11 chars, PL…=playlist). */
function cardContentId(card: Element): string | null {
  for (const el of [card, ...Array.from(card.querySelectorAll("*"))]) {
    const cls = el.getAttribute("class") ?? "";
    const m = cls.match(/(?:^|\s)content-id-([A-Za-z0-9_-]{3,})(?:\s|$)/);
    if (m) return m[1]!;
  }
  return null;
}

function videoIdFromLink(card: Element): string | null {
  const links = Array.from(card.querySelectorAll('a[href*="/video/"]'));
  for (const a of links) {
    const href = a.getAttribute("href") ?? "";
    let pathname = href;
    try {
      pathname = new URL(href, "https://studio.youtube.com").pathname;
    } catch {
      /* keep raw */
    }
    const m = pathname.match(/\/video\/([^/?#]+)\//i);
    if (m?.[1]) return m[1];
  }
  return null;
}

const ZH_DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;

/**
 * Views from icon aria-label (calibrated family A: `16次观看` / `无人观看`;
 * en: `16 views` / `No views`). Falls back to the first numeric span of the
 * metrics row. Returns undefined when nothing trustworthy is readable.
 */
function readCardViews(card: Element): { value?: number; rounded: boolean } {
  for (const el of Array.from(card.querySelectorAll("[aria-label]"))) {
    const label = (el.getAttribute("aria-label") ?? "").trim();
    if (/^(No views|无人观看|没有观看)$/i.test(label)) {
      return { value: 0, rounded: false };
    }
    const m =
      label.match(/^([\d,]+(?:\.\d+)?)\s*次观看$/) ??
      label.match(/^([\d,]+(?:\.\d+)?)\s*views?$/i);
    if (m) {
      const n = Number(m[1]!.replace(/,/g, ""));
      if (Number.isFinite(n)) return { value: n, rounded: false };
    }
  }
  // Fallback: metric row whose icon is a views icon → first numeric span.
  const rows = Array.from(
    card.querySelectorAll(".ytContentMetadataViewModelMetadataRow"),
  );
  for (const row of rows) {
    const hasViewsIcon = Array.from(row.querySelectorAll("[aria-label]")).some(
      (e) => /次观看|views?/i.test(e.getAttribute("aria-label") ?? ""),
    );
    if (!hasViewsIcon) continue;
    const spans = Array.from(row.querySelectorAll("span"))
      .map(textOf)
      .filter((t): t is string => t !== null);
    for (const s of spans) {
      const m = s.match(/^([\d,]+(?:\.\d+)?)([KMB万亿])?$/i);
      if (!m) continue;
      const n = Number(m[1]!.replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      if (m[2]) return { value: n, rounded: true }; // abbreviation without multiplier knowledge
      return { value: n, rounded: false };
    }
  }
  return { rounded: false };
}

/** First date-looking metadata row text (strip 「•」visibility marker). */
function readCardDate(card: Element): string | null {
  const rows = Array.from(
    card.querySelectorAll(".ytContentMetadataViewModelMetadataRow"),
  );
  for (const row of rows) {
    const t = textOf(row);
    if (!t) continue;
    const cleaned = t.replace(/^[•·]\s*/, "");
    if (ZH_DATE.test(cleaned)) {
      return cleaned;
    }
    // Non-zh locale date shapes: keep raw display when it has digits + separators.
    if (/^[\d/\-–—.\s年月日]+$/.test(cleaned) && /\d/.test(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Parse family A video cards from the 视频 shelf only (not 短视频 / 播放列表).
 * Playlists (`content-id-PL…`) are excluded by id shape.
 *
 * Real anatomy (docs/layout-family-a.md §1.1): each shelf is
 * `horizontal-shelf-view-model` → sibling `div.ytwHorizontalShelfViewModelHeader`
 * (h2 title 「视频」/「短视频」/「播放列表」) + `div.ytwHorizontalShelfViewModelOuterContainer`
 * → … → `div.ytwHorizontalShelfViewModelItems` → cards. The header is therefore
 * OUTSIDE the items container — look it up in the scope or its parent.
 */
export function parseFamilyAVideos(root: ParentNode): ParsedContentVideo[] {
  const feed = root.querySelector(HUB_FEED_SELECTOR);
  if (!feed) return [];

  const out: ParsedContentVideo[] = [];
  const scopes: Element[] = [];
  const seen = new Set<Element>();
  const processedCards = new Set<Element>();
  for (const el of Array.from(feed.querySelectorAll("*"))) {
    const isShelfHost =
      el.tagName.toLowerCase() === "horizontal-shelf-view-model" ||
      el.classList.contains("ytwHorizontalShelfViewModelOuterContainer");
    if (!isShelfHost || seen.has(el)) continue;
    seen.add(el);
    scopes.push(el);
  }
  // If shelf wrappers are absent (fixture), fall back to the feed itself.
  if (scopes.length === 0) scopes.push(feed);

  for (const scope of scopes) {
    const headerEl =
      scope.querySelector(
        "h2.ytShelfHeaderLayoutTitle, yt-section-header-view-model, .ytwHorizontalShelfViewModelHeader",
      ) ??
      scope.parentElement?.querySelector(
        "h2.ytShelfHeaderLayoutTitle, yt-section-header-view-model, .ytwHorizontalShelfViewModelHeader",
      ) ??
      null;
    const header = textOf(headerEl);
    // Family A doc: titles 「视频」「短视频」「播放列表」(header may concatenate
    // the trailing 「查看全部」 action text). 「短视频」must NOT pass /^视频/.
    if (header && !/^视频(?!短视频)/.test(header.replace(/\s+/g, ""))) continue;

    const cards: Element[] = [];
    for (const card of Array.from(scope.querySelectorAll("yt-lockup-view-model"))) {
      if (!processedCards.has(card)) {
        processedCards.add(card);
        cards.push(card);
      }
    }

    for (const card of cards) {
      if (!isActiveElement(card)) continue;
      const contentId = cardContentId(card);
      if (contentId && /^PL/i.test(contentId)) continue; // playlist card

      const title =
        textOf(card.querySelector("a.ytLockupMetadataViewModelTitle")) ??
        textOf(card.querySelector("h3"));
      const videoId = videoIdFromLink(card) ?? (contentId && !/^PL/i.test(contentId) ? contentId : null);
      const views = readCardViews(card);
      const publishedAt = readCardDate(card) ?? undefined;

      if (!title) {
        out.push({
          ...(videoId ? { videoId } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          title: "",
          skipReason: "card without title",
        });
        continue;
      }
      out.push({
        title,
        ...(videoId ? { videoId } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        ...(views.value !== undefined ? { views: views.value } : {}),
        ...(views.rounded ? { viewsRounded: true } : {}),
        ...(views.value === undefined ? { skipReason: "views unreadable" } : {}),
      });
    }
  }
  return out;
}

/**
 * Family A readiness: hub rendered with at least one card, or an explicitly
 * empty shelf scope. Never demands every card be parseable (H4).
 */
function selfOrDescendant(root: ParentNode, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return root.querySelector(selector);
}

export function familyAContentReady(root: ParentNode): boolean {
  const feed = selfOrDescendant(root, HUB_FEED_SELECTOR);
  if (!feed || !isActiveElement(feed)) return false;
  return feed.querySelectorAll("yt-lockup-view-model").length > 0;
}

/** Classic-table readiness: rows exist (H4 relaxed — cells may still stream). */
export function classicRowsReady(root: ParentNode): boolean {
  const list = selfOrDescendant(root, CLASSIC_LIST_SELECTOR);
  if (!list || !isActiveElement(list)) return false;
  const rows = Array.from(
    list.querySelectorAll('[data-luftballons-video-row], ytcp-video-row, tr[data-video-id]'),
  ).filter(isActiveElement);
  return rows.length > 0;
}

/** Family-aware content readiness (hub cards OR classic rows present). */
export function contentReady(candidate: Element): boolean {
  return (
    familyAContentReady(candidate) ||
    classicRowsReady(candidate) ||
    candidate.querySelectorAll("yt-lockup-view-model").length > 0 ||
    Array.from(candidate.querySelectorAll(CONTENT_ROW_SELECTOR)).filter(isActiveElement).length > 0
  );
}
