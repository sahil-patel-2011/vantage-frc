import { createHash } from "node:crypto";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { parseCadCliSyncPayload } from "../../../../lib/cad/cli-sync";

/**
 * Terminal (vantage-cad) session sync. Authenticated exactly like the other
 * /api/cad/relay* routes: the paired device token from /cad/pair, hashed and
 * matched inside the record_cad_cli_session SECURITY DEFINER function
 * (migration 0451), which only ever writes cad_jobs rows for that device's
 * own org and user. No cookies, no second auth path.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Device token required" }, { status: 401 });
    const payload = parseCadCliSyncPayload(await request.json());
    const result = await getCadRelayPool().query<{ id: string }>(
      `SELECT record_cad_cli_session($1,$2,$3,$4::jsonb,$5::jsonb,$6) AS id`,
      [
        createHash("sha256").update(token).digest("hex"),
        payload.sessionId,
        payload.platform,
        payload.documentRef ? JSON.stringify(payload.documentRef) : null,
        payload.event ? JSON.stringify(payload.event) : null,
        payload.status,
      ],
    );
    return Response.json({ ok: true, jobId: result.rows[0]?.id ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAD sync failed";
    return Response.json({ error: message }, { status: /invalid or revoked/i.test(message) ? 401 : 400 });
  }
}
