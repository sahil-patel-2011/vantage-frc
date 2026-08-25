import { createHash, randomBytes } from "node:crypto";
import { getAiBridgePool } from "../../../../../../lib/ai-bridge/pool";

/** Ambiguous alphabet (no I/O/0/1) for human entry — mirrors CAD pairing. */
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 8 },
    (_, index) => (index === 4 ? "-" : "") + alphabet[randomBytes(1)[0]! % alphabet.length],
  ).join("");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { machineName?: string; bridgeVersion?: string };
    if (!body.machineName?.trim() || body.machineName.length > 100 || !body.bridgeVersion?.trim()) {
      throw new Error("Machine name and bridge version are required");
    }

    const pool = getAiBridgePool();
    const machine = body.machineName.trim();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ai_bridge_pairing_codes
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
      `INSERT INTO ai_bridge_pairing_codes(user_code_hash, poll_token_hash, machine_name, bridge_version, expires_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
      [hash(userCode.replace("-", "")), hash(pollToken), machine, body.bridgeVersion],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json({
      userCode,
      pollToken,
      verificationUri: `${base}/team/ai-bridge?code=${encodeURIComponent(userCode)}`,
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
