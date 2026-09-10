/**
 * Last client gate before a capture enters the media outbox.
 *
 * `prepare-scout-media` already refuses an empty entryClientId. This module is the
 * attachMedia wire: it builds the POST/outbox body and answers "may we queue?"
 * without inventing thumbs or DEMO jpegs.
 */

import {
  buildScoutMediaMetadata,
  scoutMediaUnlinkedMessage,
  type ScoutMediaKind,
  type ScoutMediaUploadMetadata,
} from "./prepare-scout-media";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTRY_CLIENT_TAG_PREFIX = "entry_client:";

export type AttachMediaWireInput = {
  eventKey?: string | null;
  teamKey?: string | null;
  entryClientId?: string | null;
  entryId?: string | null;
  kind: ScoutMediaKind;
  contentType: string;
  byteSize: number;
  tags?: readonly string[];
  fieldKey?: string;
  hasThumb?: boolean;
  thumbContentType?: string | null;
  thumbByteSize?: number | null;
};

export type AttachMediaWireOk = {
  ok: true;
  metadata: ScoutMediaUploadMetadata;
};

export type AttachMediaWireRefuse = {
  ok: false;
  reason: string;
  permanent: true;
};

export type AttachMediaWireResult = AttachMediaWireOk | AttachMediaWireRefuse;

export type MediaLinkJobAfterMint = {
  entryId: string;
  entryClientId: string;
  payload: Record<string, unknown>;
  entryClientTag: string;
};

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Tag stored on scout_media.tags so sync can stamp entry_id after the entry mints. */
export function entryClientMediaTag(entryClientId: string): string {
  const id = entryClientId.trim();
  return id ? `${ENTRY_CLIENT_TAG_PREFIX}${id}` : "";
}

export function entryClientIdFromMediaTag(tag: string): string | null {
  if (!tag.startsWith(ENTRY_CLIENT_TAG_PREFIX)) return null;
  const id = tag.slice(ENTRY_CLIENT_TAG_PREFIX.length).trim();
  return id || null;
}

/** Read the link off a media POST body. Invalid / blank ids stay null — never invented. */
export function readScoutMediaLinkFromPost(body: {
  entryId?: unknown;
  entryClientId?: unknown;
}): { entryClientId: string | null; entryId: string | null } {
  const entryClientId =
    typeof body.entryClientId === "string" && body.entryClientId.trim()
      ? body.entryClientId.trim()
      : null;
  const rawId = typeof body.entryId === "string" ? body.entryId.trim() : "";
  return { entryClientId, entryId: rawId && isUuid(rawId) ? rawId : null };
}

/**
 * Prefer an explicit uuid, else a looked-up minted id. Returns null when neither
 * is a real uuid so scout_media.entry_id is never written from a client id.
 */
export function pickMintedEntryId(input: {
  entryId?: string | null;
  lookedUpEntryId?: string | null;
}): string | null {
  const explicit = typeof input.entryId === "string" ? input.entryId.trim() : "";
  if (explicit && isUuid(explicit)) return explicit;
  const looked = typeof input.lookedUpEntryId === "string" ? input.lookedUpEntryId.trim() : "";
  return looked && isUuid(looked) ? looked : null;
}

/** Merge the entry_client tag onto outbox tags without duplicating it. */
export function withEntryClientTag(
  tags: readonly string[],
  entryClientId: string,
): string[] {
  const tag = entryClientMediaTag(entryClientId);
  if (!tag) return [...tags];
  return tags.includes(tag) ? [...tags] : [...tags, tag];
}

export function canQueueAttachedMedia(
  result: AttachMediaWireResult,
): result is AttachMediaWireOk {
  return result.ok && Boolean(result.metadata.entryClientId.trim());
}

/**
 * Build the outbox / POST metadata. Refuses when the event, team, or entry
 * client id is missing so attachMedia cannot queue an orphan.
 */
export function buildAttachMediaWire(input: AttachMediaWireInput): AttachMediaWireResult {
  const eventKey = typeof input.eventKey === "string" ? input.eventKey.trim() : "";
  const teamKey = typeof input.teamKey === "string" ? input.teamKey.trim() : "";
  if (!eventKey || !teamKey) {
    return {
      ok: false,
      reason: "Set your active event and pick a team before attaching media.",
      permanent: true,
    };
  }
  try {
    const base = buildScoutMediaMetadata({
      eventKey,
      teamKey,
      kind: input.kind,
      contentType: input.contentType,
      byteSize: input.byteSize,
      tags: input.tags,
      fieldKey: input.fieldKey,
      entryClientId: input.entryClientId ?? "",
      entryId: input.entryId,
      hasThumb: Boolean(input.hasThumb),
      thumbContentType: input.hasThumb ? (input.thumbContentType ?? null) : null,
      thumbByteSize: input.hasThumb ? (input.thumbByteSize ?? null) : null,
    });
    return {
      ok: true,
      metadata: {
        ...base,
        tags: withEntryClientTag(base.tags, base.entryClientId),
        hasThumb: Boolean(input.hasThumb),
        thumbContentType: input.hasThumb ? (input.thumbContentType ?? null) : null,
        thumbByteSize: input.hasThumb ? (input.thumbByteSize ?? null) : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : scoutMediaUnlinkedMessage(),
      permanent: true,
    };
  }
}

/**
 * After entry sync acks land, the jobs we can honestly stamp. Media without an
 * entryClientId pairing or a uuid entryId are dropped — no DEMO links.
 */
export function mediaLinkJobsAfterMint(input: {
  acknowledgements: ReadonlyArray<{ clientId?: string | null; entryId?: string | null }>;
  entries: ReadonlyArray<{ clientId?: string | null; payload?: Record<string, unknown> | null }>;
}): MediaLinkJobAfterMint[] {
  const payloadByClient = new Map<string, Record<string, unknown>>();
  for (const entry of input.entries) {
    const clientId = typeof entry.clientId === "string" ? entry.clientId.trim() : "";
    if (!clientId) continue;
    payloadByClient.set(clientId, entry.payload ?? {});
  }
  const jobs: MediaLinkJobAfterMint[] = [];
  const seen = new Set<string>();
  for (const ack of input.acknowledgements) {
    const entryClientId = typeof ack.clientId === "string" ? ack.clientId.trim() : "";
    const entryId = typeof ack.entryId === "string" ? ack.entryId.trim() : "";
    if (!entryClientId || !isUuid(entryId) || seen.has(entryId)) continue;
    seen.add(entryId);
    jobs.push({
      entryId,
      entryClientId,
      payload: payloadByClient.get(entryClientId) ?? {},
      entryClientTag: entryClientMediaTag(entryClientId),
    });
  }
  return jobs;
}
