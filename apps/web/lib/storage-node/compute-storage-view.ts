// Storage-node view computation. Runs on the caller's withRls PoolClient with raw
// parameterized SQL only. Honesty: liveness is derived from last_heartbeat_at (>5 min gap =
// degraded, >30 min = offline); disk numbers are NULL until the node's first heartbeat and are
// surfaced as "unknown" rather than invented; item availability reflects the node's own scrub.

import type { PoolClient } from "@neondatabase/serverless";
import { nodeLiveness, type NodeLiveness } from ".";

export type StorageSetupStep = { id: string; label: string; detail: string; href: string };

export type StorageNodeCard = {
  id: string;
  name: string;
  liveness: NodeLiveness;
  lastHeartbeatAt: string | null;
  baseUrl: string | null;
  lanAddresses: string[];
  nodeVersion: string | null;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  itemCount: number;
  missingCount: number;
  storedBytes: number;
  pairedAt: string;
  canManage: boolean;
};

export type StorageItemRow = {
  id: string;
  nodeId: string;
  nodeName: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  status: "stored" | "missing";
  verifiedAt: string | null;
  createdAt: string;
};

export type StorageNodeSummary = {
  nodeCount: number;
  onlineCount: number;
  itemCount: number;
  missingCount: number;
  storedBytes: number;
};

export type StorageNodeViewData =
  | { status: "setup_required"; message: string; steps: StorageSetupStep[]; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      nodes: StorageNodeCard[];
      recentItems: StorageItemRow[];
      summary: StorageNodeSummary;
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role
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

export async function computeStorageNodeView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; now?: Date },
): Promise<StorageNodeViewData> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to manage self-hosted storage.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const canManage = org.role === "owner" || org.role === "admin";

  const [nodeResult, itemResult] = await Promise.all([
    client.query<{
      id: string;
      name: string;
      pairedBy: string;
      baseUrl: string | null;
      lanAddresses: string[];
      nodeVersion: string | null;
      lastHeartbeatAt: string | null;
      diskTotalBytes: string | null;
      diskFreeBytes: string | null;
      itemCount: string;
      missingCount: string;
      storedBytes: string;
      createdAt: string;
    }>(
      `SELECT n.id, n.name, n.paired_by AS "pairedBy", n.base_url AS "baseUrl",
              n.lan_addresses AS "lanAddresses", n.node_version AS "nodeVersion",
              n.last_heartbeat_at AS "lastHeartbeatAt",
              n.disk_total_bytes::text AS "diskTotalBytes", n.disk_free_bytes::text AS "diskFreeBytes",
              COUNT(i.id)::text AS "itemCount",
              COUNT(i.id) FILTER (WHERE i.status = 'missing')::text AS "missingCount",
              COALESCE(SUM(i.byte_size) FILTER (WHERE i.status = 'stored'), 0)::text AS "storedBytes",
              n.created_at AS "createdAt"
       FROM storage_nodes n
       LEFT JOIN storage_node_items i ON i.node_id = n.id
       WHERE n.org_id = $1::uuid AND n.revoked_at IS NULL
       GROUP BY n.id
       ORDER BY n.created_at`,
      [org.orgId],
    ),
    client.query<{
      id: string;
      nodeId: string;
      nodeName: string;
      sha256: string;
      byteSize: string;
      contentType: string;
      status: "stored" | "missing";
      verifiedAt: string | null;
      createdAt: string;
    }>(
      `SELECT i.id, i.node_id AS "nodeId", n.name AS "nodeName", i.sha256,
              i.byte_size::text AS "byteSize", i.content_type AS "contentType",
              i.status, i.verified_at AS "verifiedAt", i.created_at AS "createdAt"
       FROM storage_node_items i
       JOIN storage_nodes n ON n.id = i.node_id
       WHERE i.org_id = $1::uuid AND n.revoked_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
  ]);

  const nodes: StorageNodeCard[] = nodeResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    liveness: nodeLiveness(row.lastHeartbeatAt, nowMs),
    lastHeartbeatAt: row.lastHeartbeatAt,
    baseUrl: row.baseUrl,
    lanAddresses: row.lanAddresses ?? [],
    nodeVersion: row.nodeVersion,
    diskTotalBytes: row.diskTotalBytes == null ? null : Number(row.diskTotalBytes),
    diskFreeBytes: row.diskFreeBytes == null ? null : Number(row.diskFreeBytes),
    itemCount: Number(row.itemCount),
    missingCount: Number(row.missingCount),
    storedBytes: Number(row.storedBytes),
    pairedAt: row.createdAt,
    canManage: canManage || row.pairedBy === input.userId,
  }));

  const summary: StorageNodeSummary = {
    nodeCount: nodes.length,
    onlineCount: nodes.filter((node) => node.liveness === "online").length,
    itemCount: nodes.reduce((total, node) => total + node.itemCount, 0),
    missingCount: nodes.reduce((total, node) => total + node.missingCount, 0),
    storedBytes: nodes.reduce((total, node) => total + node.storedBytes, 0),
  };

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    nodes,
    recentItems: itemResult.rows.map((row) => ({
      id: row.id,
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      sha256: row.sha256,
      byteSize: Number(row.byteSize),
      contentType: row.contentType,
      status: row.status,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
    })),
    summary,
    computedAt: new Date(nowMs).toISOString(),
  };
}
