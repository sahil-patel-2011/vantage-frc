import { createHash, randomBytes } from "node:crypto";
import { createKms, encryptSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import type { PoolClient } from "@neondatabase/serverless";
import { z } from "zod";
import { IntelHttpError, intelSession, withIntelRequest } from "../../../../../lib/intel-auth";
import { isRelayDatabaseUnconfigured, relaySetupResponse } from "../../../../../lib/connectors/pairing-setup";
import { parseSecureJson, RequestSecurityError } from "../../../../../lib/security/request";

const approvalSchema = z.object({
  code: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i)
    .transform((value) => value.replace("-", "").toUpperCase()),
  orgId: z.string().uuid(),
  platform: z.enum(["onshape", "fusion360"]),
}).strict();

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function POST(request: Request) {
  let relay: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const body = await parseSecureJson(request, approvalSchema, { maxBytes: 2048 });
    const session = await intelSession();
    // Check membership and current team sign-in/MFA policy before allocating
    // a connection from the privileged pairing pool.
    await withIntelRequest(body.orgId, async () => undefined);
    relay = await getCadRelayPool().connect();
    await relay.query("BEGIN");
    transactionOpen = true;
    const pairing = await relay.query<{
      id: string; machine_name: string; cli_version: string; requested_platform: string | null;
    }>(
      `SELECT id,machine_name,cli_version,requested_platform FROM cad_pairing_codes
       WHERE user_code_hash=$1 AND approved_user_id IS NULL AND consumed_at IS NULL
       AND expires_at>now() FOR UPDATE`,
      [createHash("sha256").update(body.code).digest("hex")],
    );
    const row = pairing.rows[0];
    if (!row) throw new RequestSecurityError(409, "Pairing code is invalid, expired, or already used.");
    // Legacy CLI codes without a requested platform still allow either choice.
    if (row.requested_platform && row.requested_platform !== body.platform) {
      throw new RequestSecurityError(409, "Choose the CAD platform requested by this connector, or start a new pairing.");
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const encrypted = await encryptSecret(token, createKms());
    const device = await relay.query<{ id: string }>(
      `INSERT INTO cad_relay_devices(org_id,user_id,machine_name,platform,token_hash,scopes,cli_version,status,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'paired',now()) RETURNING id`,
      [body.orgId, session.user.id, row.machine_name, body.platform, tokenHash,
        body.platform === "fusion360" ? ["cad.jobs.claim", "cad.jobs.progress", "cad.artifacts.upload"] : ["cad.jobs.monitor"],
        row.cli_version],
    );
    const deviceId = device.rows[0]?.id;
    if (!deviceId) throw new Error("Device insert was not confirmed");
    await relay.query(
      `UPDATE cad_pairing_codes SET approved_org_id=$2,approved_user_id=$3,device_id=$4,
       encrypted_device_token=$5,approved_at=now(),requested_platform=$6 WHERE id=$1`,
      [row.id, body.orgId, session.user.id, deviceId, JSON.stringify(encrypted), body.platform],
    );
    await relay.query("COMMIT");
    transactionOpen = false;

    // The pairing role cannot write tenant audit records. A separate audit
    // failure must never report that an already committed approval failed.
    let auditRecorded = true;
    try {
      await withRls({ userId: session.user.id, orgId: body.orgId }, (client) => client.query(
        `INSERT INTO cad_audit_events(org_id,actor_user_id,action,payload)
         VALUES($1,$2,'cad.device.paired',$3::jsonb)`,
        [body.orgId, session.user.id, JSON.stringify({ deviceId, machineName: row.machine_name, platform: body.platform })],
      ));
    } catch {
      auditRecorded = false;
      console.error("[cad pairing] approval committed; audit recording unavailable");
    }
    return privateResponse(Response.json({ success: true, machineName: row.machine_name,
      ...(auditRecorded ? {} : { warning: "audit_unavailable", message: "Device approved. Its activity record could not be saved; do not approve again." }),
    }));
  } catch (error) {
    if (transactionOpen && relay) await relay.query("ROLLBACK").catch(() => undefined);
    if (error instanceof IntelHttpError || error instanceof RequestSecurityError) {
      return privateResponse(Response.json({ error: error.message }, { status: error.status }));
    }
    if (isRelayDatabaseUnconfigured(error)) return privateResponse(relaySetupResponse());
    return privateResponse(Response.json({ error: "Pairing approval could not be confirmed. Check the connector's pairing status before trying again." }, { status: 503 }));
  } finally {
    relay?.release();
  }
}
