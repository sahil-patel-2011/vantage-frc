import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";
import {
  LINK_REQUEST_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  generatePollToken,
  generateUserCode,
  isChallengeShape,
  normalizeUserCode,
  sanitizeMachineName,
  sha256Hex,
} from "../../../../../lib/desktop-link/codes";
import { getDesktopLinkPool } from "../../../../../lib/desktop-link/pool";

const limiter = createRateLimiter({ limit: 6, windowMs: 60_000, namespace: "desktop-link-start" });

/**
 * Desktop shell starts a browser-link sign-in (no session — proxy allowlists
 * /api/desktop/link). The desktop sends only the sha256 challenge of a verifier
 * it keeps in memory; every secret this row stores is a sha256 hash.
 */
export async function POST(request: Request) {
  try {
    if (!(await limiter.allow(anonymizeIp(clientIp(request), "desktop-link")))) {
      return rateLimitedResponse("Too many sign-in attempts. Wait a minute and try again.");
    }

    const body = (await request.json()) as {
      machineName?: unknown;
      challenge?: unknown;
      desktopVersion?: unknown;
    };
    const machine = sanitizeMachineName(body.machineName);
    if (!machine) throw new Error("A machine name is required");
    if (!isChallengeShape(body.challenge)) throw new Error("A sha256 challenge is required");
    const desktopVersion =
      typeof body.desktopVersion === "string" && body.desktopVersion.trim()
        ? body.desktopVersion.trim().slice(0, 40)
        : "unknown";

    const pool = getDesktopLinkPool();
    const recent = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM desktop_link_requests
       WHERE machine_name = $1 AND created_at > now() - interval '10 minutes'`,
      [machine],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 8) {
      return Response.json(
        { error: "Too many sign-in attempts from this computer. Wait a few minutes and try again." },
        { status: 429 },
      );
    }

    const userCode = generateUserCode();
    const pollToken = generatePollToken();
    await pool.query(
      `INSERT INTO desktop_link_requests(user_code_hash, poll_token_hash, code_challenge, machine_name, desktop_version, expires_at)
       VALUES($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
      [
        sha256Hex(normalizeUserCode(userCode)!),
        sha256Hex(pollToken),
        body.challenge,
        machine,
        desktopVersion,
        String(LINK_REQUEST_TTL_SECONDS),
      ],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json({
      userCode,
      pollToken,
      verificationUri: `${base}/desktop-link?code=${encodeURIComponent(userCode)}`,
      expiresIn: LINK_REQUEST_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sign-in could not start" },
      { status: 400 },
    );
  }
}
