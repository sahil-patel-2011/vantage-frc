import { createHash, randomBytes } from "node:crypto";
import { getAiBridgePool } from "../../../../../lib/ai-bridge/pool";

function bearer(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Claim the next queued chat job for this device's org (204 when none). */
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
    return Response.json({
      jobId: row.job_id,
      feature: row.feature,
      messages: row.messages,
      requestedEngine: row.requested_engine,
      leaseToken,
      leaseSeconds: 120,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job claim failed";
    return Response.json({ error: message }, { status: /invalid or revoked/i.test(message) ? 401 : 400 });
  }
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
      { error: error instanceof Error ? error.message : "Job update failed" },
      { status: 400 },
    );
  }
}
