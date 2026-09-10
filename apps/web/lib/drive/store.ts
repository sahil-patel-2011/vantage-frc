/**
 * Vantage Drive data access. Runs on the caller's `withRls` PoolClient with
 * raw parameterized SQL only — the RLS policies in migration 0641 are the
 * security model, and nothing here re-implements them in JavaScript. Where a
 * query does carry an extra predicate (`scope = $n`, `owner_user_id = $n`) it
 * is to shape the LISTING, not to enforce access: RLS has already decided what
 * this session can see.
 *
 * Server-only: imported by API routes, never by a client component.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { StorageContentClass } from "../storage-routing/types";
import { hashDriveShareToken } from "./share-token";
import type {
  DriveBreadcrumb,
  DriveFile,
  DriveFolder,
  DriveScope,
  DriveShare,
  DriveSharedWithMe,
  DriveStorageLocation,
  DriveVirtualFolder,
} from "./types";

export type DriveMembership = { orgId: string; orgName: string; role: string };

/**
 * Resolve the workspace without demanding a query parameter — the same
 * fallback the Forms API uses, so opening /files from the nav works for the
 * overwhelmingly common case of one team.
 */
export async function resolveDriveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<DriveMembership | null> {
  const result = await client.query<DriveMembership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.name
      LIMIT 1`,
    [userId, requestedOrgId],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listFolders(
  client: PoolClient,
  input: { orgId: string; scope: DriveScope; userId: string; parentId: string | null },
): Promise<DriveFolder[]> {
  const result = await client.query<{
    id: string;
    name: string;
    parentId: string | null;
    scope: DriveScope;
    createdAt: string;
    fileCount: string;
  }>(
    `SELECT d.id, d.name, d.parent_id AS "parentId", d.scope, d.created_at AS "createdAt",
            (SELECT count(*) FROM drive_files f
              WHERE f.folder_id = d.id AND f.deleted_at IS NULL)::text AS "fileCount"
       FROM drive_folders d
      WHERE d.org_id = $1::uuid
        AND d.scope = $2
        AND ($3::uuid IS NULL OR d.owner_user_id = $3::uuid)
        AND d.parent_id IS NOT DISTINCT FROM $4::uuid
      ORDER BY lower(d.name)`,
    [input.orgId, input.scope, input.scope === "personal" ? input.userId : null, input.parentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    scope: row.scope,
    createdAt: row.createdAt,
    fileCount: Number(row.fileCount),
  }));
}

/** Root → current folder. Empty when we are already at the root. */
export async function folderBreadcrumbs(
  client: PoolClient,
  input: { orgId: string; folderId: string | null },
): Promise<DriveBreadcrumb[]> {
  if (!input.folderId) return [];
  const result = await client.query<{ id: string; name: string; depth: number }>(
    `WITH RECURSIVE trail AS (
       SELECT d.id, d.name, d.parent_id, 0 AS depth
         FROM drive_folders d
        WHERE d.id = $1::uuid AND d.org_id = $2::uuid
       UNION ALL
       SELECT p.id, p.name, p.parent_id, trail.depth + 1
         FROM drive_folders p
         JOIN trail ON trail.parent_id = p.id
        WHERE p.org_id = $2::uuid
     )
     SELECT id, name, depth FROM trail ORDER BY depth DESC`,
    [input.folderId, input.orgId],
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createFolder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    scope: DriveScope;
    parentId: string | null;
    name: string;
  },
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO drive_folders (org_id, scope, owner_user_id, parent_id, name, created_by)
     VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.scope,
      input.scope === "personal" ? input.userId : null,
      input.parentId,
      input.name,
      input.userId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("The folder could not be created");
  return row;
}

export async function renameFolder(
  client: PoolClient,
  input: { orgId: string; folderId: string; name: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_folders SET name = $3, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.folderId, input.orgId, input.name],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a folder, but only when it is empty. A recursive delete that silently
 * takes fifty files with it is the kind of "convenience" people only discover
 * afterwards; the UI says how many things are inside and asks you to clear it.
 */
export async function deleteFolderIfEmpty(
  client: PoolClient,
  input: { orgId: string; folderId: string },
): Promise<{ deleted: boolean; fileCount: number; folderCount: number }> {
  const counts = await client.query<{ fileCount: string; folderCount: string }>(
    `SELECT (SELECT count(*) FROM drive_files f
              WHERE f.folder_id = $1::uuid AND f.deleted_at IS NULL)::text AS "fileCount",
            (SELECT count(*) FROM drive_folders d WHERE d.parent_id = $1::uuid)::text AS "folderCount"`,
    [input.folderId],
  );
  const fileCount = Number(counts.rows[0]?.fileCount ?? 0);
  const folderCount = Number(counts.rows[0]?.folderCount ?? 0);
  if (fileCount > 0 || folderCount > 0) return { deleted: false, fileCount, folderCount };

  const result = await client.query(`DELETE FROM drive_folders WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.folderId,
    input.orgId,
  ]);
  return { deleted: (result.rowCount ?? 0) > 0, fileCount, folderCount };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

type FileRow = {
  id: string;
  name: string;
  folderId: string | null;
  scope: DriveScope;
  ownerUserId: string | null;
  contentType: string;
  contentClass: StorageContentClass;
  byteSize: string;
  storageLocation: DriveStorageLocation;
  status: "pending" | "ready";
  hasThumb: boolean;
  uploadedBy: string;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  shareCount: string;
};

function toDriveFile(row: FileRow, actor: { userId: string; role: string }): DriveFile {
  const isLead = actor.role === "owner" || actor.role === "admin";
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    scope: row.scope,
    contentType: row.contentType,
    contentClass: row.contentClass,
    byteSize: Number(row.byteSize),
    storageLocation: row.storageLocation,
    status: row.status,
    hasThumb: row.hasThumb,
    uploadedBy: row.uploadedBy,
    uploaderName: row.uploaderName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    shareCount: Number(row.shareCount),
    canManage:
      row.scope === "personal"
        ? row.ownerUserId === actor.userId
        : row.uploadedBy === actor.userId || isLead,
  };
}

const FILE_COLUMNS = `
  f.id, f.name, f.folder_id AS "folderId", f.scope, f.owner_user_id AS "ownerUserId",
  f.content_type AS "contentType", f.content_class AS "contentClass",
  f.byte_size::text AS "byteSize", f.storage_location AS "storageLocation",
  f.status, (f.thumb IS NOT NULL) AS "hasThumb",
  f.uploaded_by AS "uploadedBy", u.name AS "uploaderName",
  f.created_at AS "createdAt", f.updated_at AS "updatedAt",
  (SELECT count(*) FROM drive_shares s
    WHERE s.file_id = f.id AND s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > now()))::text AS "shareCount"`;

export async function listFiles(
  client: PoolClient,
  input: {
    orgId: string;
    scope: DriveScope;
    userId: string;
    role: string;
    folderId: string | null;
  },
): Promise<DriveFile[]> {
  const result = await client.query<FileRow>(
    `SELECT ${FILE_COLUMNS}
       FROM drive_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.org_id = $1::uuid
        AND f.scope = $2
        AND ($3::uuid IS NULL OR f.owner_user_id = $3::uuid)
        AND f.folder_id IS NOT DISTINCT FROM $4::uuid
        AND f.deleted_at IS NULL
      ORDER BY lower(f.name)`,
    [input.orgId, input.scope, input.scope === "personal" ? input.userId : null, input.folderId],
  );
  return result.rows.map((row) => toDriveFile(row, input));
}

/** Everything this member can see, newest first — the "Recent" rail. */
export async function listRecentFiles(
  client: PoolClient,
  input: { orgId: string; userId: string; role: string; limit: number },
): Promise<DriveFile[]> {
  const result = await client.query<FileRow>(
    `SELECT ${FILE_COLUMNS}
       FROM drive_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.org_id = $1::uuid AND f.deleted_at IS NULL AND f.status = 'ready'
      ORDER BY f.created_at DESC
      LIMIT $2::int`,
    [input.orgId, Math.min(Math.max(input.limit, 1), 200)],
  );
  return result.rows.map((row) => toDriveFile(row, input));
}

export async function listTrashedFiles(
  client: PoolClient,
  input: { orgId: string; userId: string; role: string },
): Promise<DriveFile[]> {
  const result = await client.query<FileRow>(
    `SELECT ${FILE_COLUMNS}
       FROM drive_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.org_id = $1::uuid AND f.deleted_at IS NOT NULL
      ORDER BY f.deleted_at DESC
      LIMIT 200`,
    [input.orgId],
  );
  return result.rows.map((row) => toDriveFile(row, input));
}

export type CreateDriveFileInput = {
  orgId: string;
  userId: string;
  scope: DriveScope;
  folderId: string | null;
  name: string;
  contentType: string;
  contentClass: StorageContentClass;
  byteSize: number;
  sha256: string;
  storageLocation: DriveStorageLocation;
  nodeItemId: string | null;
  objectKey: string | null;
};

/** Create the metadata row for a file whose bytes have not landed yet. */
export async function createFileRow(
  client: PoolClient,
  input: CreateDriveFileInput,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO drive_files (
       org_id, scope, owner_user_id, folder_id, name, content_type, content_class,
       byte_size, sha256, storage_location, node_item_id, object_key, status, uploaded_by
     ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7,
       $8::bigint, $9, $10, $11::uuid, $12, 'pending', $13::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.scope,
      input.scope === "personal" ? input.userId : null,
      input.folderId,
      input.name,
      input.contentType,
      input.contentClass,
      String(Math.round(input.byteSize)),
      input.sha256,
      input.storageLocation,
      input.nodeItemId,
      input.objectKey,
      input.userId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("The upload could not be registered");
  return row;
}

/** Store the bytes of a database-hosted file and mark it ready. */
export async function storeFileBytes(
  client: PoolClient,
  input: {
    orgId: string;
    fileId: string;
    bytes: Buffer;
    thumb: Buffer | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_files
        SET bytes = $3, thumb = COALESCE($4, thumb), status = 'ready', updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
        AND storage_location = 'db' AND deleted_at IS NULL`,
    [input.fileId, input.orgId, input.bytes, input.thumb],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark a node- or object-hosted file ready once the browser reports the
 * transfer landed. Idempotent so a retried finalize after a dropped connection
 * is harmless.
 */
export async function markFileReady(
  client: PoolClient,
  input: { orgId: string; fileId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_files SET status = 'ready', updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
        AND storage_location <> 'db' AND deleted_at IS NULL`,
    [input.fileId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function renameFile(
  client: PoolClient,
  input: { orgId: string; fileId: string; name: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_files SET name = $3, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL`,
    [input.fileId, input.orgId, input.name],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Move a file into a folder (or to the root). The destination folder is
 * re-read under RLS in the same statement, so a member cannot move a file into
 * a folder they cannot see — and a personal file can only land in a personal
 * folder of the same owner, which the scope equality below pins.
 */
export async function moveFile(
  client: PoolClient,
  input: { orgId: string; fileId: string; folderId: string | null },
): Promise<{ moved: boolean; reason?: string }> {
  if (input.folderId) {
    const target = await client.query<{ scope: DriveScope; ownerUserId: string | null }>(
      `SELECT scope, owner_user_id AS "ownerUserId" FROM drive_folders
        WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.folderId, input.orgId],
    );
    if (!target.rowCount) {
      return { moved: false, reason: "That folder does not exist, or you cannot see it." };
    }
    const result = await client.query(
      `UPDATE drive_files f SET folder_id = $3::uuid, updated_at = now()
        WHERE f.id = $1::uuid AND f.org_id = $2::uuid AND f.deleted_at IS NULL
          AND f.scope = $4
          AND f.owner_user_id IS NOT DISTINCT FROM $5::uuid`,
      [input.fileId, input.orgId, input.folderId, target.rows[0]!.scope, target.rows[0]!.ownerUserId],
    );
    return (result.rowCount ?? 0) > 0
      ? { moved: true }
      : {
          moved: false,
          reason:
            "A file can only move within the same space — a team file into a team folder, a personal file into your own folder.",
        };
  }
  const result = await client.query(
    `UPDATE drive_files SET folder_id = NULL, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL`,
    [input.fileId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0 ? { moved: true } : { moved: false, reason: "That file is not yours to move." };
}

export async function softDeleteFile(
  client: PoolClient,
  input: { orgId: string; fileId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_files SET deleted_at = now(), updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL`,
    [input.fileId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function restoreFile(
  client: PoolClient,
  input: { orgId: string; fileId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_files SET deleted_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NOT NULL`,
    [input.fileId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export type DriveFileContent = {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  storageLocation: DriveStorageLocation;
  status: "pending" | "ready";
  bytes: Buffer | null;
  nodeItemId: string | null;
  objectKey: string | null;
};

/** One file's bytes or pointer, for the authenticated download route. */
export async function loadFileContent(
  client: PoolClient,
  input: { orgId: string; fileId: string; includeBytes: boolean },
): Promise<DriveFileContent | null> {
  const result = await client.query<{
    id: string;
    name: string;
    contentType: string;
    byteSize: string;
    storageLocation: DriveStorageLocation;
    status: "pending" | "ready";
    bytes: Buffer | null;
    nodeItemId: string | null;
    objectKey: string | null;
  }>(
    `SELECT id, name, content_type AS "contentType", byte_size::text AS "byteSize",
            storage_location AS "storageLocation", status,
            CASE WHEN $3 THEN bytes ELSE NULL END AS bytes,
            node_item_id AS "nodeItemId", object_key AS "objectKey"
       FROM drive_files
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL
      LIMIT 1`,
    [input.fileId, input.orgId, input.includeBytes],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, byteSize: Number(row.byteSize) };
}

export async function loadFileThumb(
  client: PoolClient,
  input: { orgId: string; fileId: string },
): Promise<Buffer | null> {
  const result = await client.query<{ thumb: Buffer | null }>(
    `SELECT thumb FROM drive_files
      WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL AND thumb IS NOT NULL
      LIMIT 1`,
    [input.fileId, input.orgId],
  );
  return result.rows[0]?.thumb ?? null;
}

/** Real byte totals per storage location for one scope. Never estimated. */
export async function loadDriveUsage(
  client: PoolClient,
  input: { orgId: string; scope: DriveScope; userId: string },
): Promise<{ dbBytes: number; nodeBytes: number; objectBytes: number; fileCount: number }> {
  const result = await client.query<{
    dbBytes: string;
    nodeBytes: string;
    objectBytes: string;
    fileCount: string;
  }>(
    `SELECT
       COALESCE(SUM(byte_size) FILTER (WHERE storage_location = 'db'), 0)::text AS "dbBytes",
       COALESCE(SUM(byte_size) FILTER (WHERE storage_location = 'node'), 0)::text AS "nodeBytes",
       COALESCE(SUM(byte_size) FILTER (WHERE storage_location = 'object'), 0)::text AS "objectBytes",
       count(*)::text AS "fileCount"
     FROM drive_files
     WHERE org_id = $1::uuid AND scope = $2
       AND ($3::uuid IS NULL OR owner_user_id = $3::uuid)
       AND deleted_at IS NULL AND status = 'ready'`,
    [input.orgId, input.scope, input.scope === "personal" ? input.userId : null],
  );
  const row = result.rows[0];
  return {
    dbBytes: Number(row?.dbBytes ?? 0),
    nodeBytes: Number(row?.nodeBytes ?? 0),
    objectBytes: Number(row?.objectBytes ?? 0),
    fileCount: Number(row?.fileCount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Media Library + CAD Vault, surfaced read-only
// ---------------------------------------------------------------------------

/**
 * The team's photos/videos (0483) and CAD documents (0474) as two virtual
 * folders inside Team files, so the whole team's material is in one place.
 *
 * Nothing is copied: each entry links out to the page that owns it, which is
 * also where editing, versioning and deletion stay. Copying bytes into Drive
 * would double the storage bill and create two answers to "what is the current
 * version of the intake plate".
 */
export async function loadVirtualFolders(
  client: PoolClient,
  input: { orgId: string; limit?: number },
): Promise<DriveVirtualFolder[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 50);
  const [media, cad] = await Promise.all([
    client.query<{
      id: string;
      name: string;
      byteSize: string;
      contentType: string;
      createdAt: string;
      total: string;
    }>(
      `SELECT id, title AS name, byte_size::text AS "byteSize", content_type AS "contentType",
              created_at AS "createdAt",
              count(*) OVER ()::text AS total
         FROM media_items
        WHERE org_id = $1::uuid AND status = 'ready'
        ORDER BY created_at DESC
        LIMIT $2::int`,
      [input.orgId, limit],
    ),
    client.query<{
      id: string;
      name: string;
      byteSize: string;
      contentType: string;
      createdAt: string;
      total: string;
    }>(
      `SELECT d.id, d.title AS name,
              COALESCE(v.byte_size, 0)::text AS "byteSize",
              COALESCE(v.media_type, 'application/octet-stream') AS "contentType",
              d.created_at AS "createdAt",
              count(*) OVER ()::text AS total
         FROM cad_documents d
         LEFT JOIN LATERAL (
           SELECT byte_size, media_type FROM cad_document_versions
            WHERE document_id = d.id ORDER BY version DESC LIMIT 1
         ) v ON true
        WHERE d.org_id = $1::uuid AND d.status <> 'archived'
        ORDER BY d.created_at DESC
        LIMIT $2::int`,
      [input.orgId, limit],
    ),
  ]);

  const folders: DriveVirtualFolder[] = [];
  const mediaTotal = Number(media.rows[0]?.total ?? 0);
  folders.push({
    id: "media-library",
    name: "Media Library",
    description:
      "Photos and videos the team has uploaded. Lives in the Media Library — open it there to caption, album or delete.",
    href: "/media",
    itemCount: mediaTotal,
    items: media.rows.map((row) => ({
      id: row.id,
      name: row.name,
      byteSize: Number(row.byteSize),
      contentType: row.contentType,
      createdAt: row.createdAt,
      href: "/media",
    })),
  });

  const cadTotal = Number(cad.rows[0]?.total ?? 0);
  folders.push({
    id: "cad-vault",
    name: "CAD Vault",
    description:
      "Versioned CAD documents. Lives in the CAD vault — open it there for version history and STL geometry.",
    href: "/build?tab=cad",
    itemCount: cadTotal,
    items: cad.rows.map((row) => ({
      id: row.id,
      name: row.name,
      byteSize: Number(row.byteSize),
      contentType: row.contentType,
      createdAt: row.createdAt,
      href: "/build?tab=cad",
    })),
  });

  // The older Team Library (library_resources: uploads AND links, with its own
  // per-person visibility grants). It predates Drive and still holds a team's
  // links and earlier uploads; listing it here means "where is that file" has
  // one answer. RLS on library_resources already hides rows this member was
  // not granted, so nothing leaks through the listing.
  const library = await client.query<{
    id: string;
    name: string;
    byteSize: string | null;
    contentType: string | null;
    kind: string;
    url: string | null;
    createdAt: string;
    total: string;
  }>(
    `SELECT r.id, r.title AS name, r.byte_size::text AS "byteSize", r.content_type AS "contentType",
            r.kind, r.url, r.created_at AS "createdAt",
            count(*) OVER ()::text AS total
       FROM library_resources r
      WHERE r.org_id = $1::uuid AND r.status = 'ready'
      ORDER BY r.created_at DESC
      LIMIT $2::int`,
    [input.orgId, limit],
  );
  const libraryTotal = Number(library.rows[0]?.total ?? 0);
  folders.push({
    id: "team-library",
    name: "Older Team Library",
    description:
      "Links and earlier uploads from before Files. Team-wide items are also copied into the From Team Library folder. Restricted items stay here until an owner re-shares them.",
    href: "/files",
    itemCount: libraryTotal,
    items: library.rows.map((row) => ({
      id: row.id,
      name: row.kind === "link" && row.url ? `${row.name} — ${row.url}` : row.name,
      byteSize: Number(row.byteSize ?? 0),
      contentType: row.contentType ?? (row.kind === "link" ? "text/uri-list" : "application/octet-stream"),
      createdAt: row.createdAt,
      href: "/files",
    })),
  });

  return folders;
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

type ShareRow = {
  id: string;
  kind: "link" | "email";
  email: string | null;
  note: string | null;
  canDownload: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  createdBy: string;
  creatorName: string | null;
  fileId: string | null;
  fileName: string | null;
  folderId: string | null;
  folderName: string | null;
};

function toDriveShare(row: ShareRow): DriveShare {
  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    note: row.note,
    canDownload: row.canDownload,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    useCount: Number(row.useCount),
    createdBy: row.createdBy,
    creatorName: row.creatorName,
    target: row.fileId
      ? { kind: "file", id: row.fileId, name: row.fileName ?? "(file removed)" }
      : { kind: "folder", id: row.folderId ?? "", name: row.folderName ?? "(folder removed)" },
  };
}

const SHARE_COLUMNS = `
  s.id, s.kind, s.email, s.note, s.can_download AS "canDownload",
  s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt", s.created_at AS "createdAt",
  s.last_used_at AS "lastUsedAt", s.use_count AS "useCount",
  s.created_by AS "createdBy", u.name AS "creatorName",
  s.file_id AS "fileId", f.name AS "fileName",
  s.folder_id AS "folderId", d.name AS "folderName"`;

/**
 * Shares this member is allowed to see. RLS decides that: the creator always,
 * plus the uploader or a lead for shares on TEAM material. A lead never sees a
 * share of somebody's personal file that they did not create themselves.
 */
export async function listShares(
  client: PoolClient,
  input: { orgId: string; fileId?: string | null; includeRevoked?: boolean },
): Promise<DriveShare[]> {
  const result = await client.query<ShareRow>(
    `SELECT ${SHARE_COLUMNS}
       FROM drive_shares s
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN drive_files f ON f.id = s.file_id
       LEFT JOIN drive_folders d ON d.id = s.folder_id
      WHERE s.org_id = $1::uuid
        AND ($2::uuid IS NULL OR s.file_id = $2::uuid)
        AND ($3::boolean OR s.revoked_at IS NULL)
      ORDER BY s.created_at DESC
      LIMIT 200`,
    [input.orgId, input.fileId ?? null, input.includeRevoked ?? false],
  );
  return result.rows.map(toDriveShare);
}

export async function createShare(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    fileId: string | null;
    folderId: string | null;
    kind: "link" | "email";
    email: string | null;
    note: string | null;
    canDownload: boolean;
    expiresAt: string | null;
    token: string;
  },
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO drive_shares
       (org_id, file_id, folder_id, kind, email, token_hash, note, can_download, expires_at, created_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::timestamptz, $10::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.fileId,
      input.folderId,
      input.kind,
      input.email,
      hashDriveShareToken(input.token),
      input.note,
      input.canDownload,
      input.expiresAt,
      input.userId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function revokeShare(
  client: PoolClient,
  input: { orgId: string; shareId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drive_shares SET revoked_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
    [input.shareId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * "Shared with me": live email shares addressed to the signed-in user's own
 * address.
 *
 * This goes through the SECURITY DEFINER `list_drive_shares_for_me()` for a
 * reason worth spelling out. The RLS policies on drive_shares are written from
 * the SENDER's side (creator, uploader, lead); a recipient may not even be a
 * member of the sending org, so without the function a share addressed to you
 * would be invisible to you. The function takes NO email argument — it reads
 * the address from `current_app_user_id()`, so this cannot be turned into a
 * way to list somebody else's shares by naming their address.
 */
export async function listSharedWithMe(client: PoolClient): Promise<DriveSharedWithMe[]> {
  const result = await client.query<{
    share_id: string;
    note: string | null;
    can_download: boolean;
    expires_at: string | null;
    shared_at: string;
    shared_by_name: string | null;
    org_name: string;
    file_id: string | null;
    file_name: string | null;
    folder_id: string | null;
    folder_name: string | null;
  }>(`SELECT * FROM list_drive_shares_for_me()`);
  return result.rows.map((row) => ({
    shareId: row.share_id,
    note: row.note,
    canDownload: row.can_download,
    expiresAt: row.expires_at,
    sharedAt: row.shared_at,
    sharedByName: row.shared_by_name,
    orgName: row.org_name,
    target: row.file_id
      ? { kind: "file", id: row.file_id, name: row.file_name ?? "(file removed)" }
      : { kind: "folder", id: row.folder_id ?? "", name: row.folder_name ?? "(folder removed)" },
    href: `/files?tab=shared&share=${row.share_id}`,
  }));
}

export type SharedWithMeFile = {
  id: string;
  name: string;
  contentType: string;
  contentClass: StorageContentClass;
  byteSize: number;
  createdAt: string;
};

/** The files one "shared with me" grant actually covers. */
export async function listSharedWithMeFiles(
  client: PoolClient,
  shareId: string,
): Promise<SharedWithMeFile[]> {
  const result = await client.query<{
    file_id: string;
    name: string;
    content_type: string;
    content_class: StorageContentClass;
    byte_size: string;
    created_at: string;
  }>(`SELECT * FROM list_drive_share_files_for_me($1::uuid)`, [shareId]);
  return result.rows.map((row) => ({
    id: row.file_id,
    name: row.name,
    contentType: row.content_type,
    contentClass: row.content_class,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
  }));
}

/** One file from a share addressed to me, for the authenticated download. */
export async function loadSharedWithMeFile(
  client: PoolClient,
  input: { shareId: string; fileId: string },
): Promise<(DriveFileContent & { orgId: string; canDownload: boolean }) | null> {
  const result = await client.query<{
    org_id: string;
    file_id: string;
    name: string;
    content_type: string;
    byte_size: string;
    storage_location: DriveStorageLocation;
    bytes: Buffer | null;
    node_item_id: string | null;
    object_key: string | null;
    can_download: boolean;
  }>(`SELECT * FROM resolve_drive_share_file_for_me($1::uuid, $2::uuid)`, [
    input.shareId,
    input.fileId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orgId: row.org_id,
    id: row.file_id,
    name: row.name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    storageLocation: row.storage_location,
    status: "ready",
    bytes: row.bytes,
    nodeItemId: row.node_item_id,
    objectKey: row.object_key,
    canDownload: row.can_download,
  };
}
