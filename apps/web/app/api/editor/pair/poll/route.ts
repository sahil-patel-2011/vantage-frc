import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { getEditorRelayPool } from "@vantage/db/editor-relay";
import { hashToken } from "../../../../../lib/editor/device-auth";

export async function POST(request: Request) {
  const client = await getEditorRelayPool().connect();
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
       FROM editor_pairing_codes
       WHERE poll_token_hash = $1
       FOR UPDATE`,
      [hashToken(body.pollToken)],
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

    let orgName: string | null = null;
    if (row.approved_org_id) {
      const org = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [
        row.approved_org_id,
      ]);
      orgName = org.rows[0]?.name ?? null;
    }

    await client.query(
      `UPDATE editor_pairing_codes SET consumed_at = now(), encrypted_device_token = NULL WHERE id = $1`,
      [row.id],
    );
    await client.query("COMMIT");

    return Response.json({
      status: "approved",
      deviceToken: token,
      deviceId: row.device_id,
      orgId: row.approved_org_id,
      orgName,
      userId: row.approved_user_id,
      scopes: ["editor.context.submit"],
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
