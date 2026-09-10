// Relay pairing, step 1 (unauthenticated, called by the Pi installer):
// issue a human pairing code + poll token. Mirrors /api/storage-node/pair/start.

import { createHash, randomBytes } from "node:crypto";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { isRelayDatabaseUnconfigured, relaySetupResponse } from "../../../../../lib/connectors/pairing-setup";

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, (_, index) => (index === 4 ? "-" : "") + alphabet[randomBytes(1)[0]! % alphabet.length]).join(
    "",
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      machineName?: string;
      nodeVersion?: string;
      role?: string;
      instances?: number;
    };
    if (!body.machineName?.trim() || body.machineName.length > 100 || !body.nodeVersion?.trim()) {
      throw new Error("Machine name and node version are required");
    }
    const role = body.role === "agent" || body.role === "video" ? body.role : "chat";
    const instances = Math.min(16, Math.max(1, Number(body.instances) || 1));

    const pool = getCadRelayPool();
    const machine = body.machineName.trim();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM relay_node_pairing_codes
       WHERE machine_name = $1 AND created_at > now() - interval '10 minutes'`,
      [machine],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 8) {
      return Response.json(
        { error: "Too many pairing attempts from this machine. Wait a few minutes and try again." },
        { status: 429 },
      );
    }

    const userCode = code();
    const pollToken = randomBytes(32).toString("base64url");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    await pool.query(
      `INSERT INTO relay_node_pairing_codes(user_code_hash, poll_token_hash, machine_name, node_version, expires_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
      [hash(userCode.replace("-", "")), hash(pollToken), machine, `${body.nodeVersion.trim()} role=${role} instances=${instances}`],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json({
      userCode,
      pollToken,
      verificationUri: `${base}/team/relays`,
      role,
      instances,
      expiresIn: 600,
      interval: 3,
    });
  } catch (error) {
    if (isRelayDatabaseUnconfigured(error)) return relaySetupResponse();
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing could not start" },
      { status: 400 },
    );
  }
}
