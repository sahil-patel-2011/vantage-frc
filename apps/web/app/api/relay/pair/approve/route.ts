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

    const body = (await request.json()) as { code?: string; orgId?: string; name?: string; role?: string };
    const bareCode = normalizePairingCode(body.code);
    if (!bareCode || !body.orgId) throw new Error("A valid pairing code and organization are required");
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
    const role = body.role === "agent" || body.role === "video" ? body.role : "chat";

    await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2 AND role = ANY($3::org_role[])`,
        [body.orgId, session.user.id, ["owner", "admin"]],
      );
      if (!member.rowCount) throw new Error("Only team owners or admins can pair a relay");
    });

    await relay.query("BEGIN");
    const pairing = await relay.query<{ id: string; machine_name: string; node_version: string }>(
      `SELECT id, machine_name, node_version FROM relay_node_pairing_codes
       WHERE user_code_hash = $1 AND approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashSha256Hex(bareCode)],
    );
    const row = pairing.rows[0];
    if (!row) throw new Error("Pairing code is invalid, expired, or already used");

    const token = newToken();
    const encryptedToken = JSON.stringify(await encryptSecret(token, createKms()));
    const node = await relay.query<{ id: string }>(
      `INSERT INTO relay_nodes(org_id, paired_by, name, token_hash, node_version)
       VALUES($1::uuid, $2, $3, $4, $5) RETURNING id`,
      [body.orgId, session.user.id, name ?? row.machine_name, hashSha256Hex(token), row.node_version],
    );
    const nodeId = node.rows[0]!.id;
    await relay.query(
      `INSERT INTO relay_node_capabilities(node_id, role, instances) VALUES($1::uuid, $2, 1)
       ON CONFLICT (node_id, role) DO NOTHING`,
      [nodeId, role],
    );
    await relay.query(
      `UPDATE relay_node_pairing_codes
       SET approved_org_id = $2::uuid, approved_user_id = $3, node_id = $4, encrypted_node_token = $5,
           approved_at = now()
       WHERE id = $1`,
      [row.id, body.orgId, session.user.id, nodeId, encryptedToken],
    );
    await relay.query("COMMIT");
    return Response.json({ success: true, nodeId, machineName: row.machine_name });
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
