import {
  canonicalizeFreebuffModel,
  FREEBUFF_UNMETERED_DEFAULT,
  freebuffModelCatalog,
} from "@vantage/agent";
import { assertOrgCapability, auth } from "@vantage/core";
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

      let canManage = false;
      try {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        canManage = true;
      } catch {
        // Viewer can see funding but cannot flip the Free AI toggle.
      }

      let usePlatformFreeAi = true;
      let freebuffModel = FREEBUFF_UNMETERED_DEFAULT;
      try {
        const prefs = await client.query<{
          usePlatformFreeAi: boolean | null;
          freebuffModel: string | null;
        }>(
          `SELECT use_platform_free_ai AS "usePlatformFreeAi",
                  freebuff_model AS "freebuffModel"
             FROM org_byok_routing_prefs
            WHERE org_id = $1::uuid`,
          [orgId],
        );
        const prefsRow = prefs.rows[0];
        if (prefsRow) {
          usePlatformFreeAi = prefsRow.usePlatformFreeAi !== false;
          freebuffModel =
            canonicalizeFreebuffModel(prefsRow.freebuffModel) ?? FREEBUFF_UNMETERED_DEFAULT;
        }
      } catch {
        // Pre-0519: columns are absent — default ON + GLM.
      }

      let tokens: Array<{
        source: string;
        granted: number;
        spent: number;
        balance: number;
      }> = [];
      try {
        const tokenRows = await client.query<{
          source: string;
          granted: string;
          spent: string;
          balance: string;
        }>(
          `SELECT source, granted, spent, balance
             FROM org_ai_free_tokens
            WHERE org_id = $1::uuid
            ORDER BY source`,
          [orgId],
        );
        tokens = tokenRows.rows.map((row) => ({
          source: row.source,
          granted: Number(row.granted),
          spent: Number(row.spent),
          balance: Number(row.balance),
        }));
      } catch (error) {
        if (!(error instanceof Error) || !/org_ai_free_tokens|ai_free_token_ledger/.test(error.message)) {
          throw error;
        }
      }

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
        tokens,
        grants: grants.rows.map((grant) => ({
          accessKind: grant.accessKind,
          endsAt: grant.endsAt.toISOString(),
          note: grant.note,
        })),
        weights: weights.rows.map((weight) => ({
          requestKind: weight.request_kind,
          credits: Number(weight.credits),
        })),
        canManage,
        usePlatformFreeAi,
        freebuffModel,
        freebuffModels: freebuffModelCatalog(),
      };
    });

    return Response.json(funding);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load AI funding";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const body = (await request.json()) as {
      orgId?: string;
      usePlatformFreeAi?: boolean;
      freebuffModel?: string;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    const model = canonicalizeFreebuffModel(body.freebuffModel);
    if (body.freebuffModel && !model) {
      return Response.json(
        {
          error: "Free AI model must be DeepSeek V4 Flash, GLM 5.3 Flash, or MiMo 2.5.",
        },
        { status: 400 },
      );
    }

    const saved = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      await assertOrgCapability(client, body.orgId!, "manage_api_keys");
      const usePlatformFreeAi = body.usePlatformFreeAi !== false;
      const freebuffModel = model ?? FREEBUFF_UNMETERED_DEFAULT;
      try {
        await client.query(
          `INSERT INTO org_byok_routing_prefs
             (org_id, use_platform_free_ai, freebuff_model, updated_by, updated_at)
           VALUES ($1::uuid, $2, $3, $4::uuid, now())
           ON CONFLICT (org_id) DO UPDATE SET
             use_platform_free_ai = excluded.use_platform_free_ai,
             freebuff_model = excluded.freebuff_model,
             updated_by = excluded.updated_by,
             updated_at = now()`,
          [body.orgId, usePlatformFreeAi, freebuffModel, session.user.id],
        );
      } catch (error) {
        if (error instanceof Error && /use_platform_free_ai|freebuff_model/.test(error.message)) {
          throw new Error("Apply migration 0519_platform_free_ai_prefs.sql to save Free AI settings.", {
            cause: error,
          });
        }
        throw error;
      }
      return { usePlatformFreeAi, freebuffModel };
    });

    return Response.json({ ok: true, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Free AI settings";
    return Response.json({ error: message }, { status: 400 });
  }
}
