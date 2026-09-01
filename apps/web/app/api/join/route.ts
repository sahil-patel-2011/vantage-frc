import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Self-signup by team join code.
//
// This is the ONE place a signed-in user who belongs to no team can gain a membership
// without an emailed invite. All the guards live inside redeem_org_join_code (migration
// 0515), a SECURITY DEFINER function, because the caller is by definition not yet a
// member and therefore cannot satisfy the memberships RLS policies itself.
//
// The function verifies: a verified account, a code that exists, is not revoked, is not
// expired, is under its use cap, and that the user is not already a member. It writes a
// membership_audit_events row for every redemption.
//
// Rate limiting matters here because the code space is guessable in principle
// (32^8). We bound attempts per user per window and never reveal which of the failure
// reasons applied beyond the function's own message.

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

/**
 * Dev-friendly in-memory attempt counter. Production correctness does not depend on it:
 * the real protections are the per-code use cap, expiry, and revocation. It exists to
 * make brute-forcing pointlessly slow on a single instance.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(userId: string) {
  const now = Date.now();
  const entry = attempts.get(userId);
  if (!entry || entry.resetAt <= now) {
    attempts.set(userId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{6,12}$/.test(code)) {
    return Response.json({ error: "Enter the join code your team leader gave you" }, { status: 400 });
  }

  if (tooManyAttempts(session.user.id)) {
    return Response.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  try {
    const joined = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{ orgId: string }>(
        `SELECT redeem_org_join_code($1) AS "orgId"`,
        [code],
      );
      const orgId = result.rows[0]?.orgId;
      if (!orgId) throw new Error("That join code is not valid");

      const org = await client.query<{ name: string; teamNumber: number; role: string }>(
        `SELECT o.name, o.team_number AS "teamNumber", m.role::text AS role
           FROM organizations o
           JOIN memberships m ON m.org_id = o.id AND m.user_id = current_app_user_id()
          WHERE o.id = $1::uuid`,
        [orgId],
      );
      return { orgId, ...(org.rows[0] ?? { name: "", teamNumber: 0, role: "scout" }) };
    });

    return Response.json({ success: true, ...joined });
  } catch (error) {
    // The SECURITY DEFINER function raises specific, user-safe messages; surface them
    // as-is so a person knows whether the code was wrong, off, expired, or used up.
    const raw = error instanceof Error ? error.message : "";
    const known =
      /not valid|turned off|expired|maximum number of times|already a member|verified Vantage account/i.exec(
        raw,
      );
    if (known) {
      const message = raw.replace(/^.*?(?=[A-Z])/, "").trim() || raw;
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: "Could not redeem that join code" }, { status: 400 });
  }
}
