/**
 * Last-mile linkage: scout_media.entry_id is what strategy / dossier use to count pit photos.
 * Historically the column was never written, so every downstream "N media" tile stayed at zero.
 *
 * This module is the only place that decides which media client ids belong to an entry and the
 * parameterized UPDATE that stamps entry_id. No DEMO rows — unlinked media stay unlinked.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { normalizeRobotImageRefs } from "@vantage/scouting";

const ROBOT_IMAGE_KEYS = new Set([
  "robot_images",
  "robotImages",
  "mediaClientIds",
  "media_client_ids",
]);

function isRobotImageFieldKey(key: string): boolean {
  if (ROBOT_IMAGE_KEYS.has(key)) return true;
  return key.endsWith("_images") || key.endsWith("Images");
}

function clientIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.clientId ?? record.mediaClientId ?? record.scoutMediaId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

/** Media client ids stored on a robot_image field — never from free-text notes. */
export function mediaClientIdsFromField(value: unknown): string[] {
  const fromRefs = normalizeRobotImageRefs(value);
  if (fromRefs.length) return [...new Set(fromRefs)];
  if (!Array.isArray(value)) {
    const single = clientIdFromUnknown(value);
    return single ? [single] : [];
  }
  const ids: string[] = [];
  for (const item of value) {
    const id = clientIdFromUnknown(item);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Walk a scout entry payload and collect media client ids from photo fields only.
 * Notes / drivetrain / scores are ignored so a typed comment cannot become a false link.
 */
export function mediaClientIdsFromEntryPayload(
  payload: Record<string, unknown> | null | undefined,
): string[] {
  if (!payload) return [];
  const ids: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!isRobotImageFieldKey(key)) continue;
    ids.push(...mediaClientIdsFromField(value));
  }
  return [...new Set(ids)];
}

/** Append a captured media clientId onto a robot_image payload value without fabricating ids. */
export function appendMediaClientIdToField(value: unknown, mediaClientId: string): string[] {
  const id = mediaClientId.trim();
  if (!id) return mediaClientIdsFromField(value);
  return [...new Set([...mediaClientIdsFromField(value), id])];
}

export function appendMediaClientIdToPayload(
  payload: Record<string, unknown>,
  fieldKey: string,
  mediaClientId: string,
): Record<string, unknown> {
  const key = fieldKey.trim() || "robot_images";
  return {
    ...payload,
    [key]: appendMediaClientIdToField(payload[key], mediaClientId),
  };
}

export type ScoutMediaLinkPair = {
  entryId: string;
  entryClientId: string;
  mediaClientIds: string[];
};

/**
 * After an entry sync ack lands, pair queued media that stored entryClientId with the minted
 * server entryId. Media without an entryClientId are left out — they stay honest orphans.
 */
export function groupMediaClientIdsByEntry(input: {
  acknowledgements: ReadonlyArray<{ clientId: string; entryId?: string | null }>;
  media: ReadonlyArray<{ clientId: string; entryClientId?: string | null }>;
}): ScoutMediaLinkPair[] {
  const entryByClient = new Map<string, string>();
  for (const ack of input.acknowledgements) {
    const entryId = typeof ack.entryId === "string" ? ack.entryId.trim() : "";
    const clientId = typeof ack.clientId === "string" ? ack.clientId.trim() : "";
    if (entryId && clientId) entryByClient.set(clientId, entryId);
  }
  const grouped = new Map<string, ScoutMediaLinkPair>();
  for (const item of input.media) {
    const mediaClientId = typeof item.clientId === "string" ? item.clientId.trim() : "";
    const entryClientId = typeof item.entryClientId === "string" ? item.entryClientId.trim() : "";
    if (!mediaClientId || !entryClientId) continue;
    const entryId = entryByClient.get(entryClientId);
    if (!entryId) continue;
    const current = grouped.get(entryId) ?? { entryId, entryClientId, mediaClientIds: [] };
    if (!current.mediaClientIds.includes(mediaClientId)) current.mediaClientIds.push(mediaClientId);
    grouped.set(entryId, current);
  }
  return [...grouped.values()];
}

/**
 * Stamp scout_media.entry_id for known media client ids that are still NULL.
 * Parameterized, org-scoped. Returns how many rows actually linked — zero is a real answer.
 */
export async function linkScoutMediaToEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string; mediaClientIds: readonly string[] },
): Promise<number> {
  const mediaClientIds = [...new Set(input.mediaClientIds.map((id) => id.trim()).filter(Boolean))];
  if (!input.orgId || !input.entryId || !mediaClientIds.length) return 0;
  const result = await client.query(
    `UPDATE scout_media
     SET entry_id = $1::uuid,
         updated_at = now()
     WHERE org_id = $2::uuid
       AND entry_id IS NULL
       AND client_id = ANY($3::text[])
     RETURNING id`,
    [input.entryId, input.orgId, mediaClientIds],
  );
  return result.rowCount ?? 0;
}

/** Back-fill from the robot_image refs already stored on the entry payload. */
export async function backfillScoutMediaFromPayload(
  client: PoolClient,
  input: { orgId: string; entryId: string; payload: Record<string, unknown> | null | undefined },
): Promise<number> {
  return linkScoutMediaToEntry(client, {
    orgId: input.orgId,
    entryId: input.entryId,
    mediaClientIds: mediaClientIdsFromEntryPayload(input.payload),
  });
}

/** Apply every sync-ack pairing in one org. Skips empty groups instead of writing NULL. */
export async function linkScoutMediaFromSyncAcks(
  client: PoolClient,
  input: {
    orgId: string;
    acknowledgements: ReadonlyArray<{ clientId: string; entryId?: string | null }>;
    media: ReadonlyArray<{ clientId: string; entryClientId?: string | null }>;
  },
): Promise<number> {
  let linked = 0;
  for (const pair of groupMediaClientIdsByEntry(input)) {
    linked += await linkScoutMediaToEntry(client, {
      orgId: input.orgId,
      entryId: pair.entryId,
      mediaClientIds: pair.mediaClientIds,
    });
  }
  return linked;
}

/**
 * Per-entry counts used by strategy. Only rows with a real entry_id — unlinked photos do not
 * become a fabricated "N media".
 */
export async function countLinkedScoutMediaByEntry(
  client: PoolClient,
  input: { orgId: string; eventKey: string; entryIds?: readonly string[] },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const entryIds = [...new Set((input.entryIds ?? []).map((id) => id.trim()).filter(Boolean))];
  try {
    const result = await client.query<{ entryId: string; n: number }>(
      `SELECT entry_id::text AS "entryId", count(*)::int AS n
       FROM scout_media
       WHERE org_id = $1::uuid
         AND event_key = $2
         AND entry_id IS NOT NULL
         AND ($3::uuid[] IS NULL OR entry_id = ANY($3::uuid[]))
       GROUP BY entry_id`,
      [input.orgId, input.eventKey, entryIds.length ? entryIds : null],
    );
    for (const row of result.rows) counts.set(row.entryId, row.n);
  } catch {
    // scout_media (or the deploy) may be older than this query — stay at zero, never invent.
  }
  return counts;
}
