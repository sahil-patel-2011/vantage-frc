import { createHash, randomBytes } from "node:crypto";
import { getEditorRelayPool } from "@vantage/db/editor-relay";

export type EditorDevice = {
  id: string;
  orgId: string;
  userId: string;
  orgName: string;
  machineName: string;
  scopes: string[];
  status: string;
};

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function requireEditorDevice(request: Request): Promise<EditorDevice | Response> {
  const token = bearer(request);
  if (!token) {
    return Response.json({ error: "Device token required" }, { status: 401 });
  }

  const hash = createHash("sha256").update(token).digest("hex");
  const result = await getEditorRelayPool().query<{
    id: string;
    org_id: string;
    user_id: string;
    org_name: string;
    machine_name: string;
    scopes: string[];
    status: string;
  }>(
    `SELECT d.id, d.org_id, d.user_id, o.name AS org_name, d.machine_name, d.scopes, d.status
     FROM editor_devices d
     JOIN organizations o ON o.id = d.org_id
     WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND d.status = 'paired'`,
    [hash],
  );

  const row = result.rows[0];
  if (!row) {
    return Response.json({ error: "Device token invalid or revoked" }, { status: 401 });
  }

  await getEditorRelayPool().query(`UPDATE editor_devices SET last_seen_at = now(), updated_at = now() WHERE id = $1`, [
    row.id,
  ]);

  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    orgName: row.org_name,
    machineName: row.machine_name,
    scopes: row.scopes ?? [],
    status: row.status,
  };
}

/** Ambiguous alphabet (no I/O/0/1) for human + QR entry. */
export function pairingUserCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 8 },
    (_, index) => (index === 4 ? "-" : "") + alphabet[randomBytes(1)[0]! % alphabet.length],
  ).join("");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
