import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { normalizeUserCode, sha256Hex } from "../../../../lib/desktop-link/codes";

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, namespace: "desktop-link-approve" });

/**
 * Session-authenticated approval of a desktop link code. Runs under withRls as
 * the approving user: the UPDATE policy on desktop_link_requests
 * (0491_desktop_link.sql) only matches unclaimed, unexpired, unconsumed rows
 * and its WITH CHECK forces approved_user_id = current_app_user_id() — the
 * database itself binds the request to the approver. The desktop session minted
 * later belongs to this user and no one else.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    if (!(await limiter.allow(`user:${session.user.id}`))) {
      return rateLimitedResponse("Too many approval attempts. Wait a minute and try again.");
    }

    const body = (await request.json()) as { code?: unknown };
    const normalized = typeof body.code === "string" ? normalizeUserCode(body.code) : null;
    if (!normalized) {
      return Response.json({ error: "Enter the 8-character code shown in the desktop app." }, { status: 400 });
    }

    const machineName = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{ machine_name: string }>(
        `UPDATE desktop_link_requests
            SET approved_user_id = $2::uuid, approved_at = now()
          WHERE user_code_hash = $1
            AND approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now()
          RETURNING machine_name`,
        [sha256Hex(normalized), session.user.id],
      );
      return result.rows[0]?.machine_name ?? null;
    });

    if (!machineName) {
      return Response.json(
        { error: "That code is invalid, expired, or already used. Start again from the desktop app." },
        { status: 400 },
      );
    }
    return Response.json({ success: true, machineName });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Approval failed" },
      { status: 400 },
    );
  }
}
