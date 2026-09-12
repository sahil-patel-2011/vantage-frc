import { createHash, randomBytes } from "node:crypto";
import { auth } from "@vantage/core";
import { createKms, encryptSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { getAiBridgePool } from "../../../../../lib/ai-bridge/pool";

/**
 * Session-authenticated approval of a bridge pairing code — mirrors /api/cad/pair/approve.
 * The approver must be a member; pairing means their machine's OWN subscription will serve
 * team chat turns, so the consent is theirs to give and theirs to revoke.
 */
export async function POST(request: Request) {
  const relay = await getAiBridgePool().connect();
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as { code?: string; orgId?: string; scope?: string };
    if (!body.code || !body.orgId) throw new Error("Pairing code and organization are required");
    if (body.scope !== undefined && body.scope !== "team" && body.scope !== "personal") {
      throw new Error("scope must be 'team' or 'personal'");
    }
    const scope = body.scope === "personal" ? "personal" : "team";
    await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        body.orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
    });
    await relay.query("BEGIN");
    const pairing = await relay.query<{ id: string; machine_name: string; bridge_version: string }>(
      `SELECT id, machine_name, bridge_version FROM ai_bridge_pairing_codes
       WHERE user_code_hash = $1 AND approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [createHash("sha256").update(body.code.replace(/-/g, "").toUpperCase()).digest("hex")],
    );
    const row = pairing.rows[0];
    if (!row) throw new Error("Pairing code is invalid, expired, or already used");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const encrypted = await encryptSecret(token, createKms());
    const device = await relay.query<{ id: string }>(
      `INSERT INTO ai_bridge_devices(org_id, paired_by, name, token_hash, bridge_version, status, last_heartbeat_at)
       VALUES($1,$2,$3,$4,$5,'paired',now()) RETURNING id`,
      [body.orgId, session.user.id, row.machine_name, tokenHash, row.bridge_version],
    );
    if (scope === "personal") {
      try {
        await relay.query(`UPDATE ai_bridge_devices SET scope = 'personal' WHERE id = $1::uuid`, [
          device.rows[0]!.id,
        ]);
      } catch (error) {
        if (error instanceof Error && /scope/.test(error.message)) {
          throw new Error("This team isn't ready for Your Claude Code yet. Ask a mentor to finish setup.");
        }
        throw error;
      }
    }
    await relay.query(
      `UPDATE ai_bridge_pairing_codes
          SET approved_org_id = $2, approved_user_id = $3, device_id = $4,
              encrypted_device_token = $5, approved_at = now()
        WHERE id = $1`,
      [row.id, body.orgId, session.user.id, device.rows[0]!.id, JSON.stringify(encrypted)],
    );
    await relay.query("COMMIT");
    return Response.json({ success: true, machineName: row.machine_name });
  } catch (error) {
    await relay.query("ROLLBACK");
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing approval failed" },
      { status: 400 },
    );
  } finally {
    relay.release();
  }
}
