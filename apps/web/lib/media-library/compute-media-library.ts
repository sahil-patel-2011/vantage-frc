/**
 * Server-side view + write helpers for the Media Library. All queries run on
 * the RLS-scoped PoolClient handed in by the caller's withRls transaction.
 *
 * The list view is a read-only union: native media_items plus pit-scouting
 * photos (scout_media) and business sponsor artwork (sponsor_assets), each
 * tagged by origin, so the library is the one place all team media appears —
 * without migrating those tables.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type {
  MediaAlbumSummary,
  MediaLibraryItem,
  MediaLibraryView,
} from "./types";
import { computeStorageMeter } from "./storage-meter";
import type { UploadMetadata } from "./validation";

type OrgContext = {
  orgId: string;
  teamNumber: number | null;
  role: string;
};

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<OrgContext | null> {
  const membership = await client.query<OrgContext>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS "role"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

function canManage(uploaderId: string | null, viewerId: string, role: string): boolean {
  return uploaderId === viewerId || role === "owner" || role === "admin";
}

type LibraryRow = {
  id: string;
  kind: "photo" | "video";
  title: string;
  caption: string | null;
  albumId: string | null;
  takenAt: string | null;
  eventKey: string | null;
  subteam: string | null;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  storageLocation: "db" | "node";
  status: "pending" | "ready";
  uploaderId: string;
  uploaderName: string | null;
  hasThumbnail: boolean;
  createdAt: string;
};

export async function computeMediaLibraryView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MediaLibraryView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to open your media library.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }
  const { orgId } = org;
  const orgQuery = `orgId=${encodeURIComponent(orgId)}`;

  const [albumsResult, libraryResult, pitResult, businessResult, meterResult] = [
    await client.query<MediaAlbumSummary>(
      `SELECT a.id, a.name, a.description, a.event_key AS "eventKey",
              a.cover_item_id AS "coverItemId",
              (SELECT count(*)::int FROM media_items i WHERE i.album_id = a.id AND i.org_id = a.org_id) AS "itemCount",
              a.created_at::text AS "createdAt"
       FROM media_albums a
       WHERE a.org_id = $1::uuid
       ORDER BY a.created_at DESC`,
      [orgId],
    ),
    await client.query<LibraryRow>(
      `SELECT i.id, i.kind, i.title, i.caption, i.album_id AS "albumId",
              i.taken_at::text AS "takenAt", i.event_key AS "eventKey", i.subteam,
              i.content_type AS "contentType", i.byte_size::float8 AS "byteSize",
              i.width, i.height, i.duration_seconds AS "durationSeconds",
              i.storage_location AS "storageLocation", i.status,
              i.uploader_id AS "uploaderId", u.name AS "uploaderName",
              (i.thumbnail IS NOT NULL) AS "hasThumbnail",
              i.created_at::text AS "createdAt"
       FROM media_items i
       LEFT JOIN users u ON u.id = i.uploader_id
       WHERE i.org_id = $1::uuid
       ORDER BY i.created_at DESC`,
      [orgId],
    ),
    await client.query<{
      id: string;
      clientId: string;
      eventKey: string;
      teamKey: string;
      contentType: string;
      byteSize: number;
      capturedBy: string;
      capturedByName: string | null;
      createdAt: string;
    }>(
      `SELECT s.id, s.client_id AS "clientId", s.event_key AS "eventKey", s.team_key AS "teamKey",
              s.content_type AS "contentType", s.byte_size::float8 AS "byteSize",
              s.captured_by AS "capturedBy", u.name AS "capturedByName",
              s.created_at::text AS "createdAt"
       FROM scout_media s
       LEFT JOIN users u ON u.id = s.captured_by
       WHERE s.org_id = $1::uuid AND s.kind = 'photo' AND s.status = 'uploaded' AND s.bytes IS NOT NULL
       ORDER BY s.created_at DESC`,
      [orgId],
    ),
    await client.query<{
      id: string;
      name: string;
      mediaType: string;
      byteSize: number;
      width: number;
      height: number;
      createdBy: string;
      createdByName: string | null;
      createdAt: string;
    }>(
      `SELECT a.id, a.name, a.media_type AS "mediaType", a.byte_size::float8 AS "byteSize",
              a.width, a.height, a.created_by AS "createdBy", u.name AS "createdByName",
              a.created_at::text AS "createdAt"
       FROM sponsor_assets a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.org_id = $1::uuid AND a.status <> 'archived'
       ORDER BY a.created_at DESC`,
      [orgId],
    ),
    await client.query<{ dbBytes: number; dbCount: number; nodeBytes: number; nodeCount: number }>(
      `SELECT
         COALESCE(SUM(byte_size) FILTER (WHERE storage_location = 'db' AND status = 'ready'), 0)::float8 AS "dbBytes",
         COALESCE(COUNT(*) FILTER (WHERE storage_location = 'db' AND status = 'ready'), 0)::int AS "dbCount",
         COALESCE(SUM(byte_size) FILTER (WHERE storage_location = 'node'), 0)::float8 AS "nodeBytes",
         COALESCE(COUNT(*) FILTER (WHERE storage_location = 'node'), 0)::int AS "nodeCount"
       FROM media_items
       WHERE org_id = $1::uuid`,
      [orgId],
    ),
  ];

  const items: MediaLibraryItem[] = [];

  for (const row of libraryResult.rows) {
    items.push({
      id: row.id,
      origin: "library",
      kind: row.kind,
      title: row.title,
      caption: row.caption,
      albumId: row.albumId,
      takenAt: row.takenAt,
      eventKey: row.eventKey,
      subteam: row.subteam,
      contentType: row.contentType,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      durationSeconds: row.durationSeconds,
      storageLocation: row.storageLocation,
      status: row.status,
      uploaderId: row.uploaderId,
      uploaderName: row.uploaderName,
      canManage: canManage(row.uploaderId, input.userId, org.role),
      createdAt: row.createdAt,
      src: `/api/media-library/items/${row.id}?${orgQuery}`,
      thumbnailSrc: row.hasThumbnail
        ? `/api/media-library/items/${row.id}?${orgQuery}&thumbnail=1`
        : null,
    });
  }

  for (const row of pitResult.rows) {
    items.push({
      id: `pit:${row.id}`,
      origin: "pit_scouting",
      kind: "photo",
      title: `Pit photo — ${row.teamKey.replace(/^frc/, "")} @ ${row.eventKey}`,
      caption: null,
      albumId: null,
      takenAt: null,
      eventKey: row.eventKey,
      subteam: null,
      contentType: row.contentType,
      byteSize: row.byteSize,
      width: null,
      height: null,
      durationSeconds: null,
      storageLocation: "db",
      status: "ready",
      uploaderId: row.capturedBy,
      uploaderName: row.capturedByName,
      canManage: false,
      createdAt: row.createdAt,
      src: `/api/scouting/media/${encodeURIComponent(row.clientId)}?${orgQuery}`,
      thumbnailSrc: null,
    });
  }

  for (const row of businessResult.rows) {
    items.push({
      id: `biz:${row.id}`,
      origin: "business_assets",
      kind: "photo",
      title: row.name,
      caption: null,
      albumId: null,
      takenAt: null,
      eventKey: null,
      subteam: null,
      contentType: row.mediaType,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      durationSeconds: null,
      storageLocation: "db",
      status: "ready",
      uploaderId: row.createdBy,
      uploaderName: row.createdByName,
      canManage: false,
      createdAt: row.createdAt,
      src: `/api/business/assets/${row.id}?${orgQuery}`,
      thumbnailSrc: null,
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const meterRow = meterResult.rows[0];
  const meter = computeStorageMeter({
    dbBytes: meterRow?.dbBytes ?? 0,
    dbItemCount: meterRow?.dbCount ?? 0,
    nodeBytes: meterRow?.nodeBytes ?? 0,
    nodeItemCount: meterRow?.nodeCount ?? 0,
  });

  return {
    status: "live",
    orgId,
    teamNumber: org.teamNumber,
    viewerId: input.userId,
    viewerRole: org.role,
    albums: albumsResult.rows,
    items,
    meter,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createAlbum(
  client: PoolClient,
  input: { orgId: string; userId: string; name: string; description: string | null; eventKey: string | null },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO media_albums (org_id, name, description, event_key, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid)
     ON CONFLICT (org_id, name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [input.orgId, input.name, input.description, input.eventKey, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Album could not be created");
  return row.id;
}

export async function createItemMetadata(
  client: PoolClient,
  input: { orgId: string; userId: string; metadata: UploadMetadata },
): Promise<{ itemId: string; duplicate: boolean }> {
  const m = input.metadata;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM media_items WHERE org_id = $1::uuid AND sha256 = $2 LIMIT 1`,
    [input.orgId, m.sha256],
  );
  const duplicate = existing.rows[0];
  if (duplicate) return { itemId: duplicate.id, duplicate: true };

  const result = await client.query<{ id: string }>(
    `INSERT INTO media_items (
       org_id, uploader_id, album_id, kind, title, taken_at, event_key, subteam,
       storage_location, content_type, byte_size, sha256, width, height, duration_seconds, status
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz, $7, $8,
       'db', $9, $10, $11, $12, $13, $14, 'pending')
     RETURNING id`,
    [
      input.orgId, input.userId, m.albumId, m.kind, m.title, m.takenAt, m.eventKey, m.subteam,
      m.contentType, m.byteSize, m.sha256, m.width, m.height, m.durationSeconds,
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error("Upload could not be registered");
  return { itemId: inserted.id, duplicate: false };
}

export async function updateItemMetadata(
  client: PoolClient,
  input: {
    orgId: string;
    itemId: string;
    title?: string;
    caption?: string | null;
    albumId?: string | null;
    eventKey?: string | null;
    subteam?: string | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE media_items SET
       title = COALESCE($3, title),
       caption = CASE WHEN $4 THEN $5 ELSE caption END,
       album_id = CASE WHEN $6 THEN $7::uuid ELSE album_id END,
       event_key = CASE WHEN $8 THEN $9 ELSE event_key END,
       subteam = CASE WHEN $10 THEN $11 ELSE subteam END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.itemId, input.orgId,
      input.title ?? null,
      input.caption !== undefined, input.caption ?? null,
      input.albumId !== undefined, input.albumId ?? null,
      input.eventKey !== undefined, input.eventKey ?? null,
      input.subteam !== undefined, input.subteam ?? null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** RLS limits deletes to the uploader or an owner/admin; 0 rows = denied/missing. */
export async function deleteItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM media_items WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.itemId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAlbum(
  client: PoolClient,
  input: { orgId: string; albumId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM media_albums WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.albumId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setAlbumCover(
  client: PoolClient,
  input: { orgId: string; albumId: string; itemId: string | null },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE media_albums SET cover_item_id = $3::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM media_items i WHERE i.id = $3::uuid AND i.org_id = $2::uuid
       ))`,
    [input.albumId, input.orgId, input.itemId],
  );
  return (result.rowCount ?? 0) > 0;
}
