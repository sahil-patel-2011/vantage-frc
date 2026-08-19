import {
  MAX_SLUG,
  type KnowledgeSearchHit,
} from "./types";

/** Stable URL slug from a title; empty → "page". */
export function slugifyTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG);
  return base || "page";
}

/** Snippet around the first query match for search results. */
export function snippetFrom(text: string, query: string, radius = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const q = query.trim().toLowerCase();
  const lower = clean.toLowerCase();
  const idx = q ? lower.indexOf(q) : -1;
  if (idx < 0) return clean.slice(0, radius * 2) + (clean.length > radius * 2 ? "…" : "");
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + q.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

export function knowledgeHitHref(
  source: KnowledgeSearchHit["source"],
  id: string,
  orgId: string,
  slug?: string,
): string {
  const q = `orgId=${encodeURIComponent(orgId)}`;
  if (source === "wiki") {
    const page = slug ? `&page=${encodeURIComponent(slug)}` : `&pageId=${encodeURIComponent(id)}`;
    return `/team?tab=knowledge&${q}${page}`;
  }
  if (source === "decision") return `/decisions?${q}&id=${encodeURIComponent(id)}`;
  return `/reviews?${q}&id=${encodeURIComponent(id)}`;
}
