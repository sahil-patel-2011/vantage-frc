import { createHash } from "node:crypto";
import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { getAiBridgePool } from "../../../../../../lib/ai-bridge/pool";

/** Device-side pairing poll — mirrors /api/cad/pair/poll (token released exactly once). */
export async function POST(request: Request) {
  const client = await getAiBridgePool().connect();
  try {
    const body = (await request.json()) as { pollToken?: string };
    if (!body.pollToken) throw new Error("Poll token is required");
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      approved_org_id: string | null;
      approved_user_id: string | null;
      device_id: string | null;
      encrypted_device_token: string | null;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, approved_org_id, approved_user_id, device_id, encrypted_device_token, expires_at, consumed_at
       FROM ai_bridge_pairing_codes WHERE poll_token_hash = $1 FOR UPDATE`,
      [createHash("sha256").update(body.pollToken).digest("hex")],
    );
    const row = result.rows[0];
    if (!row || row.expires_at <= new Date()) {
      await client.query("ROLLBACK");
      return Response.json({ status: "expired" }, { status: 410 });
    }
    if (row.consumed_at) {
      await client.query("ROLLBACK");
      return Response.json({ status: "consumed" }, { status: 410 });
    }
    if (!row.approved_user_id || !row.encrypted_device_token) {
      await client.query("ROLLBACK");
      return Response.json({ status: "pending" });
    }
    const token = await decryptSecret(JSON.parse(row.encrypted_device_token) as EncryptedSecret, createKms());
    await client.query(
      `UPDATE ai_bridge_pairing_codes SET consumed_at = now(), encrypted_device_token = NULL WHERE id = $1`,
      [row.id],
    );
    await client.query("COMMIT");
    return Response.json({
      status: "approved",
      deviceToken: token,
      deviceId: row.device_id,
      orgId: row.approved_org_id,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing poll failed" },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}
