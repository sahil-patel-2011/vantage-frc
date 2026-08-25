import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";
import {
  AUTH_CODE_TTL_SECONDS,
  generateAuthCode,
  isPollTokenShape,
  sha256Hex,
} from "../../../../../lib/desktop-link/codes";
import { decidePoll, type DesktopLinkRow } from "../../../../../lib/desktop-link/link-state";
import { getDesktopLinkPool } from "../../../../../lib/desktop-link/pool";

// Desktop polls every 3s (≈20/min); allow headroom without enabling brute force.
const limiter = createRateLimiter({ limit: 40, windowMs: 60_000, namespace: "desktop-link-poll" });

/**
 * Desktop-side poll (no session). Releases the one-time authorization code
 * EXACTLY once: the plaintext is generated here, its sha256 stored, and it is
 * never persisted or logged — a lost response burns the attempt and the user
 * simply starts over. FOR UPDATE makes the single release race-free.
 */
export async function POST(request: Request) {
  if (!(await limiter.allow(anonymizeIp(clientIp(request), "desktop-link")))) {
    return rateLimitedResponse("Polling too fast. The desktop app retries automatically.");
  }

  const client = await getDesktopLinkPool().connect();
  try {
    const body = (await request.json()) as { pollToken?: unknown };
    if (!isPollTokenShape(body.pollToken)) throw new Error("Poll token is required");

    await client.query("BEGIN");
    const result = await client.query<DesktopLinkRow & { id: string }>(
      `SELECT id, approved_user_id, code_challenge, auth_code_hash, auth_code_expires_at, consumed_at, expires_at
       FROM desktop_link_requests WHERE poll_token_hash = $1 FOR UPDATE`,
      [sha256Hex(body.pollToken)],
    );
    const decision = decidePoll(result.rows[0], new Date());

    if (decision.status === "expired" || decision.status === "consumed") {
      await client.query("ROLLBACK");
      return Response.json({ status: decision.status }, { status: 410 });
    }
    if (decision.status === "pending") {
      await client.query("ROLLBACK");
      return Response.json({ status: "pending" });
    }

    const authCode = generateAuthCode();
    await client.query(
      `UPDATE desktop_link_requests
          SET auth_code_hash = $2, auth_code_expires_at = now() + ($3 || ' seconds')::interval
        WHERE id = $1`,
      [result.rows[0]!.id, sha256Hex(authCode), String(AUTH_CODE_TTL_SECONDS)],
    );
    await client.query("COMMIT");
    return Response.json({ status: "approved", authCode, expiresIn: AUTH_CODE_TTL_SECONDS });
  } catch (error) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: error instanceof Error ? error.message : "Sign-in poll failed" },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}
