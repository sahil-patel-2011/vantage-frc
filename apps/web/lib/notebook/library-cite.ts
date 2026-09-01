/**
 * Cite real team media as notebook evidence.
 *
 * A judged notebook page needs a resolved photo/video row — Media Kit URL,
 * Media Library item, or linked scout_media. Markdown `![alt](url)` in the
 * write-up is never a cite. Missing or pending rows resolve to nothing; we
 * never invent a photo.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  loadMediaEvidenceReferences,
  loadMediaLibraryEvidenceReferences,
  loadScoutMediaEvidenceReferences,
  type MediaEvidenceReference,
  type MediaEvidenceSource,
} from "../media/evidence-references";

export const LIBRARY_CITE_SOURCES = ["media_kit", "media_library", "scout_media"] as const;
export type LibraryCiteSource = (typeof LIBRARY_CITE_SOURCES)[number];

/** Kinds that count as visual evidence. Audio and `other` files do not. */
export const LIBRARY_CITE_KINDS = ["photo", "graphic", "logo", "video"] as const;
export type LibraryCiteKind = (typeof LIBRARY_CITE_KINDS)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LibraryCite = {
  source: LibraryCiteSource | "unknown";
  id: string;
};

function firstUuid(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toLowerCase();
    if (UUID_RE.test(normalized)) return normalized;
  }
  return null;
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function isLibraryCiteKind(kind: string): kind is LibraryCiteKind {
  return (LIBRARY_CITE_KINDS as readonly string[]).includes(kind);
}

export function isLibraryCiteSource(value: string): value is LibraryCiteSource {
  return (LIBRARY_CITE_SOURCES as readonly string[]).includes(value);
}

function sourceFromRecord(record: Record<string, unknown>): LibraryCiteSource | "unknown" {
  const explicit = firstString(record.source)?.toLowerCase();
  if (explicit === "media_library" || explicit === "library") return "media_library";
  if (explicit === "scout_media" || explicit === "pit" || explicit === "pit_scouting") {
    return "scout_media";
  }
  if (explicit === "media_kit" || explicit === "kit") return "media_kit";
  if (typeof record.libraryItemId === "string" || typeof record.mediaItemId === "string") {
    return "media_library";
  }
  if (typeof record.scoutMediaId === "string") return "scout_media";
  if (typeof record.mediaAssetId === "string") return "media_kit";
  return "unknown";
}

/**
 * IDs from a create/update payload. Accepts kit, library, and scout shapes.
 * Raw URLs and markdown are dropped — they are not row cites.
 */
export function parseLibraryCites(raw: unknown): LibraryCite[] {
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : [raw];
  const cites: LibraryCite[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row === "string") {
      const id = firstUuid(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cites.push({ source: "unknown", id });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = firstUuid(
      record.libraryItemId,
      record.mediaItemId,
      record.scoutMediaId,
      record.mediaAssetId,
      record.assetId,
    );
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cites.push({ source: sourceFromRecord(record), id });
  }
  return cites;
}

export function libraryCiteIds(cites: readonly LibraryCite[]): string[] {
  return cites.map((cite) => cite.id);
}

/**
 * A write-up that embeds `![photo](https://…)` is still text. Evidence is a
 * resolved library/kit/scout row, not markdown.
 */
export function citesFromMarkdownBody(_body: unknown): LibraryCite[] {
  return [];
}

export function isResolvedLibraryCiteEvidence(
  row: Pick<MediaEvidenceReference, "url" | "kind">,
): boolean {
  return Boolean(row.url.trim()) && isLibraryCiteKind(row.kind);
}

function stampSource(
  row: MediaEvidenceReference,
  source: MediaEvidenceSource,
): MediaEvidenceReference {
  return row.source ? row : { ...row, source };
}

/**
 * Resolve stored cite IDs against every honest source. Kit wins on id collision
 * so existing `asset:<uuid>` tags keep their Media Kit URL. Absent tables or
 * rows are omitted — never a DEMO photo.
 */
export async function resolveLibraryCites(
  client: PoolClient,
  input: { orgId: string; ids?: readonly string[]; limit?: number },
): Promise<MediaEvidenceReference[]> {
  const requested = input.ids;
  const ids = [
    ...new Set(
      (requested ?? [])
        .map((id) => id.trim().toLowerCase())
        .filter((id) => UUID_RE.test(id)),
    ),
  ];
  if (requested !== undefined && !ids.length) return [];
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const assetIds = ids.length ? ids : undefined;

  const [kit, library, scout] = await Promise.all([
    loadMediaEvidenceReferences(client, { orgId: input.orgId, assetIds, limit }),
    loadMediaLibraryEvidenceReferences(client, { orgId: input.orgId, assetIds, limit }),
    loadScoutMediaEvidenceReferences(client, { orgId: input.orgId, assetIds, limit }),
  ]);

  const merged = new Map<string, MediaEvidenceReference>();
  const ordered: MediaEvidenceReference[] = [
    ...kit.map((row) => stampSource(row, "media_kit")),
    ...library,
    ...scout,
  ];
  for (const row of ordered) {
    if (!isResolvedLibraryCiteEvidence(row)) continue;
    const key = row.assetId.toLowerCase();
    if (merged.has(key)) continue;
    if (assetIds && !assetIds.includes(key)) continue;
    merged.set(key, row);
  }

  if (ids.length) {
    return ids.flatMap((id) => {
      const row = merged.get(id);
      return row ? [row] : [];
    });
  }
  return [...merged.values()];
}
