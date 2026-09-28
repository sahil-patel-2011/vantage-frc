import { createHash, randomBytes } from "node:crypto";
import { getAiBridgePool } from "../../../../../lib/ai-bridge/pool";
import { publicErrorMessage } from "../../../../../lib/security/public-error";

function bearer(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Claim only the paired person's queued request (204 when none). */
export async function POST(request: Request) {
  try {
    const deviceToken = bearer(request);
    if (!deviceToken) return Response.json({ error: "Device token required" }, { status: 401 });
    const leaseToken = randomBytes(32).toString("base64url");
    const result = await getAiBridgePool().query<{
      job_id: string;
      org_id: string;
      feature: string;
      messages: { prompt?: string };
      requested_engine: string | null;
    }>(`SELECT * FROM claim_ai_bridge_job($1,$2)`, [hash(deviceToken), hash(leaseToken)]);
    const row = result.rows[0];
    if (!row) return new Response(null, { status: 204 });
    const identity = (await getAiBridgePool().query<{ user_id: string; lease_seconds: number }>(`SELECT d.paired_by::text AS user_id,
      greatest(0,extract(epoch from (j.lease_expires_at-now())))::int AS lease_seconds
      FROM ai_bridge_devices d JOIN ai_bridge_jobs j ON j.device_id=d.id
      WHERE j.id=$1::uuid AND d.token_hash=$2 AND d.paired_by=j.requested_by AND d.revoked_at IS NULL`, [row.job_id, hash(deviceToken)])).rows[0];
    if (!identity) return Response.json({ error: "Personal connection is no longer active" }, { status: 401 });
    return Response.json({
      jobId: row.job_id,
      orgId: row.org_id,
      userId: identity.user_id,
      feature: row.feature,
      messages: row.messages,
      requestedEngine: row.requested_engine,
      leaseToken,
      leaseSeconds: identity.lease_seconds,
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Job claim failed");
    return Response.json({ error: message }, { status: /invalid or revoked/i.test(message) ? 401 : 400 });
  }
}

/** Device checks cancellation/revocation without exposing any job content. */
export async function PUT(request: Request) {
  try {
    const deviceToken = bearer(request);
    if (!deviceToken) return Response.json({ error: "Device token required" }, { status: 401 });
    const body = await request.json() as { jobId?: string; leaseToken?: string };
    if (!body.jobId || !body.leaseToken) return Response.json({ error: "Job and lease are required" }, { status: 400 });
    const result = await getAiBridgePool().query<{ active: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM ai_bridge_jobs j JOIN ai_bridge_devices d ON d.id=j.device_id
      WHERE j.id=$1::uuid AND d.token_hash=$2 AND d.revoked_at IS NULL AND j.requested_by=d.paired_by
        AND j.org_id=d.org_id AND j.state='leased' AND j.lease_token_hash=$3 AND j.lease_expires_at>now()
        AND account_age_eligible(d.paired_by) AND EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=d.org_id AND m.user_id=d.paired_by)
    ) AS active`, [body.jobId, hash(deviceToken), hash(body.leaseToken)]);
    return Response.json({ active: result.rows[0]?.active === true });
  } catch { return Response.json({ error: "Connection check failed" }, { status: 503 }); }
}

/** Report a leased job's outcome (done | failed). */
export async function PATCH(request: Request) {
  try {
    const deviceToken = bearer(request);
    if (!deviceToken) return Response.json({ error: "Device token required" }, { status: 401 });
    const body = (await request.json()) as {
      jobId?: string;
      leaseToken?: string;
      state?: "done" | "failed";
      result?: Record<string, unknown>;
      errorClass?: string;
      errorMessage?: string;
    };
    if (!body.jobId || !body.leaseToken || (body.state !== "done" && body.state !== "failed")) {
      throw new Error("jobId, leaseToken, and a done|failed state are required");
    }
    await getAiBridgePool().query(`SELECT complete_ai_bridge_job($1,$2,$3::uuid,$4,$5::jsonb,$6,$7)`, [
      hash(deviceToken),
      hash(body.leaseToken),
      body.jobId,
      body.state,
      body.state === "done" && body.result ? JSON.stringify(body.result) : null,
      body.state === "failed" ? (body.errorClass ?? "cli_error").slice(0, 64) : null,
      body.state === "failed" ? (body.errorMessage ?? "The bridge reported a failure.").slice(0, 2000) : null,
    ]);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "Job update failed") },
      { status: 400 },
    );
  }
}
