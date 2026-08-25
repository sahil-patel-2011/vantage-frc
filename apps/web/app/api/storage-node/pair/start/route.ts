// Storage-node pairing, step 1 (unauthenticated, called by the node's --setup):
// issue a human pairing code + poll token, mirroring /api/cad/pair/start. The node also sends
// the access key it generated locally (client -> node auth); we keep it only KMS-encrypted so
// it can be handed to signed-in org members after approval — never stored in plaintext.

import { createHash, randomBytes } from "node:crypto";
import { createKms, encryptSecret } from "@vantage/billing";
import { getCadRelayPool } from "@vantage/db/cad-relay";

/** Ambiguous alphabet (no I/O/0/1) for human entry. */
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, (_, index) => (index === 4 ? "-" : "") + alphabet[randomBytes(1)[0]! % alphabet.length]).join(
    "",
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { machineName?: string; nodeVersion?: string; accessKey?: string };
    if (!body.machineName?.trim() || body.machineName.length > 100 || !body.nodeVersion?.trim()) {
      throw new Error("Machine name and node version are required");
    }
    if (typeof body.accessKey !== "string" || body.accessKey.length < 20 || body.accessKey.length > 200) {
      throw new Error("The node must send the access key it generated at setup");
    }

    const pool = getCadRelayPool();
    const machine = body.machineName.trim();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM storage_node_pairing_codes
       WHERE machine_name = $1 AND created_at > now() - interval '10 minutes'`,
      [machine],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 8) {
      return Response.json(
        { error: "Too many pairing attempts from this machine. Wait a few minutes and try again." },
        { status: 429 },
      );
    }

    let encryptedAccessKey: string;
    try {
      encryptedAccessKey = JSON.stringify(await encryptSecret(body.accessKey, createKms()));
    } catch {
      return Response.json(
        { error: "Storage-node pairing needs the platform key service configured. Ask your Vantage host to finish KMS setup." },
        { status: 503 },
      );
    }

    const userCode = code();
    const pollToken = randomBytes(32).toString("base64url");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    await pool.query(
      `INSERT INTO storage_node_pairing_codes(user_code_hash, poll_token_hash, machine_name, node_version, encrypted_access_key, expires_at)
       VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [hash(userCode.replace("-", "")), hash(pollToken), machine, body.nodeVersion, encryptedAccessKey],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json({
      userCode,
      pollToken,
      verificationUri: `${base}/team/storage`,
      expiresIn: 600,
      interval: 3,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing could not start" },
      { status: 400 },
    );
  }
}
