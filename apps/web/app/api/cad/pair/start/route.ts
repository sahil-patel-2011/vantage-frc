import { createHash, randomBytes } from "node:crypto";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { isRelayDatabaseUnconfigured, relaySetupResponse } from "../../../../../lib/connectors/pairing-setup";

/** Ambiguous alphabet (no I/O/0/1) for human + QR entry. */
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, (_, index) => (index === 4 ? "-" : "") + alphabet[randomBytes(1)[0]! % alphabet.length]).join(
    "",
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { machineName?: string; cliVersion?: string; platform?: string };
    if (!body.machineName?.trim() || body.machineName.length > 100 || !body.cliVersion?.trim()) {
      throw new Error("Machine name and CLI version are required");
    }

    const pool = getCadRelayPool();
    const machine = body.machineName.trim();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM cad_pairing_codes
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
      `INSERT INTO cad_pairing_codes(user_code_hash, poll_token_hash, machine_name, cli_version, requested_platform, expires_at)
       VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [
        hash(userCode.replace("-", "")),
        hash(pollToken),
        machine,
        body.cliVersion,
        String(body.platform ?? "") || null,
      ],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    const verificationUri = `${base}/cad/pair?code=${encodeURIComponent(userCode)}`;
    return Response.json({
      userCode,
      pollToken,
      verificationUri,
      expiresIn: 600,
      interval: 3,
      // QR UIs: short code only — never encode pollToken.
      qrPayload: verificationUri,
    });
  } catch (error) {
    // Same as the storage node: a deployment missing the relay role is a 503,
    // not a 400 the CLI on someone's laptop will treat as its own fault.
    if (isRelayDatabaseUnconfigured(error)) return relaySetupResponse();
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing could not start" },
      { status: 400 },
    );
  }
}
