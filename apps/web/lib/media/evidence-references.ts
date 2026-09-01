import type { PoolClient } from "@neondatabase/serverless";
import { scoutMediaFileUrl } from "../scouting/scout-media-preview";

/** Where a cited photo/video actually lives. Kit URLs are not the only source. */
export type MediaEvidenceSource = "media_kit" | "media_library" | "scout_media";

/** Shared output shape for every feature that cites team media. */
export type MediaEvidenceReference = {
  assetId: string;
  title: string;
  kind: string;
  url: string;
  description: string | null;
  source?: MediaEvidenceSource;
};

/** Native Media Library item. `url` is the authenticated item route — never a fabricated CDN. */
export type MediaLibraryEvidenceReference = MediaEvidenceReference & {
  source: "media_library";
};

/**
 * Pit-photo evidence. `entryId` is required — unlinked scout_media rows are not evidence.
 * `thumbUrl` is set only when the row actually has a thumb; we never point a chip at the 6MB original.
 */
export type ScoutMediaEvidenceReference = MediaEvidenceReference & {
  entryId: string;
  clientId: string;
  teamKey: string;
  eventKey: string;
  thumbUrl: string | null;
  source: "scout_media";
};

export async function loadMediaEvidenceReferences(
  client: PoolClient,
  input: { orgId: string; assetIds?: readonly string[]; limit?: number },
): Promise<MediaEvidenceReference[]> {
  const ids = [...new Set((input.assetIds ?? []).filter(Boolean))];
  const result = await client.query<{
    assetId: string;
    title: string;
    kind: string;
    url: string;
    description: string | null;
  }>(
    `SELECT id AS "assetId", title, kind, url, description
     FROM media_kit_assets
     WHERE org_id = $1::uuid
       AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
     ORDER BY created_at DESC
     LIMIT $3`,
    [input.orgId, ids.length ? ids : null, Math.min(200, Math.max(1, input.limit ?? 50))],
  );
  return result.rows;
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Parse IDs already stored in JSON evidence without creating another store. */
export function mediaAssetIdsFromEvidence(value: unknown): string[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      ids.push(row);
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const candidate =
      record.mediaAssetId ??
      record.assetId ??
      record.libraryItemId ??
      record.mediaItemId ??
      record.scoutMediaId;
    if (typeof candidate === "string" && candidate) ids.push(candidate);
  }
  return [...new Set(ids)];
}

/** Scout media refs already stored on an entry / evidence blob. Missing entryId is dropped. */
export function scoutMediaRefsFromEvidence(value: unknown): Array<{
  clientId: string;
  entryId: string;
}> {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  const refs: Array<{ clientId: string; entryId: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const clientId = firstString(record.clientId, record.scoutMediaId, record.mediaClientId);
    const entryId = firstString(record.entryId, record.entry_id);
    if (!clientId || !entryId) continue;
    const key = `${entryId}:${clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ clientId, entryId });
  }
  return refs;
}

export function entryIdsFromEvidence(value: unknown): string[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row === "string" && row.trim()) {
      ids.push(row.trim());
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const entryId = firstString(record.entryId, record.entry_id);
    if (entryId) ids.push(entryId);
  }
  return [...new Set(ids)];
}

type ScoutMediaEvidenceRow = {
  assetId: string;
  clientId: string;
  entryId: string | null;
  kind: string;
  teamKey: string;
  eventKey: string;
  hasThumb: boolean;
};

function titleForScoutMedia(row: Pick<ScoutMediaEvidenceRow, "kind" | "teamKey">): string {
  const kindLabel = row.kind === "video" ? "Pit video" : row.kind === "audio" ? "Pit audio" : "Pit photo";
  return row.teamKey ? `${kindLabel} · ${row.teamKey}` : kindLabel;
}

export function mediaLibraryItemUrl(orgId: string, itemId: string): string {
  const params = new URLSearchParams({ orgId });
  return `/api/media-library/items/${encodeURIComponent(itemId)}?${params.toString()}`;
}

/**
 * Ready Media Library photos/videos. Pending rows have no bytes — they are omitted,
 * never given a placeholder URL.
 */
export async function loadMediaLibraryEvidenceReferences(
  client: PoolClient,
  input: { orgId: string; assetIds?: readonly string[]; limit?: number },
): Promise<MediaLibraryEvidenceReference[]> {
  const ids = [...new Set((input.assetIds ?? []).filter(Boolean))];
  try {
    const result = await client.query<{
      assetId: string;
      title: string;
      kind: string;
      caption: string | null;
    }>(
      `SELECT id AS "assetId", title, kind, caption
       FROM media_items
       WHERE org_id = $1::uuid
         AND status = 'ready'
         AND kind IN ('photo', 'video')
         AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
       ORDER BY created_at DESC
       LIMIT $3`,
      [input.orgId, ids.length ? ids : null, Math.min(200, Math.max(1, input.limit ?? 50))],
    );
    const evidence: MediaLibraryEvidenceReference[] = [];
    for (const row of result.rows) {
      const assetId = row.assetId?.trim();
      const title = row.title?.trim();
      const kind = row.kind?.trim();
      if (!assetId || !title || !kind) continue;
      evidence.push({
        assetId,
        title,
        kind,
        url: mediaLibraryItemUrl(input.orgId, assetId),
        description: row.caption?.trim() || null,
        source: "media_library",
      });
    }
    return evidence;
  } catch {
    // Older deploys without media_items stay empty rather than inventing photos.
    return [];
  }
}

/**
 * Pit photos that are actually linked to an entry. Unlinked rows are omitted — they are not
 * evidence. thumbUrl is null unless the row reports a real thumb (no DEMO, no full-file stand-in).
 */
export async function loadScoutMediaEvidenceReferences(
  client: PoolClient,
  input: {
    orgId: string;
    entryIds?: readonly string[];
    assetIds?: readonly string[];
    eventKey?: string | null;
    teamKey?: string | null;
    limit?: number;
  },
): Promise<ScoutMediaEvidenceReference[]> {
  const entryIds = [...new Set((input.entryIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const assetIds = [...new Set((input.assetIds ?? []).map((id) => id.trim()).filter(Boolean))];
  try {
    const result = await client.query<ScoutMediaEvidenceRow>(
      `SELECT id::text AS "assetId",
              client_id AS "clientId",
              entry_id::text AS "entryId",
              kind::text AS kind,
              team_key AS "teamKey",
              event_key AS "eventKey",
              false AS "hasThumb"
       FROM scout_media
       WHERE org_id = $1::uuid
         AND entry_id IS NOT NULL
         AND status = 'uploaded'
         AND ($2::uuid[] IS NULL OR entry_id = ANY($2::uuid[]))
         AND ($3::text IS NULL OR event_key = $3)
         AND ($4::text IS NULL OR team_key = $4)
         AND ($6::uuid[] IS NULL OR id = ANY($6::uuid[]))
       ORDER BY created_at DESC
       LIMIT $5`,
      [
        input.orgId,
        entryIds.length ? entryIds : null,
        input.eventKey?.trim() || null,
        input.teamKey?.trim() || null,
        Math.min(200, Math.max(1, input.limit ?? 50)),
        assetIds.length ? assetIds : null,
      ],
    );
    const evidence: ScoutMediaEvidenceReference[] = [];
    for (const row of result.rows) {
      const entryId = row.entryId?.trim();
      const clientId = row.clientId?.trim();
      if (!entryId || !clientId) continue;
      evidence.push({
        assetId: row.assetId,
        title: titleForScoutMedia(row),
        kind: row.kind,
        url: scoutMediaFileUrl(input.orgId, clientId, "full"),
        description: null,
        entryId,
        clientId,
        teamKey: row.teamKey,
        eventKey: row.eventKey,
        thumbUrl: row.hasThumb ? scoutMediaFileUrl(input.orgId, clientId, "thumb") : null,
        source: "scout_media",
      });
    }
    return evidence;
  } catch {
    // Older deploys without scout_media stay empty rather than inventing photos.
    return [];
  }
}
