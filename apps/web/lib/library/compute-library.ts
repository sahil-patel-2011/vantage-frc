/**
 * Server-side view + write helpers for the Team Library. All queries run on
 * the RLS-scoped PoolClient handed in by the caller's withRls transaction —
 * so every read already reflects the sharing rules (team-wide vs restricted)
 * and every write is bounded by the 0489 policies.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { classifyResourceType } from "./library-filters";
import type {
  LibraryFolder,
  LibraryAttachedLink,
  LibraryMember,
  LibraryResource,
  LibraryStorageLocation,
  LibraryView,
  LibraryVisibility,
} from "./types";
import { isInlinePreviewable, type FileMetadata } from "./validation";
import { canManageItem } from "./visibility";

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

type FolderRow = {
  id: string;
  parentId: string | null;
  name: string;
  visibility: LibraryVisibility;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

type ResourceRow = {
  id: string;
  folderId: string | null;
  kind: "file" | "link";
  title: string;
  notes: string | null;
  tags: string[];
  visibility: LibraryVisibility;
  url: string | null;
  fileName: string | null;
  contentType: string | null;
  byteSize: number | null;
  storageLocation: LibraryStorageLocation | null;
  status: "pending" | "ready";
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

type LinkRow = {
  id: string;
  resourceId: string;
  title: string;
  url: string;
  notes: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

export async function computeLibraryView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<LibraryView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to open your team library.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }
  const { orgId } = org;
  const orgQuery = `orgId=${encodeURIComponent(orgId)}`;

  const foldersResult = await client.query<FolderRow>(
    `SELECT f.id, f.parent_id AS "parentId", f.name, f.visibility,
            f.created_by AS "createdBy", u.name AS "createdByName",
            f.created_at::text AS "createdAt"
     FROM library_folders f
     LEFT JOIN users u ON u.id = f.created_by
     WHERE f.org_id = $1::uuid
     ORDER BY lower(f.name)`,
    [orgId],
  );
  const resourcesResult = await client.query<ResourceRow>(
    `SELECT r.id, r.folder_id AS "folderId", r.kind, r.title, r.notes, r.tags,
            r.visibility, r.url, r.file_name AS "fileName",
            r.content_type AS "contentType", r.byte_size::float8 AS "byteSize",
            r.storage_location AS "storageLocation", r.status,
            r.created_by AS "createdBy", u.name AS "createdByName",
            r.created_at::text AS "createdAt"
     FROM library_resources r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.org_id = $1::uuid
     ORDER BY r.created_at DESC`,
    [orgId],
  );
  const linksResult = await client.query<LinkRow>(
    `SELECT l.id, l.resource_id AS "resourceId", l.title, l.url, l.notes,
            l.created_by AS "createdBy", u.name AS "createdByName",
            l.created_at::text AS "createdAt"
     FROM library_resource_links l
     LEFT JOIN users u ON u.id = l.created_by
     WHERE l.org_id = $1::uuid
     ORDER BY l.created_at`,
    [orgId],
  );
  // Grant rows are RLS-filtered: managers see the full list for their items;
  // a merely-granted viewer sees only their own row (enough to prove access).
  const resourceGrantsResult = await client.query<{ resourceId: string; userId: string }>(
    `SELECT resource_id AS "resourceId", user_id AS "userId"
     FROM library_resource_grants WHERE org_id = $1::uuid`,
    [orgId],
  );
  const folderGrantsResult = await client.query<{ folderId: string; userId: string }>(
    `SELECT folder_id AS "folderId", user_id AS "userId"
     FROM library_folder_grants WHERE org_id = $1::uuid`,
    [orgId],
  );
  const membersResult = await client.query<LibraryMember>(
    `SELECT m.user_id AS "id", u.name
     FROM memberships m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY lower(COALESCE(u.name, ''))`,
    [orgId],
  );

  const resourceGrants = new Map<string, string[]>();
  for (const row of resourceGrantsResult.rows) {
    const list = resourceGrants.get(row.resourceId);
    if (list) list.push(row.userId);
    else resourceGrants.set(row.resourceId, [row.userId]);
  }
  const folderGrants = new Map<string, string[]>();
  for (const row of folderGrantsResult.rows) {
    const list = folderGrants.get(row.folderId);
    if (list) list.push(row.userId);
    else folderGrants.set(row.folderId, [row.userId]);
  }
  const linksByResource = new Map<string, LibraryAttachedLink[]>();
  for (const row of linksResult.rows) {
    const link: LibraryAttachedLink = {
      id: row.id,
      resourceId: row.resourceId,
      title: row.title,
      url: row.url,
      notes: row.notes,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      canRemove: row.createdBy === input.userId || org.role === "owner" || org.role === "admin",
      createdAt: row.createdAt,
    };
    const list = linksByResource.get(row.resourceId);
    if (list) list.push(link);
    else linksByResource.set(row.resourceId, [link]);
  }

  const folders: LibraryFolder[] = foldersResult.rows.map((row) => {
    const canManage = canManageItem(row.createdBy, input.userId, org.role);
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      visibility: row.visibility,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      canManage,
      grantedUserIds: canManage ? (folderGrants.get(row.id) ?? []) : null,
      createdAt: row.createdAt,
    };
  });

  const resources: LibraryResource[] = resourcesResult.rows.map((row) => {
    const canManage = canManageItem(row.createdBy, input.userId, org.role);
    const isReadyFile = row.kind === "file" && row.status === "ready";
    const src = row.kind === "file" ? `/api/library/items/${row.id}?${orgQuery}` : null;
    return {
      id: row.id,
      folderId: row.folderId,
      kind: row.kind,
      type: classifyResourceType(row.kind, row.contentType, row.fileName),
      title: row.title,
      notes: row.notes,
      tags: row.tags ?? [],
      visibility: row.visibility,
      url: row.url,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: row.byteSize,
      storageLocation: row.storageLocation,
      status: row.status,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      canManage,
      grantedUserIds: canManage ? (resourceGrants.get(row.id) ?? []) : null,
      links: linksByResource.get(row.id) ?? [],
      createdAt: row.createdAt,
      src,
      previewSrc:
        isReadyFile && isInlinePreviewable(row.contentType) ? `${src}&inline=1` : null,
    };
  });

  return {
    status: "live",
    orgId,
    teamNumber: org.teamNumber,
    viewerId: input.userId,
    viewerRole: org.role,
    folders,
    resources,
    members: membersResult.rows,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

function friendlySqlError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("library_folders_sibling_name_idx")) {
    return new Error("A folder with that name already exists here.");
  }
  if (message.includes("create a loop") || message.includes("folder cycle")) {
    return new Error("That move would put a folder inside itself.");
  }
  if (message.includes("nesting is too deep")) {
    return new Error("Folder nesting is too deep (max 100 levels).");
  }
  if (message.includes("your team's own space")) {
    return new Error("You do not have access to do that.");
  }
  return new Error(fallback);
}

async function replaceGrants(
  client: PoolClient,
  table: "library_resource_grants" | "library_folder_grants",
  idColumn: "resource_id" | "folder_id",
  input: { orgId: string; userId: string; itemId: string; grantUserIds: string[] },
): Promise<void> {
  // The tables/columns are compile-time constants above; every value is a
  // bound parameter.
  await client.query(
    `DELETE FROM ${table}
     WHERE ${idColumn} = $1::uuid AND org_id = $2::uuid
       AND user_id <> ALL($3::uuid[])`,
    [input.itemId, input.orgId, input.grantUserIds],
  );
  for (const grantee of input.grantUserIds) {
    if (grantee === input.userId) continue; // creators always see their own items
    await client.query(
      `INSERT INTO ${table} (${idColumn}, user_id, org_id, granted_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
       ON CONFLICT DO NOTHING`,
      [input.itemId, grantee, input.orgId, input.userId],
    );
  }
}

export async function createFolder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    parentId: string | null;
    visibility: LibraryVisibility;
    grantUserIds: string[];
  },
): Promise<string> {
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO library_folders (org_id, parent_id, name, visibility, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
       RETURNING id`,
      [input.orgId, input.parentId, input.name, input.visibility, input.userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Folder could not be created");
    if (input.visibility === "restricted" && input.grantUserIds.length) {
      await replaceGrants(client, "library_folder_grants", "folder_id", {
        orgId: input.orgId,
        userId: input.userId,
        itemId: row.id,
        grantUserIds: input.grantUserIds,
      });
    }
    return row.id;
  } catch (error) {
    throw friendlySqlError(error, "Folder could not be created.");
  }
}

export async function updateFolder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    folderId: string;
    name?: string;
    parentId?: string | null;
    visibility?: LibraryVisibility;
    grantUserIds?: string[];
  },
): Promise<boolean> {
  try {
    const result = await client.query(
      `UPDATE library_folders SET
         name = COALESCE($3, name),
         parent_id = CASE WHEN $4 THEN $5::uuid ELSE parent_id END,
         visibility = COALESCE($6, visibility),
         updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [
        input.folderId, input.orgId,
        input.name ?? null,
        input.parentId !== undefined, input.parentId ?? null,
        input.visibility ?? null,
      ],
    );
    if (!(result.rowCount ?? 0)) return false;
    if (input.visibility === "team") {
      await client.query(
        `DELETE FROM library_folder_grants WHERE folder_id = $1::uuid AND org_id = $2::uuid`,
        [input.folderId, input.orgId],
      );
    } else if (input.grantUserIds !== undefined) {
      await replaceGrants(client, "library_folder_grants", "folder_id", {
        orgId: input.orgId,
        userId: input.userId,
        itemId: input.folderId,
        grantUserIds: input.grantUserIds,
      });
    }
    return true;
  } catch (error) {
    throw friendlySqlError(error, "Folder could not be updated.");
  }
}

/** RLS limits deletes to the creator or an owner/admin; 0 rows = denied/missing. */
export async function deleteFolder(
  client: PoolClient,
  input: { orgId: string; folderId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM library_folders WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.folderId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createFileResource(
  client: PoolClient,
  input: { orgId: string; userId: string; metadata: FileMetadata },
): Promise<{ resourceId: string; duplicate: boolean }> {
  const m = input.metadata;
  // Soft dedupe among rows the uploader can SEE — a restricted copy someone
  // else holds is invisible here, and uploading again is then correct.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM library_resources
     WHERE org_id = $1::uuid AND kind = 'file' AND sha256 = $2 AND status = 'ready'
     LIMIT 1`,
    [input.orgId, m.sha256],
  );
  const duplicate = existing.rows[0];
  if (duplicate) return { resourceId: duplicate.id, duplicate: true };

  const result = await client.query<{ id: string }>(
    `INSERT INTO library_resources (
       org_id, folder_id, kind, title, notes, tags, visibility,
       file_name, content_type, storage_location, byte_size, sha256, status, created_by
     ) VALUES ($1::uuid, $2::uuid, 'file', $3, $4, $5::text[], $6,
       $7, $8, 'db', $9, $10, 'pending', $11::uuid)
     RETURNING id`,
    [
      input.orgId, m.folderId, m.title, m.notes, m.tags, m.visibility,
      m.fileName, m.contentType, m.byteSize, m.sha256, input.userId,
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error("Upload could not be registered");
  if (m.visibility === "restricted" && m.grantUserIds.length) {
    await replaceGrants(client, "library_resource_grants", "resource_id", {
      orgId: input.orgId,
      userId: input.userId,
      itemId: inserted.id,
      grantUserIds: m.grantUserIds,
    });
  }
  return { resourceId: inserted.id, duplicate: false };
}

export async function createLinkResource(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    url: string;
    notes: string | null;
    folderId: string | null;
    tags: string[];
    visibility: LibraryVisibility;
    grantUserIds: string[];
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO library_resources (
       org_id, folder_id, kind, title, notes, tags, visibility, url, status, created_by
     ) VALUES ($1::uuid, $2::uuid, 'link', $3, $4, $5::text[], $6, $7, 'ready', $8::uuid)
     RETURNING id`,
    [input.orgId, input.folderId, input.title, input.notes, input.tags, input.visibility, input.url, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Link could not be added");
  if (input.visibility === "restricted" && input.grantUserIds.length) {
    await replaceGrants(client, "library_resource_grants", "resource_id", {
      orgId: input.orgId,
      userId: input.userId,
      itemId: row.id,
      grantUserIds: input.grantUserIds,
    });
  }
  return row.id;
}

export async function updateResource(
  client: PoolClient,
  input: {
    orgId: string;
    resourceId: string;
    title?: string;
    notes?: string | null;
    tags?: string[];
    folderId?: string | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE library_resources SET
       title = COALESCE($3, title),
       notes = CASE WHEN $4 THEN $5 ELSE notes END,
       tags = COALESCE($6::text[], tags),
       folder_id = CASE WHEN $7 THEN $8::uuid ELSE folder_id END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.resourceId, input.orgId,
      input.title ?? null,
      input.notes !== undefined, input.notes ?? null,
      input.tags ?? null,
      input.folderId !== undefined, input.folderId ?? null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setResourceSharing(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    resourceId: string;
    visibility: LibraryVisibility;
    grantUserIds: string[];
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE library_resources SET visibility = $3, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.resourceId, input.orgId, input.visibility],
  );
  if (!(result.rowCount ?? 0)) return false;
  if (input.visibility === "team") {
    await client.query(
      `DELETE FROM library_resource_grants WHERE resource_id = $1::uuid AND org_id = $2::uuid`,
      [input.resourceId, input.orgId],
    );
  } else {
    await replaceGrants(client, "library_resource_grants", "resource_id", {
      orgId: input.orgId,
      userId: input.userId,
      itemId: input.resourceId,
      grantUserIds: input.grantUserIds,
    });
  }
  return true;
}

/** RLS limits deletes to the creator or an owner/admin; 0 rows = denied/missing. */
export async function deleteResource(
  client: PoolClient,
  input: { orgId: string; resourceId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM library_resources WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.resourceId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addResourceLink(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    resourceId: string;
    title: string;
    url: string;
    notes: string | null;
  },
): Promise<string> {
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO library_resource_links (org_id, resource_id, title, url, notes, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
       RETURNING id`,
      [input.orgId, input.resourceId, input.title, input.url, input.notes, input.userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Link could not be attached");
    return row.id;
  } catch (error) {
    throw friendlySqlError(error, "Link could not be attached.");
  }
}

export async function deleteResourceLink(
  client: PoolClient,
  input: { orgId: string; linkId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM library_resource_links WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.linkId, input.orgId],
  );
  return (result.rowCount ?? 0) > 0;
}
