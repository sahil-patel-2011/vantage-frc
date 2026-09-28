import { createHash } from "node:crypto";
import { getAiBridgePool } from "../../../../../lib/ai-bridge/pool";
import { publicErrorMessage } from "../../../../../lib/security/public-error";

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
    const result = await getAiBridgePool().query<{ id: string; orgId: string; userId: string; name: string }>(
      `UPDATE ai_bridge_devices
          SET last_heartbeat_at = now(), status = 'online', updated_at = now(),
              bridge_version = COALESCE($2, bridge_version),
              engines = COALESCE($3::jsonb, engines)
        WHERE token_hash = $1 AND revoked_at IS NULL
          AND account_age_eligible(paired_by)
          AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=ai_bridge_devices.org_id AND m.user_id=ai_bridge_devices.paired_by)
        RETURNING id, org_id AS "orgId", paired_by AS "userId", name`,
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
        WHERE org_id = $1::uuid AND requested_by = $2::uuid AND state = 'queued'`,
      [device.orgId, device.userId],
    );
    return Response.json({
      ok: true,
      device,
      queuedJobs: Number(queue.rows[0]?.queued ?? 0),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "Heartbeat failed") },
      { status: 400 },
    );
  }
}
