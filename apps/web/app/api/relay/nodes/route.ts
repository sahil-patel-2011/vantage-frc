import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
    if (!orgId) throw new Error("orgId is required");
    const rows = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{
        id: string;
        name: string;
        nodeVersion: string | null;
        queueDepth: number | null;
        tokensPerSecond: string | null;
        lastHeartbeatAt: string | null;
        roles: string[];
        instances: number | null;
      }>(
        `SELECT n.id,
                n.name,
                n.node_version AS "nodeVersion",
                n.queue_depth AS "queueDepth",
                n.tokens_per_second::text AS "tokensPerSecond",
                to_char(n.last_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastHeartbeatAt",
                COALESCE(array_agg(c.role) FILTER (WHERE c.role IS NOT NULL), '{}') AS roles,
                MAX(c.instances) AS instances
         FROM relay_nodes n
         LEFT JOIN relay_node_capabilities c ON c.node_id = n.id
         WHERE n.org_id = $1::uuid AND n.revoked_at IS NULL
         GROUP BY n.id
         ORDER BY n.created_at DESC`,
        [orgId],
      );
      return result.rows;
    });
    const now = Date.now();
    const nodes = rows.map((row) => {
      const beat = row.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : NaN;
      const online = Number.isFinite(beat) && now - beat < 120_000;
      return {
        ...row,
        online,
        roles: Array.isArray(row.roles) ? row.roles : [],
      };
    });
    return Response.json({ nodes });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load relays" },
      { status: error instanceof Error && error.message.includes("Authentication") ? 401 : 400 },
    );
  }
}
