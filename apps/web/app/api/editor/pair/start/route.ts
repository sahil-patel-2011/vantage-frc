import { randomBytes } from "node:crypto";
import { getEditorRelayPool } from "@vantage/db/editor-relay";
import { hashToken, pairingUserCode } from "../../../../../lib/editor/device-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      machineName?: string;
      extensionVersion?: string;
      platform?: string;
      editor?: string;
    };

    if (!body.machineName?.trim() || body.machineName.length > 100 || !body.extensionVersion?.trim()) {
      throw new Error("Machine name and extension version are required");
    }

    const pool = getEditorRelayPool();
    const machine = body.machineName.trim();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM editor_pairing_codes
       WHERE machine_name = $1 AND created_at > now() - interval '10 minutes'`,
      [machine],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 8) {
      return Response.json(
        { error: "Too many pairing attempts from this machine. Wait a few minutes and try again." },
        { status: 429 },
      );
    }

    const userCode = pairingUserCode();
    const pollToken = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO editor_pairing_codes(
         user_code_hash, poll_token_hash, machine_name, extension_version, requested_editor, expires_at
       ) VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')`,
      [
        hashToken(userCode.replace(/-/g, "")),
        hashToken(pollToken),
        machine,
        body.extensionVersion.trim(),
        String(body.editor ?? body.platform ?? "vscode").slice(0, 40) || "vscode",
      ],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    const verificationUri = `${base}/editor/pair?code=${encodeURIComponent(userCode)}`;
    return Response.json({
      userCode,
      pollToken,
      verificationUri,
      expiresIn: 600,
      interval: 3,
      qrPayload: verificationUri,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Pairing could not start" },
      { status: 400 },
    );
  }
}
