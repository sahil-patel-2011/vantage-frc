// Storage-node heartbeat (node -> cloud every 60s, Bearer node token). Goes through the
// SECURITY DEFINER storage_node_heartbeat function (migration 0484) on the pairing pool, so
// only a valid token hash can touch liveness/disk stats, mirroring the CAD relay lease
// functions. The response carries up to 200 shas the node should verify next (scrub), which is
// how storage_node_items stays honest about stored|missing.

import { createHash } from "node:crypto";
import { getCadRelayPool } from "@vantage/db/cad-relay";

function bigintOrNull(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return String(Math.round(value));
}

function shaArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((sha): sha is string => typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)).slice(0, 500);
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Node token required" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      nodeVersion?: string;
      diskTotalBytes?: number;
      diskFreeBytes?: number;
      lanAddresses?: unknown;
      scrubbed?: boolean;
      verifiedShas?: unknown;
      missingShas?: unknown;
    };
    const lanAddresses = Array.isArray(body.lanAddresses)
      ? body.lanAddresses
          .filter((url): url is string => typeof url === "string" && /^https?:\/\/[\w.:[\]-]+$/.test(url))
          .slice(0, 8)
      : null;

    const result = await getCadRelayPool().query<{
      out_node_id: string;
      out_org_id: string;
      out_name: string;
      out_base_url: string | null;
      out_pending_shas: string[];
    }>(`SELECT * FROM storage_node_heartbeat($1, $2, $3::bigint, $4::bigint, $5::text[], $6, $7::text[], $8::text[])`, [
      createHash("sha256").update(token).digest("hex"),
      typeof body.nodeVersion === "string" ? body.nodeVersion.slice(0, 50) : null,
      bigintOrNull(body.diskTotalBytes),
      bigintOrNull(body.diskFreeBytes),
      lanAddresses,
      body.scrubbed === true,
      shaArray(body.verifiedShas),
      shaArray(body.missingShas),
    ]);
    const row = result.rows[0];
    if (!row) return Response.json({ error: "Node token is invalid or revoked" }, { status: 401 });

    return Response.json({
      ok: true,
      nodeId: row.out_node_id,
      name: row.out_name,
      baseUrl: row.out_base_url,
      pendingShas: row.out_pending_shas ?? [],
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heartbeat failed";
    const status = /invalid or revoked/i.test(message) ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}
