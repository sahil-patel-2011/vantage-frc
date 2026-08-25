// Storage-node item metadata routes — what the media library (or any feature storing large
// binaries off-database) consumes:
//   register-item : record that <sha256> was uploaded to a node (metadata only; bytes never
//                   touch the hosted database).
//   resolve-item  : turn a sha256 into something fetchable. HONESTY CONTRACT: if the node has
//                   no reachable base URL, the cloud CANNOT proxy to a NATed device — the
//                   response says status "node-unreachable" with the reason and any same-LAN
//                   hints, and callers must surface that plainly ("stored on <node>, currently
//                   unreachable — last seen <time>"). Nothing here fakes availability.
//   remove-item   : drop the metadata row (the node's own DELETE endpoint removes bytes).

import { auth } from "@vantage/core";
import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isValidSha256, nodeLiveness, type NodeLiveness } from "../../../../lib/storage-node";

export type ResolveItemResult =
  | {
      status: "ok";
      url: string;
      accessKey: string;
      node: { id: string; name: string; liveness: NodeLiveness; lastHeartbeatAt: string | null };
    }
  | {
      status: "node-unreachable";
      reason: "offline" | "no-public-url";
      message: string;
      lanUrls: string[];
      node: { id: string; name: string; liveness: NodeLiveness; lastHeartbeatAt: string | null };
    }
  | { status: "missing-on-node"; message: string; node: { id: string; name: string } }
  | { status: "not-found"; message: string };

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!isValidSha256(sha256)) return Response.json({ error: "sha256 must be 64 lowercase hex characters" }, { status: 400 });

  const userId = session.user.id;
  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      if (action === "register-item") {
        const nodeId = trimmedOrNull(body.nodeId, 64);
        if (!nodeId) throw new Error("nodeId is required");
        const byteSize = Number(body.byteSize);
        if (!Number.isFinite(byteSize) || byteSize < 0) throw new Error("byteSize must be a non-negative number");
        const contentType = trimmedOrNull(body.contentType, 200) ?? "application/octet-stream";
        const node = await client.query(
          `SELECT 1 FROM storage_nodes WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
          [nodeId, orgId],
        );
        if (!node.rowCount) throw new Error("Storage node not found in this organization (or it was unpaired)");
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO storage_node_items(org_id, node_id, sha256, byte_size, content_type, status, verified_at, created_by)
           VALUES($1::uuid, $2::uuid, $3, $4::bigint, $5, 'stored', now(), $6)
           ON CONFLICT (node_id, sha256)
           DO UPDATE SET status = 'stored', verified_at = now(), byte_size = EXCLUDED.byte_size, content_type = EXCLUDED.content_type
           RETURNING id`,
          [orgId, nodeId, sha256, String(Math.round(byteSize)), contentType, userId],
        );
        return { status: "registered", itemId: inserted.rows[0]!.id, sha256 };
      }

      if (action === "remove-item") {
        const nodeId = trimmedOrNull(body.nodeId, 64);
        if (!nodeId) throw new Error("nodeId is required");
        const deleted = await client.query(
          `DELETE FROM storage_node_items WHERE org_id = $1::uuid AND node_id = $2::uuid AND sha256 = $3`,
          [orgId, nodeId, sha256],
        );
        return { status: "removed", removed: deleted.rowCount ?? 0 };
      }

      if (action === "resolve-item") {
        const rows = await client.query<{
          itemStatus: "stored" | "missing";
          nodeId: string;
          nodeName: string;
          baseUrl: string | null;
          lanAddresses: string[];
          lastHeartbeatAt: string | null;
          encryptedAccessKey: string | null;
        }>(
          `SELECT i.status AS "itemStatus", n.id AS "nodeId", n.name AS "nodeName", n.base_url AS "baseUrl",
                  n.lan_addresses AS "lanAddresses", n.last_heartbeat_at AS "lastHeartbeatAt",
                  n.encrypted_access_key AS "encryptedAccessKey"
           FROM storage_node_items i
           JOIN storage_nodes n ON n.id = i.node_id
           WHERE i.org_id = $1::uuid AND i.sha256 = $2 AND n.revoked_at IS NULL
           ORDER BY (i.status = 'stored') DESC, (n.base_url IS NOT NULL) DESC, n.last_heartbeat_at DESC NULLS LAST
           LIMIT 1`,
          [orgId, sha256],
        );
        const row = rows.rows[0];
        if (!row) {
          return { status: "not-found", message: "No storage node in this team has this item registered." } satisfies ResolveItemResult;
        }
        const nowMs = Date.now();
        const liveness = nodeLiveness(row.lastHeartbeatAt, nowMs);
        const node = { id: row.nodeId, name: row.nodeName, liveness, lastHeartbeatAt: row.lastHeartbeatAt };
        if (row.itemStatus === "missing") {
          return {
            status: "missing-on-node",
            message: `"${row.nodeName}" reported this item is no longer on its disk. Re-upload it to store it again.`,
            node: { id: row.nodeId, name: row.nodeName },
          } satisfies ResolveItemResult;
        }
        const lanUrls = (row.lanAddresses ?? []).map((base) => `${base.replace(/\/+$/, "")}/items/${sha256}`);
        if (!row.baseUrl) {
          return {
            status: "node-unreachable",
            reason: "no-public-url",
            message:
              `Stored on "${row.nodeName}", but the node has no reachable URL configured, so it cannot be fetched from here. ` +
              `On the node's own network the LAN address may work; for access from anywhere, set a public URL (Tailscale Funnel or cloudflared) on /team/storage.`,
            lanUrls,
            node,
          } satisfies ResolveItemResult;
        }
        if (liveness === "offline" || liveness === "never") {
          return {
            status: "node-unreachable",
            reason: "offline",
            message: `Stored on "${row.nodeName}", currently unreachable — last heartbeat ${
              row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : "never received"
            }.`,
            lanUrls,
            node,
          } satisfies ResolveItemResult;
        }
        if (!row.encryptedAccessKey) {
          return {
            status: "node-unreachable",
            reason: "no-public-url",
            message: `"${row.nodeName}" was paired without an access key (an old pairing). Re-pair the node to enable fetching.`,
            lanUrls,
            node,
          } satisfies ResolveItemResult;
        }
        const accessKey = await decryptSecret(JSON.parse(row.encryptedAccessKey) as EncryptedSecret, createKms());
        return {
          status: "ok",
          url: `${row.baseUrl.replace(/\/+$/, "")}/items/${sha256}`,
          accessKey,
          node,
        } satisfies ResolveItemResult;
      }

      throw new Error("Unknown action");
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage item request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json({ error: message === "forbidden" ? "Organization access denied" : message }, { status });
  }
}
