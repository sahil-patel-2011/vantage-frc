// Storage-node pairing, step 2 (session-authenticated, called from /team/storage):
// an org owner/admin enters the 8-char code, we mint the node token (storing only its sha256
// hash), create the storage_nodes row, and stash the KMS-encrypted token on the pairing row
// for the node's next poll. Mirrors /api/cad/pair/approve end to end.

import { auth } from "@vantage/core";
import { createKms, encryptSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { headers } from "next/headers";
import { hashSha256Hex, newToken, normalizePairingCode } from "../../../../../lib/storage-node/pairing";

export async function POST(request: Request) {
  const relay = await getCadRelayPool().connect();
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const body = (await request.json()) as { code?: string; orgId?: string; name?: string };
    const bareCode = normalizePairingCode(body.code);
    if (!bareCode || !body.orgId) throw new Error("A valid pairing code and organization are required");
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;

    await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2 AND role = ANY($3::org_role[])`,
        [body.orgId, session.user.id, ["owner", "admin"]],
      );
      if (!member.rowCount) throw new Error("Only team owners or admins can pair a storage node");
    });

    await relay.query("BEGIN");
    const pairing = await relay.query<{ id: string; machine_name: string; node_version: string; encrypted_access_key: string | null }>(
      `SELECT id, machine_name, node_version, encrypted_access_key FROM storage_node_pairing_codes
       WHERE user_code_hash = $1 AND approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashSha256Hex(bareCode)],
    );
    const row = pairing.rows[0];
    if (!row) throw new Error("Pairing code is invalid, expired, or already used");

    const token = newToken();
    const encryptedToken = JSON.stringify(await encryptSecret(token, createKms()));
    const node = await relay.query<{ id: string }>(
      `INSERT INTO storage_nodes(org_id, paired_by, name, token_hash, encrypted_access_key, node_version, status)
       VALUES($1::uuid, $2, $3, $4, $5, $6, 'paired') RETURNING id`,
      [body.orgId, session.user.id, name ?? row.machine_name, hashSha256Hex(token), row.encrypted_access_key, row.node_version],
    );
    await relay.query(
      `UPDATE storage_node_pairing_codes
       SET approved_org_id = $2::uuid, approved_user_id = $3, node_id = $4, encrypted_node_token = $5,
           encrypted_access_key = NULL, approved_at = now()
       WHERE id = $1`,
      [row.id, body.orgId, session.user.id, node.rows[0]!.id, encryptedToken],
    );
    await relay.query("COMMIT");
    return Response.json({ success: true, nodeId: node.rows[0]!.id, machineName: row.machine_name });
  } catch (error) {
    await relay.query("ROLLBACK").catch(() => {});
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing approval failed" },
      { status: 400 },
    );
  } finally {
    relay.release();
  }
}
