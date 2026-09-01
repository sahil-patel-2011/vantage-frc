import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// What is currently paying for this team's AI, from the team's own point of view.
//
// Both facts were previously invisible in the product: a team granted relay access had
// no way to learn its AI was on loan and would stop on a date, and a team funded in
// request credits could not see a balance anywhere. The platform admin screen showed
// both, which is exactly backwards — the team is the party that needs to plan around it.
//
// RLS is the boundary: org_ai_access_member_read and ai_request_credit_member_read both
// require is_org_member, so a non-member gets empty results rather than a 403 leak.
// Reads never invent a number — a team with no ledger rows is reported as "not on the
// credit plan" rather than given a fabricated allowance.

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    const funding = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const credits = await client.query<{
        granted: string;
        spent: string;
        balance: string;
      }>(
        `SELECT granted, spent, balance FROM org_ai_request_credits WHERE org_id = $1::uuid`,
        [orgId],
      );

      // A grant row exists only when a platform admin opened a window; the WHERE clause
      // keeps this to windows that are open right now.
      const grants = await client.query<{
        accessKind: string;
        endsAt: Date;
        note: string;
      }>(
        `SELECT access_kind AS "accessKind", ends_at AS "endsAt", note
           FROM org_ai_access_grants
          WHERE org_id = $1::uuid
            AND revoked_at IS NULL
            AND starts_at <= now()
            AND ends_at > now()
          ORDER BY ends_at DESC`,
        [orgId],
      );

      const weights = await client.query<{ request_kind: string; credits: number }>(
        `SELECT request_kind, credits FROM ai_credit_weights ORDER BY request_kind`,
      );

      const row = credits.rows[0];
      return {
        credits: row
          ? {
              onPlan: true,
              granted: Number(row.granted),
              spent: Number(row.spent),
              balance: Number(row.balance),
            }
          : { onPlan: false, granted: 0, spent: 0, balance: 0 },
        grants: grants.rows.map((grant) => ({
          accessKind: grant.accessKind,
          endsAt: grant.endsAt.toISOString(),
          note: grant.note,
        })),
        weights: weights.rows.map((weight) => ({
          requestKind: weight.request_kind,
          credits: Number(weight.credits),
        })),
      };
    });

    return Response.json(funding);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load AI funding";
    return Response.json({ error: message }, { status: 400 });
  }
}
