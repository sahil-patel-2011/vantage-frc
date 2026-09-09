/**
 * Public, unauthenticated Drive share resolution.
 *
 * Authorized solely by the opaque 32-hex token in the path, which proxy.ts
 * allow-lists with a narrow regex. The database side is the SECURITY DEFINER
 * `resolve_drive_share` (migration 0641), which returns the minimum — the
 * file names, sizes and types the share covers, plus the team's display name —
 * and never file bytes, other files in the space, who uploaded what, or
 * anything at all for a revoked or expired share.
 *
 * `requestPool` is the app role. Nothing here touches @vantage/db/admin.
 *
 * CLAUDE.md says every request DB access goes through `withRls({ userId })`.
 * This route is the documented exception, for the same reason
 * /api/public-forms/[token] and /api/parent-view/[token] are: there is no user
 * id to set, because the recipient has no account and — being a parent, a
 * sponsor or a judge — never will. Tenancy is enforced instead by the SECURITY
 * DEFINER functions, which resolve the org from the token and can only ever
 * touch the one share it names. Do NOT copy this into a route that does have a
 * session; there, `withRls` is what enforces tenancy.
 */

import { requestPool } from "@vantage/db";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../lib/rate-limit";
import { DRIVE_SHARE_TOKEN_PATTERN } from "../../../../lib/drive/validation";

export const dynamic = "force-dynamic";

// A public link is guessable-by-brute-force only in theory (128 bits), but the
// limiter is what makes that true in practice as well.
const readLimiter = createRateLimiter({ limit: 120, windowMs: 60_000, namespace: "drive-share-read" });

function notFound(): Response {
  return Response.json(
    { error: "This link is not valid, has expired, or the team has turned it off." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!DRIVE_SHARE_TOKEN_PATTERN.test(token)) return notFound();

  if (!(await readLimiter.allow(anonymizeIp(clientIp(request))))) {
    return rateLimitedResponse();
  }

  try {
    const result = await requestPool.query<{ share: unknown }>(
      "SELECT resolve_drive_share($1) AS share",
      [token],
    );
    const share = result.rows[0]?.share ?? null;
    if (!share) return notFound();

    // Record the open. Fire-and-forget on purpose: a failed audit write must
    // never stop a recipient reading a file that was shared with them.
    void requestPool
      .query("SELECT record_drive_share_use($1, 'opened', NULL)", [token])
      .catch(() => undefined);

    return Response.json(
      { share },
      { headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } },
    );
  } catch {
    // We cannot tell a bad token from an outage here, so say the honest thing
    // rather than implying the link is wrong.
    return Response.json(
      { error: "We could not load this right now. Please try again in a minute." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
