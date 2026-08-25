import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { normalizeUserCode, sha256Hex } from "../../../../lib/desktop-link/codes";

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000, namespace: "desktop-link-preview" });

/**
 * Session-authenticated lookup for the /desktop-link approval page: which
 * machine is asking, and is the code still live? POST body keeps the code out
 * of logged query strings; the per-user limiter keeps code probing pointless.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    if (!(await limiter.allow(`user:${session.user.id}`))) {
      return rateLimitedResponse("Too many lookups. Wait a minute and try again.");
    }

    const body = (await request.json()) as { code?: unknown };
    const normalized = typeof body.code === "string" ? normalizeUserCode(body.code) : null;
    if (!normalized) return Response.json({ status: "unknown" });

    const row = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{
        machine_name: string;
        expires_at: Date;
        approved_at: Date | null;
        consumed_at: Date | null;
      }>(
        `SELECT machine_name, expires_at, approved_at, consumed_at
         FROM desktop_link_requests WHERE user_code_hash = $1`,
        [sha256Hex(normalized)],
      );
      return result.rows[0];
    });

    if (!row) return Response.json({ status: "unknown" });
    if (row.consumed_at) return Response.json({ status: "approved", machineName: row.machine_name });
    if (row.expires_at <= new Date() && !row.approved_at) return Response.json({ status: "expired" });
    if (row.approved_at) return Response.json({ status: "approved", machineName: row.machine_name });
    return Response.json({
      status: "pending",
      machineName: row.machine_name,
      expiresAt: row.expires_at.toISOString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 400 },
    );
  }
}
