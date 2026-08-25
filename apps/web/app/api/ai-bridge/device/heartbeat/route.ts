import { createHash } from "node:crypto";
import { getAiBridgePool } from "../../../../../lib/ai-bridge/pool";

const MAX_ENGINES_JSON = 4_096;

/** Device-token heartbeat: engine availability/versions + liveness. Mirrors CAD relay. */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Device token required" }, { status: 401 });
    const body = (await request.json()) as {
      bridgeVersion?: string;
      engines?: Record<string, unknown>;
    };
    const engines =
      body.engines && typeof body.engines === "object" && JSON.stringify(body.engines).length <= MAX_ENGINES_JSON
        ? body.engines
        : null;
    const result = await getAiBridgePool().query<{ id: string; orgId: string; name: string }>(
      `UPDATE ai_bridge_devices
          SET last_heartbeat_at = now(), status = 'online', updated_at = now(),
              bridge_version = COALESCE($2, bridge_version),
              engines = COALESCE($3::jsonb, engines)
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id, org_id AS "orgId", name`,
      [
        createHash("sha256").update(token).digest("hex"),
        body.bridgeVersion ?? null,
        engines ? JSON.stringify(engines) : null,
      ],
    );
    const device = result.rows[0];
    if (!device) return Response.json({ error: "Device token is invalid or revoked" }, { status: 401 });
    const queue = await getAiBridgePool().query<{ queued: string }>(
      `SELECT COUNT(*)::text AS queued FROM ai_bridge_jobs
        WHERE org_id = $1::uuid AND state = 'queued'`,
      [device.orgId],
    );
    return Response.json({
      ok: true,
      device,
      queuedJobs: Number(queue.rows[0]?.queued ?? 0),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Heartbeat failed" },
      { status: 400 },
    );
  }
}
