import { randomBytes } from "node:crypto";
import { createKms, encryptSecret } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getEditorRelayPool } from "@vantage/db/editor-relay";
import { headers } from "next/headers";
import { hashToken } from "../../../../../lib/editor/device-auth";

export async function POST(request: Request) {
  const relay = await getEditorRelayPool().connect();
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const body = (await request.json()) as { code?: string; orgId?: string };
    if (!body.code || !body.orgId) throw new Error("Pairing code and organization are required");

    await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        body.orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
    });

    await relay.query("BEGIN");
    const pairing = await relay.query<{ id: string; machine_name: string; extension_version: string }>(
      `SELECT id, machine_name, extension_version
       FROM editor_pairing_codes
       WHERE user_code_hash = $1
         AND approved_user_id IS NULL
         AND consumed_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [hashToken(body.code.replace(/-/g, "").toUpperCase())],
    );
    const row = pairing.rows[0];
    if (!row) throw new Error("Pairing code is invalid, expired, or already used");

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const encrypted = await encryptSecret(token, createKms());

    const device = await relay.query<{ id: string }>(
      `INSERT INTO editor_devices(
         org_id, user_id, machine_name, editor, token_hash, scopes, extension_version, status, last_seen_at
       ) VALUES ($1,$2,$3,'vscode',$4,$5,$6,'paired', now())
       RETURNING id`,
      [
        body.orgId,
        session.user.id,
        row.machine_name,
        tokenHash,
        ["editor.context.submit"],
        row.extension_version,
      ],
    );

    await relay.query(
      `UPDATE editor_pairing_codes
       SET approved_org_id = $2,
           approved_user_id = $3,
           device_id = $4,
           encrypted_device_token = $5,
           approved_at = now()
       WHERE id = $1`,
      [row.id, body.orgId, session.user.id, device.rows[0]!.id, JSON.stringify(encrypted)],
    );
    await relay.query("COMMIT");

    return Response.json({
      success: true,
      machineName: row.machine_name,
      deviceId: device.rows[0]!.id,
    });
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
