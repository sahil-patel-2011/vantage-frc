import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  platformAdminDeniedResponse,
  writeAdminAction,
} from "@vantage/core";
import {
  REQUEST_KINDS,
  grantFreeTokens,
  grantRequestCredits,
  isFreeTokenSource,
  isRequestKind,
  type OrgAiAccessKind,
} from "@vantage/billing";
import {
  describeFreeRelayRefusal,
  freeRelayRefusal,
  freebuffSelectableCatalog,
  readFreeRelayConfig,
} from "@vantage/agent";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Platform governance for per-team AI funding:
//   * push request credits to one team (1 request = 1 credit, weighted per kind),
//   * open a time-boxed window on a platform-owned AI path (free relay / sponsored
//     pool / hosted keys) and revoke it early,
//   * tune the chat-vs-agentic weights without a deploy.
//
// Every write is platform-admin + privilege-MFA gated and audited to admin_actions.
// Reads never invent a number: a team with no ledger rows reports a zero balance and
// an explicit "not on the credit plan" flag rather than a fabricated allowance.

// Only kinds the metering path actually honours are grantable. `sponsored_pool` is
// deliberately absent: nothing reads it, so offering it would let an admin open a window
// that changes nothing and then wonder why the team still has no AI. The sponsored promo
// has its own eligibility and expiry path (resolveSponsoredPromoForOrg) and is not
// something this screen can hand out. The type keeps the value so existing rows still
// parse.
const ACCESS_KINDS: readonly OrgAiAccessKind[] = ["platform_relay", "hosted_platform"];

const MAX_GRANT_CREDITS = 1_000_000;
const MAX_WINDOW_DAYS = 365;

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

export async function GET() {
  try {
    const current = await session();
    const data = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      const [teams, weights, grants] = await Promise.all([
        client.query(
          `SELECT o.id, o.name, o.team_number AS "teamNumber", b.tier,
                  COALESCE(c.granted, 0) AS granted,
                  COALESCE(c.spent, 0) AS spent,
                  COALESCE(c.balance, 0) AS balance,
                  (c.org_id IS NOT NULL) AS "onCreditPlan"
             FROM organizations o
             LEFT JOIN org_billing b ON b.org_id = o.id
             LEFT JOIN org_ai_request_credits c ON c.org_id = o.id
            ORDER BY o.team_number`,
        ),
        client.query(
          `SELECT request_kind AS "requestKind", credits, description
             FROM ai_credit_weights ORDER BY credits DESC, request_kind`,
        ),
        client.query(
          `SELECT g.id, g.org_id AS "orgId", o.team_number AS "teamNumber",
                  g.access_kind AS "accessKind", g.starts_at AS "startsAt",
                  g.ends_at AS "endsAt", g.revoked_at AS "revokedAt", g.note
             FROM org_ai_access_grants g
             JOIN organizations o ON o.id = g.org_id
            ORDER BY g.ends_at DESC
            LIMIT 200`,
        ),
      ]);
      let tokenBalances: unknown[] = [];
      try {
        const tokens = await client.query(
          `SELECT t.org_id AS "orgId", t.source, t.granted, t.spent, t.balance
             FROM org_ai_free_tokens t
            ORDER BY t.source`,
        );
        tokenBalances = tokens.rows;
      } catch (error) {
        if (!(error instanceof Error) || !/org_ai_free_tokens|ai_free_token_ledger/.test(error.message)) {
          throw error;
        }
      }
      const relayConfig = readFreeRelayConfig();
      const refusal = freeRelayRefusal();
      return {
        teams: teams.rows,
        weights: weights.rows,
        accessGrants: grants.rows,
        tokenBalances,
        relay: {
          configured: Boolean(relayConfig),
          model: relayConfig?.model ?? null,
          models: freebuffSelectableCatalog(),
          refusal: refusal ? describeFreeRelayRefusal(refusal) : null,
        },
      };
    });
    return Response.json(data);
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

type Body = {
  action?: string;
  orgId?: string;
  credits?: number;
  reason?: string;
  expiresInDays?: number;
  accessKind?: string;
  days?: number;
  note?: string;
  grantId?: string;
  requestKind?: string;
  preset?: "none" | "credits_100" | "unlimited";
  source?: string;
  tokens?: number;
};

const UNLIMITED_WINDOW_DAYS = 365;

async function upsertUsePlatformFreeAi(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  orgId: string,
  actorUserId: string,
  enabled: boolean,
) {
  try {
    await client.query(
      `INSERT INTO org_byok_routing_prefs
         (org_id, use_platform_free_ai, updated_by, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, now())
       ON CONFLICT (org_id) DO UPDATE SET
         use_platform_free_ai = excluded.use_platform_free_ai,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [orgId, enabled, actorUserId],
    );
  } catch (error) {
    if (error instanceof Error && /use_platform_free_ai/.test(error.message)) return;
    throw error;
  }
}

async function grantRelayWindow(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  input: { orgId: string; actorUserId: string; days: number; note: string },
) {
  const refusal = freeRelayRefusal();
  if (refusal) {
    throw new Error(
      `${describeFreeRelayRefusal(refusal)} Set FREE_RELAY_BASE_URL, FREE_RELAY_API_KEY, and FREE_RELAY_MODEL before granting relay access.`,
    );
  }
  const endsAt = new Date(Date.now() + input.days * 86_400_000);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO org_ai_access_grants(org_id, access_kind, ends_at, granted_by, note)
     VALUES ($1::uuid, 'platform_relay', $2, $3::uuid, $4)
     RETURNING id`,
    [input.orgId, endsAt, input.actorUserId, input.note],
  );
  await upsertUsePlatformFreeAi(client, input.orgId, input.actorUserId, true);
  return { grantId: inserted.rows[0]!.id, endsAt };
}

async function grantHostedWindow(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  input: { orgId: string; actorUserId: string; days: number; note: string },
) {
  const endsAt = new Date(Date.now() + input.days * 86_400_000);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO org_ai_access_grants(org_id, access_kind, ends_at, granted_by, note)
     VALUES ($1::uuid, 'hosted_platform', $2, $3::uuid, $4)
     RETURNING id`,
    [input.orgId, endsAt, input.actorUserId, input.note],
  );
  return { grantId: inserted.rows[0]!.id, endsAt };
}

async function applyFreeAiPreset(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  input: {
    orgId: string;
    actorUserId: string;
    preset: "none" | "credits_100" | "unlimited";
    note: string;
  },
) {
  if (input.preset === "none") {
    const revoked = await client.query<{ id: string }>(
      `UPDATE org_ai_access_grants SET revoked_at = now()
        WHERE org_id = $1::uuid
          AND access_kind = 'platform_relay'
          AND revoked_at IS NULL
        RETURNING id`,
      [input.orgId],
    );
    await upsertUsePlatformFreeAi(client, input.orgId, input.actorUserId, false);
    await writeAdminAction(client, {
      actorUserId: input.actorUserId,
      action: "ai_free.preset",
      targetOrgId: input.orgId,
      payload: { preset: "none", revoked: revoked.rows.map((row) => row.id) },
    });
    return { preset: "none" as const, revoked: revoked.rowCount ?? 0 };
  }

  const window = await grantRelayWindow(client, {
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    days: UNLIMITED_WINDOW_DAYS,
    note:
      input.note ||
      (input.preset === "unlimited" ? "Unlimited platform Free AI" : "100 request credits + Free AI"),
  });

  if (input.preset === "credits_100") {
    const ledgerId = await grantRequestCredits(client, {
      orgId: input.orgId,
      credits: 100,
      actorUserId: input.actorUserId,
      reason: input.note || "Free AI 100-request grant",
    });
    await writeAdminAction(client, {
      actorUserId: input.actorUserId,
      action: "ai_free.preset",
      targetOrgId: input.orgId,
      payload: {
        preset: "credits_100",
        grantId: window.grantId,
        endsAt: window.endsAt.toISOString(),
        ledgerId,
      },
    });
    return { preset: "credits_100" as const, credits: 100, endsAt: window.endsAt.toISOString() };
  }

  await writeAdminAction(client, {
    actorUserId: input.actorUserId,
    action: "ai_free.preset",
    targetOrgId: input.orgId,
    payload: { preset: "unlimited", grantId: window.grantId, endsAt: window.endsAt.toISOString() },
  });
  return { preset: "unlimited" as const, endsAt: window.endsAt.toISOString() };
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("A JSON body is required");
  }

  try {
    const current = await session();
    const result = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: current.user.id,
        sessionId: current.session.id,
      });

      switch (body.action) {
        case "gift_tokens": {
          if (!body.orgId) throw new Error("orgId is required");
          if (!isFreeTokenSource(body.source)) {
            throw new Error("source must be freebuff, hosted_platform, or credits");
          }
          const amount = Math.floor(Number(body.tokens ?? body.credits));
          if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_GRANT_CREDITS) {
            throw new Error(`amount must be a whole number between 1 and ${MAX_GRANT_CREDITS}`);
          }
          const days = Number(body.expiresInDays);
          const expiresAt =
            Number.isFinite(days) && days > 0
              ? new Date(Date.now() + Math.min(days, MAX_WINDOW_DAYS) * 86_400_000)
              : null;
          const reason = (body.reason ?? "").slice(0, 500);

          if (body.source === "credits") {
            const id = await grantRequestCredits(client, {
              orgId: body.orgId,
              credits: amount,
              actorUserId: current.user.id,
              reason: reason || "Gifted request credits",
              expiresAt,
            });
            await writeAdminAction(client, {
              actorUserId: current.user.id,
              action: "ai_tokens.gifted",
              targetOrgId: body.orgId,
              payload: { source: "credits", amount, expiresAt: expiresAt?.toISOString() ?? null, ledgerId: id },
            });
            return { source: "credits", tokens: amount, expiresAt: expiresAt?.toISOString() ?? null };
          }

          const ledgerId = await grantFreeTokens(client, {
            orgId: body.orgId,
            tokens: amount,
            source: body.source,
            actorUserId: current.user.id,
            reason: reason || (body.source === "freebuff" ? "Gifted Freebuff tokens" : "Gifted hosted tokens"),
            expiresAt,
          });
          const windowDays =
            Number.isFinite(days) && days > 0 ? Math.min(days, MAX_WINDOW_DAYS) : UNLIMITED_WINDOW_DAYS;
          if (body.source === "freebuff") {
            await grantRelayWindow(client, {
              orgId: body.orgId,
              actorUserId: current.user.id,
              days: windowDays,
              note: reason || "Gifted Freebuff tokens",
            });
          } else if (body.source === "hosted_platform") {
            await grantHostedWindow(client, {
              orgId: body.orgId,
              actorUserId: current.user.id,
              days: windowDays,
              note: reason || "Gifted hosted tokens",
            });
          }
          await writeAdminAction(client, {
            actorUserId: current.user.id,
            action: "ai_tokens.gifted",
            targetOrgId: body.orgId,
            payload: {
              source: body.source,
              amount,
              expiresAt: expiresAt?.toISOString() ?? null,
              ledgerId,
            },
          });
          return { source: body.source, tokens: amount, expiresAt: expiresAt?.toISOString() ?? null };
        }

        case "grant_credits": {
          if (!body.orgId) throw new Error("orgId is required");
          const credits = Math.floor(Number(body.credits));
          if (!Number.isFinite(credits) || credits <= 0 || credits > MAX_GRANT_CREDITS) {
            throw new Error(`credits must be a whole number between 1 and ${MAX_GRANT_CREDITS}`);
          }
          const days = Number(body.expiresInDays);
          const expiresAt =
            Number.isFinite(days) && days > 0
              ? new Date(Date.now() + Math.min(days, MAX_WINDOW_DAYS) * 86_400_000)
              : null;
          const id = await grantRequestCredits(client, {
            orgId: body.orgId,
            credits,
            actorUserId: current.user.id,
            reason: (body.reason ?? "").slice(0, 500),
            expiresAt,
          });
          await writeAdminAction(client, {
            actorUserId: current.user.id,
            action: "ai_request_credits.granted",
            targetOrgId: body.orgId,
            payload: { credits, expiresAt: expiresAt?.toISOString() ?? null, ledgerId: id },
          });
          return { granted: credits, expiresAt: expiresAt?.toISOString() ?? null };
        }

        case "set_free_ai": {
          if (!body.orgId) throw new Error("orgId is required");
          const preset = body.preset;
          if (preset !== "none" && preset !== "credits_100" && preset !== "unlimited") {
            throw new Error("preset must be none, credits_100, or unlimited");
          }
          return applyFreeAiPreset(client, {
            orgId: body.orgId,
            actorUserId: current.user.id,
            preset,
            note: (body.note ?? "").slice(0, 500),
          });
        }

        case "grant_access": {
          if (!body.orgId) throw new Error("orgId is required");
          const accessKind = body.accessKind as OrgAiAccessKind;
          if (!ACCESS_KINDS.includes(accessKind)) {
            throw new Error(`accessKind must be one of ${ACCESS_KINDS.join(", ")}`);
          }
          // Catch the operator mistake here rather than at request time: a relay grant
          // on a deployment with no usable relay would just look like a broken team.
          // A base URL that is present but refused (internet-reachable with no key)
          // reports its own reason so the fix is obvious.
          if (accessKind === "platform_relay") {
            const refusal = freeRelayRefusal();
            if (refusal) {
              throw new Error(
                `${describeFreeRelayRefusal(refusal)} Set FREE_RELAY_BASE_URL, FREE_RELAY_API_KEY, and FREE_RELAY_MODEL before granting relay access.`,
              );
            }
          }
          const days = Math.floor(Number(body.days));
          if (!Number.isFinite(days) || days <= 0 || days > MAX_WINDOW_DAYS) {
            throw new Error(`days must be a whole number between 1 and ${MAX_WINDOW_DAYS}`);
          }
          const endsAt = new Date(Date.now() + days * 86_400_000);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO org_ai_access_grants(org_id, access_kind, ends_at, granted_by, note)
             VALUES ($1::uuid, $2, $3, $4::uuid, $5)
             RETURNING id`,
            [body.orgId, accessKind, endsAt, current.user.id, (body.note ?? "").slice(0, 500)],
          );
          await writeAdminAction(client, {
            actorUserId: current.user.id,
            action: "ai_access.granted",
            targetOrgId: body.orgId,
            payload: { accessKind, endsAt: endsAt.toISOString(), grantId: inserted.rows[0]!.id },
          });
          if (accessKind === "platform_relay") {
            await upsertUsePlatformFreeAi(client, body.orgId, current.user.id, true);
          }
          return { accessKind, endsAt: endsAt.toISOString() };
        }

        case "revoke_access": {
          if (!body.grantId) throw new Error("grantId is required");
          const revoked = await client.query<{ org_id: string; access_kind: string }>(
            `UPDATE org_ai_access_grants SET revoked_at = now()
              WHERE id = $1::uuid AND revoked_at IS NULL
              RETURNING org_id, access_kind`,
            [body.grantId],
          );
          if (!revoked.rows[0]) throw new Error("That access grant is already revoked or not found");
          await writeAdminAction(client, {
            actorUserId: current.user.id,
            action: "ai_access.revoked",
            targetOrgId: revoked.rows[0].org_id,
            payload: { grantId: body.grantId, accessKind: revoked.rows[0].access_kind },
          });
          return { revoked: true };
        }

        case "set_weight": {
          if (!isRequestKind(body.requestKind)) {
            throw new Error(`requestKind must be one of ${REQUEST_KINDS.join(", ")}`);
          }
          const credits = Math.floor(Number(body.credits));
          if (!Number.isFinite(credits) || credits < 0 || credits > 1000) {
            throw new Error("credits must be a whole number between 0 and 1000");
          }
          await client.query(
            `UPDATE ai_credit_weights
                SET credits = $2, updated_by = $3::uuid, updated_at = now()
              WHERE request_kind = $1`,
            [body.requestKind, credits, current.user.id],
          );
          await writeAdminAction(client, {
            actorUserId: current.user.id,
            action: "ai_credit_weight.updated",
            payload: { requestKind: body.requestKind, credits },
          });
          return { requestKind: body.requestKind, credits };
        }

        default:
          throw new Error(
            "action must be gift_tokens, grant_credits, grant_access, revoke_access, set_weight, or set_free_ai",
          );
      }
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    if (
      error instanceof Error &&
      /platform administrator|authentication required|verification/i.test(error.message)
    ) {
      return platformAdminDeniedResponse(error);
    }
    return badRequest(error instanceof Error ? error.message : "AI grant update failed");
  }
}
