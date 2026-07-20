import type { PoolClient } from "@neondatabase/serverless";

/**
 * Team 1111 promotional free-tier AI (platform-sponsored keys).
 * Env vars (names only — values in Vercel / gitignored .env.local):
 *   MISTRAL_API_KEY, CEREBRAS_API_KEY, GROQ_API_KEY, COHERE_API_KEY
 * Failover order is owned by @vantage/agent sponsored-provider-pool.
 */

/** FRC team number eligible for the promotional sponsored pool. */
export const SPONSORED_PROMO_TEAM_NUMBER = 1111;

/**
 * Promo window end (inclusive through this UTC calendar day).
 * ~90 days from 2026-07-20 → 2026-10-18.
 */
export const SPONSORED_PROMO_ENDS_AT = new Date("2026-10-18T23:59:59.999Z");

/** Stable notification type for Soft-UI / in-app inbox. */
export const SPONSORED_PROMO_EXPIRED_NOTIFICATION = "sponsored_promo.expired";

export type SponsoredPromoStatus =
  | { eligible: true; teamNumber: number; endsAt: string; fundingMode: "sponsored" }
  | {
      eligible: false;
      reason: "wrong_team" | "promo_expired" | "no_team_number" | "keys_missing";
      teamNumber: number | null;
      endsAt: string;
      fundingMode: "sponsored";
      message: string;
    };

export function sponsoredPromoEndsAtIso(): string {
  return SPONSORED_PROMO_ENDS_AT.toISOString();
}

export function isSponsoredPromoWindowOpen(now: Date = new Date()): boolean {
  return now.getTime() <= SPONSORED_PROMO_ENDS_AT.getTime();
}

export function sponsoredPromoExpiredMessage(teamNumber = SPONSORED_PROMO_TEAM_NUMBER): string {
  return (
    `Promotional sponsored AI for team ${teamNumber} ended on ` +
    `${SPONSORED_PROMO_ENDS_AT.toISOString().slice(0, 10)}. ` +
    `Add your own OpenAI, Anthropic, or Google key under Team → AI API keys, or upgrade for hosted AI.`
  );
}

/** Pure eligibility check from org team number (no env / DB). */
export function evaluateSponsoredPromoEligibility(input: {
  teamNumber: number | null | undefined;
  now?: Date;
}): SponsoredPromoStatus {
  const endsAt = sponsoredPromoEndsAtIso();
  const teamNumber =
    input.teamNumber === null || input.teamNumber === undefined
      ? null
      : Number(input.teamNumber);

  if (teamNumber === null || !Number.isFinite(teamNumber)) {
    return {
      eligible: false,
      reason: "no_team_number",
      teamNumber: null,
      endsAt,
      fundingMode: "sponsored",
      message: "Organization has no team number; sponsored promo does not apply.",
    };
  }

  if (teamNumber !== SPONSORED_PROMO_TEAM_NUMBER) {
    return {
      eligible: false,
      reason: "wrong_team",
      teamNumber,
      endsAt,
      fundingMode: "sponsored",
      message: `Sponsored promo is limited to team ${SPONSORED_PROMO_TEAM_NUMBER}.`,
    };
  }

  if (!isSponsoredPromoWindowOpen(input.now ?? new Date())) {
    return {
      eligible: false,
      reason: "promo_expired",
      teamNumber,
      endsAt,
      fundingMode: "sponsored",
      message: sponsoredPromoExpiredMessage(teamNumber),
    };
  }

  return {
    eligible: true,
    teamNumber,
    endsAt,
    fundingMode: "sponsored",
  };
}

/** True when at least one sponsored provider env key is present (no values logged). */
export function hasAnySponsoredProviderEnvKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.MISTRAL_API_KEY?.trim() ||
      env.CEREBRAS_API_KEY?.trim() ||
      env.GROQ_API_KEY?.trim() ||
      env.COHERE_API_KEY?.trim(),
  );
}

export async function loadOrgTeamNumber(
  client: PoolClient,
  orgId: string,
): Promise<number | null> {
  const result = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
    [orgId],
  );
  const raw = result.rows[0]?.teamNumber;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve whether this org may use the platform sponsored promo pool right now.
 * Does not invent metrics — eligibility is team number + date + env keys only.
 */
export async function resolveSponsoredPromoForOrg(
  client: PoolClient,
  orgId: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SponsoredPromoStatus> {
  const teamNumber = await loadOrgTeamNumber(client, orgId);
  const base = evaluateSponsoredPromoEligibility({ teamNumber, now });
  if (!base.eligible) return base;
  if (!hasAnySponsoredProviderEnvKey(env)) {
    return {
      eligible: false,
      reason: "keys_missing",
      teamNumber: base.teamNumber,
      endsAt: base.endsAt,
      fundingMode: "sponsored",
      message:
        "Sponsored promo keys are not configured on this deployment. Set MISTRAL_API_KEY / CEREBRAS_API_KEY / GROQ_API_KEY / COHERE_API_KEY.",
    };
  }
  return base;
}

/**
 * Notify org owners/admins once per UTC day that the team 1111 promo ended.
 * Safe to call from request paths; no-ops when not expired or already notified today.
 */
export async function maybeNotifySponsoredPromoExpired(
  client: PoolClient,
  orgId: string,
  status: SponsoredPromoStatus,
): Promise<boolean> {
  if (status.eligible || status.reason !== "promo_expired") return false;
  if (status.teamNumber !== SPONSORED_PROMO_TEAM_NUMBER) return false;

  const existing = await client.query(
    `SELECT 1 FROM notifications
      WHERE org_id = $1::uuid
        AND type = $2
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
      LIMIT 1`,
    [orgId, SPONSORED_PROMO_EXPIRED_NOTIFICATION],
  );
  if (existing.rows.length > 0) return false;

  await client.query(
    `INSERT INTO notifications(user_id, org_id, type, payload)
     SELECT user_id, $1::uuid, $2, $3::jsonb
       FROM memberships
      WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [
      orgId,
      SPONSORED_PROMO_EXPIRED_NOTIFICATION,
      JSON.stringify({
        teamNumber: status.teamNumber,
        endsAt: status.endsAt,
        message: status.message,
        reminderFor: "platform_owner",
      }),
    ],
  );
  return true;
}
