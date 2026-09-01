/**
 * Notebook image evidence.
 *
 * A judged engineering notebook is CAD screenshots and whiteboard photos, not a
 * text journal. Attachment metadata lives as reserved `asset:<uuid>` tags on the
 * existing `notebook_entries.tags` column (no new table) and is resolved against
 * real Media Kit, Media Library, and linked scout_media rows. Missing or deleted
 * assets resolve to nothing — we never invent a photo or a placeholder URL.
 * Markdown `![photo](url)` in the body is never evidence.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { MediaEvidenceReference } from "../media/evidence-references";
import {
  LIBRARY_CITE_KINDS,
  isLibraryCiteKind,
  libraryCiteIds,
  parseLibraryCites,
  resolveLibraryCites,
} from "./library-cite";

export type NotebookImageAttachment = MediaEvidenceReference;

/** Kinds that are actual pictures or video. `other` / audio are not award evidence. */
export const NOTEBOOK_IMAGE_KINDS = LIBRARY_CITE_KINDS;
export type NotebookImageKind = (typeof NOTEBOOK_IMAGE_KINDS)[number];

export const MAX_NOTEBOOK_ATTACHMENTS = 8;
export const NOTEBOOK_ASSET_TAG_PREFIX = "asset:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_TAG_RE = new RegExp(
  `^${NOTEBOOK_ASSET_TAG_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
  "i",
);

export function isNotebookImageKind(kind: string): kind is NotebookImageKind {
  return isLibraryCiteKind(kind);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function notebookAssetTag(assetId: string): string {
  return `${NOTEBOOK_ASSET_TAG_PREFIX}${assetId.trim().toLowerCase()}`;
}

export function isNotebookAssetTag(tag: string): boolean {
  return ASSET_TAG_RE.test(tag.trim());
}

export function assetIdFromNotebookTag(tag: string): string | null {
  const match = tag.trim().match(ASSET_TAG_RE);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * IDs from a create/update payload. Accepts the same shapes other features already
 * store (`mediaAssetId` / `assetId` / bare strings). Junk and non-UUIDs are dropped,
 * never turned into fake photos.
 */
function normalizeAssetIds(raw: readonly string[], limit: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const normalized = id.trim().toLowerCase();
    if (!isUuid(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** Per-entry payload. A single write-up cannot cite the whole media library. */
export function parseNotebookAttachmentIds(raw: unknown): string[] {
  return normalizeAssetIds(libraryCiteIds(parseLibraryCites(raw)), MAX_NOTEBOOK_ATTACHMENTS);
}

export function attachmentIdsFromTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags?.length) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const id = assetIdFromNotebookTag(tag);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_NOTEBOOK_ATTACHMENTS) break;
  }
  return ids;
}

export function splitNotebookTags(tags: readonly string[] | null | undefined): {
  tags: string[];
  attachmentIds: string[];
} {
  const userTags: string[] = [];
  const seenUser = new Set<string>();
  for (const tag of tags ?? []) {
    if (typeof tag !== "string") continue;
    if (isNotebookAssetTag(tag)) continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized || seenUser.has(normalized)) continue;
    seenUser.add(normalized);
    userTags.push(normalized);
  }
  return { tags: userTags, attachmentIds: attachmentIdsFromTags(tags) };
}

/**
 * Rebuild the stored tag array. User tags and attachment ids can be patched
 * independently so changing the write-up does not drop photos, and vice versa.
 */
export function mergeNotebookTags(
  existing: { tags: string[]; attachmentIds: string[] },
  patch: { tags?: string[]; attachmentIds?: string[] },
): string[] {
  const userTags = patch.tags ?? existing.tags;
  const attachmentIds = parseNotebookAttachmentIds(patch.attachmentIds ?? existing.attachmentIds);
  return [...userTags.filter((tag) => !isNotebookAssetTag(tag)), ...attachmentIds.map(notebookAssetTag)];
}

export function isResolvedNotebookImage(
  asset: Pick<NotebookImageAttachment, "url" | "kind">,
): boolean {
  return Boolean(asset.url.trim()) && isNotebookImageKind(asset.kind);
}

/**
 * Award evidence. A text body — even one that embeds `![photo](url)` markdown —
 * does not count. Only resolved kit / library / scout image rows with a real URL do.
 */
export function notebookEntryHasImageEvidence(
  attachments: readonly Pick<NotebookImageAttachment, "url" | "kind">[] | null | undefined,
): boolean {
  return (attachments ?? []).some(isResolvedNotebookImage);
}

export function summarizeNotebookEvidence(
  entries: readonly { attachments?: readonly Pick<NotebookImageAttachment, "url" | "kind">[] }[],
): { withPhotos: number; missingPhotos: number } {
  const withPhotos = entries.filter((entry) => notebookEntryHasImageEvidence(entry.attachments)).length;
  return { withPhotos, missingPhotos: entries.length - withPhotos };
}

export async function resolveNotebookAttachments(
  client: PoolClient,
  input: { orgId: string; assetIds: readonly string[] },
): Promise<NotebookImageAttachment[]> {
  // Read path: do not apply the per-entry write cap — a notebook page cites many entries.
  const assetIds = normalizeAssetIds(input.assetIds, 200);
  return resolveLibraryCites(client, {
    orgId: input.orgId,
    ids: assetIds,
    limit: Math.min(200, Math.max(assetIds.length, 1)),
  });
}

export async function listNotebookImageLibrary(
  client: PoolClient,
  input: { orgId: string },
): Promise<NotebookImageAttachment[]> {
  const rows = await resolveLibraryCites(client, { orgId: input.orgId, limit: 50 });
  return rows.filter(isResolvedNotebookImage);
}

/** Persist only IDs that still resolve to a real team photo. Missing IDs fail closed. */
export async function assertNotebookImageAttachments(
  client: PoolClient,
  input: { orgId: string; assetIds: readonly string[] },
): Promise<NotebookImageAttachment[]> {
  const requested = parseNotebookAttachmentIds(input.assetIds);
  if (!requested.length) return [];
  const resolved = await resolveNotebookAttachments(client, {
    orgId: input.orgId,
    assetIds: requested,
  });
  const found = new Set(resolved.map((row) => row.assetId.toLowerCase()));
  if (requested.some((id) => !found.has(id))) {
    throw new Error("Those photos are not in this team's media library.");
  }
  return resolved;
}
