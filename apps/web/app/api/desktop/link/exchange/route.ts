import { auth } from "@vantage/core";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";
import { isAuthCodeShape, isVerifierShape, sha256Hex } from "../../../../../lib/desktop-link/codes";
import { decideExchange, type DesktopLinkRow } from "../../../../../lib/desktop-link/link-state";
import { getDesktopLinkPool } from "../../../../../lib/desktop-link/pool";
import { extractSessionCookie } from "../../../../../lib/desktop-link/session-cookie";

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, namespace: "desktop-link-exchange" });

/**
 * Consume the one-time authorization code under a FOR UPDATE lock. Returns the
 * approving user's id, or the error Response to send. Single-use is stamped
 * BEFORE minting: a code that reaches the mint step can never be replayed.
 */
async function consumeAuthCode(request: Request): Promise<{ userId: string } | Response> {
  const client = await getDesktopLinkPool().connect();
  try {
    const body = (await request.json()) as { authCode?: unknown; verifier?: unknown };
    if (!isAuthCodeShape(body.authCode) || !isVerifierShape(body.verifier)) {
      return Response.json({ error: "That sign-in code is not valid." }, { status: 400 });
    }

    await client.query("BEGIN");
    const result = await client.query<DesktopLinkRow & { id: string }>(
      `SELECT id, approved_user_id, code_challenge, auth_code_hash, auth_code_expires_at, consumed_at, expires_at
       FROM desktop_link_requests WHERE auth_code_hash = $1 FOR UPDATE`,
      [sha256Hex(body.authCode)],
    );
    const decision = decideExchange(result.rows[0], body.verifier, new Date());
    if (!decision.ok) {
      await client.query("ROLLBACK");
      if (decision.reason === "expired") {
        return Response.json(
          { error: "This sign-in expired before it finished. Start again from the desktop app." },
          { status: 410 },
        );
      }
      // "invalid" and "verifier_mismatch" answer identically on the wire.
      return Response.json({ error: "That sign-in code is not valid." }, { status: 400 });
    }

    await client.query(`UPDATE desktop_link_requests SET consumed_at = now() WHERE id = $1`, [
      result.rows[0]!.id,
    ]);
    await client.query("COMMIT");
    return { userId: decision.userId };
  } catch (error) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: error instanceof Error ? error.message : "Sign-in could not be completed" },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}

/**
 * One-time exchange: authorization code + ORIGINAL verifier → desktop session.
 *
 * A stolen authorization code without the desktop's in-memory verifier fails
 * the sha256-challenge comparison and mints nothing. The session itself comes
 * from Better Auth's server API (`createDesktopLinkSession`, a SERVER_ONLY
 * plugin endpoint that uses `internalAdapter.createSession` +
 * `setSessionCookie`), so the cookie handed back is exactly what Better Auth
 * would set for a browser — a real, independently revocable session for the
 * approving user only.
 */
export async function POST(request: Request) {
  if (!(await limiter.allow(anonymizeIp(clientIp(request), "desktop-link")))) {
    return rateLimitedResponse("Too many exchange attempts. Wait a minute and try again.");
  }

  const consumed = await consumeAuthCode(request);
  if (consumed instanceof Response) return consumed;

  try {
    // The desktop's headers ride along so the minted session records an honest
    // ip/user-agent; there is no Request attached, so the SERVER_ONLY guard holds.
    const minted = await auth.api.createDesktopLinkSession({
      body: { userId: consumed.userId },
      headers: request.headers,
      returnHeaders: true,
    });
    const cookie = extractSessionCookie(minted.headers.getSetCookie());
    if (!cookie) {
      return Response.json({ error: "Sign-in could not be completed." }, { status: 500 });
    }
    return Response.json({
      status: "ok",
      cookie,
      userId: minted.response.userId,
      sessionExpiresAt: minted.response.expiresAt,
    });
  } catch {
    // The code is already consumed; the honest recovery is a fresh attempt.
    return Response.json(
      { error: "Sign-in could not be completed. Start again from the desktop app." },
      { status: 500 },
    );
  }
}
