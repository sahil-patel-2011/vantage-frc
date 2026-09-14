/**
 * Documents on the connected Onshape account — names and last-edited times.
 *
 * Used by Learn CAD so a lead can see actual Explore Onshape progress.
 * No feature counts, no invented "percent complete".
 */

export type ExploreDocument = {
  id: string;
  name: string;
  modifiedAt: string | null;
  href: string;
};

export type ExploreProgressView =
  | { status: "ready"; documents: ExploreDocument[] }
  | { status: "setup"; message: string }
  | { status: "error"; message: string };

export function onshapeDocumentHref(id: string): string {
  return `https://cad.onshape.com/documents/${id}`;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseOnshapeDocumentList(body: unknown): ExploreDocument[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const documents: ExploreDocument[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled";
    documents.push({
      id,
      name,
      modifiedAt: asIso(row.modifiedAt) ?? asIso(row.createdAt),
      href: onshapeDocumentHref(id),
    });
  }
  return documents;
}
