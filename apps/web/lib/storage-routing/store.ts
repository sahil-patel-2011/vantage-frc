/**
 * Storage-routing data access. Runs on the caller's withRls PoolClient with
 * raw parameterized SQL only — RLS (0483/0484/0489/0492) is the security
 * model. Server-only: imported by API routes, never by client components.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { nodeLiveness } from "../storage-node";
import { normalizeRoutingPolicy } from "./policy";
import type { CandidateNode, StorageRoutingPolicy, StorageUsage } from "./types";

export async function loadRoutingPolicy(
  client: PoolClient,
  orgId: string,
): Promise<{ policy: StorageRoutingPolicy; customized: boolean }> {
  const result = await client.query<{
    nodeThresholdBytes: string;
    preferNodeClasses: string[];
    cloudFallback: boolean;
  }>(
    `SELECT node_threshold_bytes::text AS "nodeThresholdBytes",
            prefer_node_classes AS "preferNodeClasses",
            cloud_fallback AS "cloudFallback"
     FROM storage_routing_policies
     WHERE org_id = $1::uuid
     LIMIT 1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return { policy: normalizeRoutingPolicy(null), customized: false };
  return {
    policy: normalizeRoutingPolicy({
      nodeThresholdBytes: Number(row.nodeThresholdBytes),
      preferNodeClasses: row.preferNodeClasses,
      cloudFallback: row.cloudFallback,
    }),
    customized: true,
  };
}

/** Upsert the org policy. RLS restricts this to owners/admins. */
export async function saveRoutingPolicy(
  client: PoolClient,
  input: { orgId: string; userId: string; policy: StorageRoutingPolicy },
): Promise<void> {
  await client.query(
    `INSERT INTO storage_routing_policies (org_id, node_threshold_bytes, prefer_node_classes, cloud_fallback, updated_by)
     VALUES ($1::uuid, $2::bigint, $3::text[], $4, $5::uuid)
     ON CONFLICT (org_id) DO UPDATE SET
       node_threshold_bytes = EXCLUDED.node_threshold_bytes,
       prefer_node_classes = EXCLUDED.prefer_node_classes,
       cloud_fallback = EXCLUDED.cloud_fallback,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      String(input.policy.nodeThresholdBytes),
      input.policy.preferNodeClasses,
      input.policy.cloudFallback,
      input.userId,
    ],
  );
}

/**
 * The org's best upload candidate node, honestly described. Preference order:
 * reachable URL first, then freshest heartbeat. Returns null when no node is
 * paired at all.
 */
export async function loadCandidateNode(
  client: PoolClient,
  orgId: string,
  nowMs: number,
): Promise<CandidateNode | null> {
  const result = await client.query<{
    id: string;
    name: string;
    baseUrl: string | null;
    lastHeartbeatAt: string | null;
    diskFreeBytes: string | null;
    diskTotalBytes: string | null;
  }>(
    `SELECT id, name, base_url AS "baseUrl", last_heartbeat_at AS "lastHeartbeatAt",
            disk_free_bytes::text AS "diskFreeBytes", disk_total_bytes::text AS "diskTotalBytes"
     FROM storage_nodes
     WHERE org_id = $1::uuid AND revoked_at IS NULL
     ORDER BY (base_url IS NOT NULL) DESC, last_heartbeat_at DESC NULLS LAST
     LIMIT 1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    liveness: nodeLiveness(row.lastHeartbeatAt, nowMs),
    lastHeartbeatAt: row.lastHeartbeatAt,
    baseUrl: row.baseUrl,
    diskFreeBytes: row.diskFreeBytes == null ? null : Number(row.diskFreeBytes),
    diskTotalBytes: row.diskTotalBytes == null ? null : Number(row.diskTotalBytes),
  };
}

/** Real per-location usage: library + media db rows vs. node-registered rows. */
export async function loadStorageUsage(client: PoolClient, orgId: string): Promise<StorageUsage> {
  const result = await client.query<{
    libDbBytes: string; libDbCount: string;
    mediaDbBytes: string; mediaDbCount: string;
    nodeBytes: string; nodeCount: string;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(byte_size), 0) FROM library_resources
         WHERE org_id = $1::uuid AND kind = 'file' AND storage_location = 'db' AND status = 'ready')::text AS "libDbBytes",
       (SELECT COUNT(*) FROM library_resources
         WHERE org_id = $1::uuid AND kind = 'file' AND storage_location = 'db' AND status = 'ready')::text AS "libDbCount",
       (SELECT COALESCE(SUM(byte_size), 0) FROM media_items
         WHERE org_id = $1::uuid AND storage_location = 'db' AND status = 'ready')::text AS "mediaDbBytes",
       (SELECT COUNT(*) FROM media_items
         WHERE org_id = $1::uuid AND storage_location = 'db' AND status = 'ready')::text AS "mediaDbCount",
       (SELECT COALESCE(SUM(i.byte_size), 0) FROM storage_node_items i
         JOIN storage_nodes n ON n.id = i.node_id
         WHERE i.org_id = $1::uuid AND i.status = 'stored' AND n.revoked_at IS NULL)::text AS "nodeBytes",
       (SELECT COUNT(*) FROM storage_node_items i
         JOIN storage_nodes n ON n.id = i.node_id
         WHERE i.org_id = $1::uuid AND i.status = 'stored' AND n.revoked_at IS NULL)::text AS "nodeCount"`,
    [orgId],
  );
  const row = result.rows[0]!;
  return {
    cloudBytes: Number(row.libDbBytes) + Number(row.mediaDbBytes),
    cloudItemCount: Number(row.libDbCount) + Number(row.mediaDbCount),
    nodeBytes: Number(row.nodeBytes),
    nodeItemCount: Number(row.nodeCount),
  };
}

/**
 * Register (or reuse) the node-side item row for one sha256. Created honestly
 * as status='missing' with verified_at NULL — the bytes are NOT on the node
 * yet; finalize flips it to 'stored' and the node's own scrub then confirms.
 * If the node already holds this sha (content-addressed), the existing
 * 'stored' row is reused and no upload is needed.
 */
export async function upsertNodeItem(
  client: PoolClient,
  input: {
    orgId: string;
    nodeId: string;
    sha256: string;
    byteSize: number;
    contentType: string;
    userId: string;
  },
): Promise<{ nodeItemId: string; alreadyStored: boolean }> {
  const result = await client.query<{ id: string; status: "stored" | "missing" }>(
    `INSERT INTO storage_node_items(org_id, node_id, sha256, byte_size, content_type, status, verified_at, created_by)
     VALUES($1::uuid, $2::uuid, $3, $4::bigint, $5, 'missing', NULL, $6::uuid)
     ON CONFLICT (node_id, sha256)
     DO UPDATE SET content_type = EXCLUDED.content_type
     RETURNING id, status`,
    [input.orgId, input.nodeId, input.sha256, String(Math.round(input.byteSize)), input.contentType, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Could not register the item on the storage node");
  return { nodeItemId: row.id, alreadyStored: row.status === "stored" };
}

export type NodeLibraryCreate = {
  orgId: string;
  userId: string;
  nodeItemId: string;
  title: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  folderId: string | null;
  notes: string | null;
  tags: string[];
  visibility: "team" | "restricted";
  alreadyStored: boolean;
};

/**
 * Create (or reuse) the library metadata row for a node-hosted file. Mirrors
 * createFileResource (compute-library.ts) but with storage_location='node';
 * bytes never touch this table.
 */
export async function createNodeLibraryResource(
  client: PoolClient,
  input: NodeLibraryCreate,
): Promise<{ resourceId: string; duplicate: boolean }> {
  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM library_resources
     WHERE org_id = $1::uuid AND kind = 'file' AND sha256 = $2
     ORDER BY (status = 'ready') DESC
     LIMIT 1`,
    [input.orgId, input.sha256],
  );
  const found = existing.rows[0];
  if (found?.status === "ready") return { resourceId: found.id, duplicate: true };
  if (found) {
    // A pending row for the same sha: reuse it (a resumed or retried upload).
    await client.query(
      `UPDATE library_resources
       SET storage_location = 'node', node_item_id = $3, bytes = NULL,
           status = $4, updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'file'`,
      [found.id, input.orgId, input.nodeItemId, input.alreadyStored ? "ready" : "pending"],
    );
    return { resourceId: found.id, duplicate: false };
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO library_resources (
       org_id, folder_id, kind, title, notes, tags, visibility,
       file_name, content_type, storage_location, node_item_id, byte_size, sha256, status, created_by
     ) VALUES ($1::uuid, $2::uuid, 'file', $3, $4, $5::text[], $6,
       $7, $8, 'node', $9, $10::bigint, $11, $12, $13::uuid)
     RETURNING id`,
    [
      input.orgId, input.folderId, input.title, input.notes, input.tags, input.visibility,
      input.fileName, input.contentType, input.nodeItemId, String(Math.round(input.byteSize)),
      input.sha256, input.alreadyStored ? "ready" : "pending", input.userId,
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error("Upload could not be registered");
  return { resourceId: inserted.id, duplicate: false };
}

export type NodeMediaCreate = {
  orgId: string;
  userId: string;
  nodeItemId: string;
  kind: "photo" | "video";
  title: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  albumId: string | null;
  eventKey: string | null;
  subteam: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  alreadyStored: boolean;
};

/** Media twin of createNodeLibraryResource (mirrors createItemMetadata). */
export async function createNodeMediaItem(
  client: PoolClient,
  input: NodeMediaCreate,
): Promise<{ itemId: string; duplicate: boolean }> {
  const existing = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM media_items WHERE org_id = $1::uuid AND sha256 = $2 LIMIT 1`,
    [input.orgId, input.sha256],
  );
  const found = existing.rows[0];
  if (found?.status === "ready") return { itemId: found.id, duplicate: true };
  if (found) {
    await client.query(
      `UPDATE media_items
       SET storage_location = 'node', node_item_id = $3, bytes = NULL,
           status = $4, updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [found.id, input.orgId, input.nodeItemId, input.alreadyStored ? "ready" : "pending"],
    );
    return { itemId: found.id, duplicate: false };
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO media_items (
       org_id, uploader_id, album_id, kind, title, taken_at, event_key, subteam,
       storage_location, node_item_id, content_type, byte_size, sha256, width, height,
       duration_seconds, status
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::timestamptz, $7, $8,
       'node', $9, $10, $11::bigint, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      input.orgId, input.userId, input.albumId, input.kind, input.title, input.takenAt,
      input.eventKey, input.subteam, input.nodeItemId, input.contentType,
      String(Math.round(input.byteSize)), input.sha256, input.width, input.height,
      input.durationSeconds, input.alreadyStored ? "ready" : "pending",
    ],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error("Upload could not be registered");
  return { itemId: inserted.id, duplicate: false };
}

export async function insertUploadGrant(
  client: PoolClient,
  input: {
    orgId: string;
    nodeId: string;
    // 'drive' was added by migration 0641; Vantage Drive finalizes through its
    // own route rather than finalizeUploadGrant below, so the ledger row is
    // there for the single-use nonce and the audit trail.
    purpose: "library" | "media" | "drive";
    targetId: string;
    sha256: string;
    maxBytes: number;
    contentType: string;
    userId: string;
    expiresAt: Date;
  },
): Promise<{ grantId: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO storage_upload_grants
       (org_id, node_id, purpose, target_id, sha256, max_bytes, content_type, created_by, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::bigint, $7, $8::uuid, $9::timestamptz)
     RETURNING id`,
    [
      input.orgId, input.nodeId, input.purpose, input.targetId, input.sha256,
      String(Math.round(input.maxBytes)), input.contentType, input.userId,
      input.expiresAt.toISOString(),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Could not record the upload grant");
  return { grantId: row.id };
}

export type FinalizeResult =
  | { ok: true; purpose: "library" | "media"; targetId: string }
  | { ok: false; error: string; status: number };

/**
 * The client reports that the node accepted the upload: consume the grant,
 * flip the node item to 'stored' (verified_at stays NULL — the node's own
 * scrub is the source of truth and will confirm within minutes), and mark the
 * feature row ready.
 */
export async function finalizeUploadGrant(
  client: PoolClient,
  input: { orgId: string; grantId: string; userId: string },
): Promise<FinalizeResult> {
  const grantResult = await client.query<{
    id: string;
    nodeId: string;
    purpose: "library" | "media";
    targetId: string;
    sha256: string;
    consumedAt: string | null;
  }>(
    `SELECT id, node_id AS "nodeId", purpose, target_id AS "targetId", sha256,
            consumed_at AS "consumedAt"
     FROM storage_upload_grants
     WHERE id = $1::uuid AND org_id = $2::uuid AND created_by = $3::uuid
     LIMIT 1`,
    [input.grantId, input.orgId, input.userId],
  );
  const grant = grantResult.rows[0];
  if (!grant) return { ok: false, error: "Upload grant not found", status: 404 };
  if (grant.consumedAt) {
    // Idempotent: a retried finalize after a network blip is fine.
    return { ok: true, purpose: grant.purpose, targetId: grant.targetId };
  }

  await client.query(
    `UPDATE storage_upload_grants SET consumed_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [grant.id, input.orgId],
  );
  await client.query(
    `UPDATE storage_node_items SET status = 'stored', verified_at = NULL
     WHERE org_id = $1::uuid AND node_id = $2::uuid AND sha256 = $3`,
    [input.orgId, grant.nodeId, grant.sha256],
  );
  if (grant.purpose === "library") {
    await client.query(
      `UPDATE library_resources SET status = 'ready', updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'file' AND storage_location = 'node'`,
      [grant.targetId, input.orgId],
    );
  } else {
    await client.query(
      `UPDATE media_items SET status = 'ready', updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid AND storage_location = 'node'`,
      [grant.targetId, input.orgId],
    );
  }
  return { ok: true, purpose: grant.purpose, targetId: grant.targetId };
}
