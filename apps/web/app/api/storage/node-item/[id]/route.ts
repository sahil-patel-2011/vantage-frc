// Node-item resolver: turns a storage_node_items id into a redirect the
// browser can actually follow — the node's own URL with a short-lived signed
// GET grant in the query string (browsers cannot attach Authorization headers
// to <video>/<img>/<a download> requests). The bytes stream node -> browser
// directly; they never transit this deployment.
//
// HONESTY CONTRACT (same as resolve-item): if the node has no reachable URL
// or its heartbeat is stale, this returns 409 with the plain reason and any
// same-LAN hints. Nothing here fakes availability.

import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { nodeLiveness } from "../../../../../lib/storage-node";
import { isBrowserReachableUrl } from "../../../../../lib/storage-routing/decide";
import { DOWNLOAD_GRANT_TTL_SECONDS, mintGrantToken } from "../../../../../lib/storage-routing/grants";

type RouteContext = { params: Promise<{ id: string }> };

type Outcome =
  | { kind: "redirect"; location: string }
  | { kind: "unavailable"; reason: string; lanUrls: string[]; status: number }
  | { kind: "missing" };

export async function GET(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim().slice(0, 64) ?? "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const outcome = await withRls({ userId: session.user.id, orgId }, async (client): Promise<Outcome> => {
      const result = await client.query<{
        sha256: string;
        itemStatus: "stored" | "missing";
        nodeName: string;
        baseUrl: string | null;
        lanAddresses: string[];
        lastHeartbeatAt: string | null;
        encryptedAccessKey: string | null;
      }>(
        `SELECT i.sha256, i.status AS "itemStatus", n.name AS "nodeName",
                n.base_url AS "baseUrl", n.lan_addresses AS "lanAddresses",
                n.last_heartbeat_at AS "lastHeartbeatAt",
                n.encrypted_access_key AS "encryptedAccessKey"
         FROM storage_node_items i
         JOIN storage_nodes n ON n.id = i.node_id
         WHERE i.id = $1::uuid AND i.org_id = $2::uuid AND n.revoked_at IS NULL
         LIMIT 1`,
        [id, orgId],
      );
      const row = result.rows[0];
      if (!row) return { kind: "missing" };

      const lanUrls = (row.lanAddresses ?? []).map((base) => `${base.replace(/\/+$/, "")}/items/${row.sha256}`);
      if (row.itemStatus === "missing") {
        return {
          kind: "unavailable",
          status: 409,
          reason: `"${row.nodeName}" has not confirmed these bytes yet (upload pending, or the node reported them missing).`,
          lanUrls,
        };
      }
      if (!row.baseUrl) {
        return {
          kind: "unavailable",
          status: 409,
          reason:
            `Stored on "${row.nodeName}", but the node has no reachable URL configured. ` +
            `Set one on /team/storage (Cloudflare Tunnel or Tailscale) to fetch it from here.`,
          lanUrls,
        };
      }
      if (!isBrowserReachableUrl(row.baseUrl)) {
        return {
          kind: "unavailable",
          status: 409,
          reason:
            `Stored on "${row.nodeName}", but its URL (${row.baseUrl}) is plain http — browsers on a secure page cannot load it. ` +
            `Give the node an https URL on /team/storage.`,
          lanUrls,
        };
      }
      const liveness = nodeLiveness(row.lastHeartbeatAt, Date.now());
      if (liveness === "offline" || liveness === "never") {
        return {
          kind: "unavailable",
          status: 409,
          reason: `Stored on "${row.nodeName}", currently unreachable — last heartbeat ${
            row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : "never received"
          }.`,
          lanUrls,
        };
      }
      if (!row.encryptedAccessKey) {
        return {
          kind: "unavailable",
          status: 409,
          reason: `"${row.nodeName}" was paired without an access key (an old pairing). Re-pair the node to enable fetching.`,
          lanUrls,
        };
      }

      const accessKey = await decryptSecret(JSON.parse(row.encryptedAccessKey) as EncryptedSecret, createKms());
      const signingKey = createHash("sha256").update(accessKey).digest("hex");
      const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_GRANT_TTL_SECONDS;
      const token = mintGrantToken(
        {
          v: 1,
          op: "get",
          org: orgId,
          sha256: row.sha256,
          maxBytes: Number.MAX_SAFE_INTEGER,
          nonce: `get-${id}-${exp}`,
          exp,
        },
        signingKey,
      );
      return {
        kind: "redirect",
        location: `${row.baseUrl.replace(/\/+$/, "")}/items/${row.sha256}?grant=${encodeURIComponent(token)}`,
      };
    });

    if (outcome.kind === "missing") {
      return Response.json({ error: "Item not found on any of this team's storage nodes" }, { status: 404 });
    }
    if (outcome.kind === "unavailable") {
      return Response.json({ error: outcome.reason, lanUrls: outcome.lanUrls }, { status: outcome.status });
    }
    return Response.redirect(outcome.location, 307);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Item unavailable";
    return Response.json({ error: message }, { status: 400 });
  }
}
