import type { PoolClient } from "@neondatabase/serverless";
import { buildSponsorTierRows, summarizeSponsorTierCalculator } from ".";
import type {
  AssignedSponsorTier,
  SponsorTierCalcRow,
  SponsorTierCalculatorSummary,
  SponsorTierDefinition,
} from "./types";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type SponsorTierCalculatorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SponsorTierCalculatorView =
  | {
      status: "setup_required";
      message: string;
      steps: SponsorTierCalculatorSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      tiers: SponsorTierDefinition[];
      rows: SponsorTierCalcRow[];
      summary: SponsorTierCalculatorSummary;
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

type TierRow = {
  id: string;
  name: string;
  minAmountUsd: string | number;
  benefits: string[] | null;
  sortOrder: number;
};

function mapTier(row: TierRow): SponsorTierDefinition {
  return {
    id: row.id,
    name: row.name,
    minAmountUsd: Number(row.minAmountUsd) || 0,
    benefits: Array.isArray(row.benefits) ? row.benefits : [],
    sortOrder: Number(row.sortOrder) || 0,
  };
}

export async function computeSponsorTierCalculatorView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SponsorTierCalculatorView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to plan sponsor tiers and recognition benefits.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [tiersResult, sponsorsResult, contributionsResult, fulfillmentsResult, seasonResult] = await Promise.all([
    client.query<TierRow>(
      `SELECT id, name, min_amount_usd AS "minAmountUsd", benefits, sort_order AS "sortOrder"
       FROM sponsor_tier_calculator_tiers
       WHERE org_id = $1
       ORDER BY min_amount_usd DESC, sort_order ASC`,
      [org.orgId],
    ),
    client.query<{ id: string; name: string; tier: AssignedSponsorTier }>(
      `SELECT id, name, tier FROM sponsors WHERE org_id = $1 AND status <> 'declined' ORDER BY name`,
      [org.orgId],
    ),
    client.query<{ sponsorId: string; total: string }>(
      `SELECT sponsor_id AS "sponsorId",
              COALESCE(SUM(CASE WHEN type = 'cash'
                                THEN COALESCE(amount_usd, 0)
                                ELSE COALESCE(estimated_value_usd, amount_usd, 0) END), 0) AS total
       FROM sponsor_contributions
       WHERE org_id = $1 AND season_year = $2
       GROUP BY sponsor_id`,
      [org.orgId, seasonYear],
    ),
    client.query<{
      sponsorId: string;
      benefit: string;
      fulfilled: boolean;
      fulfilledAt: string | null;
      notes: string | null;
    }>(
      `SELECT sponsor_id AS "sponsorId", benefit, fulfilled,
              fulfilled_at::text AS "fulfilledAt", notes
       FROM sponsor_tier_calculator_fulfillments
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM sponsor_contributions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const tiers = tiersResult.rows.map(mapTier);
  const contributionTotals = new Map<string, number>(
    contributionsResult.rows.map((row) => [row.sponsorId, Number(row.total) || 0]),
  );
  const rows = buildSponsorTierRows({
    sponsors: sponsorsResult.rows,
    contributionTotals,
    tiers,
    fulfillments: fulfillmentsResult.rows,
  });
  const summary = summarizeSponsorTierCalculator(rows, tiers);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    tiers,
    rows,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertTierDefinition(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    minAmountUsd: number;
    benefits: string[];
    sortOrder: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_tier_calculator_tiers (org_id, name, min_amount_usd, benefits, sort_order, created_by)
     VALUES ($1,$2,$3,$4::text[],$5,$6)
     ON CONFLICT (org_id, name) DO UPDATE SET
       min_amount_usd = EXCLUDED.min_amount_usd,
       benefits = EXCLUDED.benefits,
       sort_order = EXCLUDED.sort_order,
       updated_at = now()`,
    [input.orgId, input.name, input.minAmountUsd, input.benefits, input.sortOrder, input.userId],
  );
}

export async function deleteTierDefinition(
  client: PoolClient,
  input: { orgId: string; tierId: string },
): Promise<void> {
  await client.query(`DELETE FROM sponsor_tier_calculator_tiers WHERE id = $1 AND org_id = $2`, [
    input.tierId,
    input.orgId,
  ]);
}

export async function setBenefitFulfillment(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sponsorId: string;
    seasonYear: number;
    benefit: string;
    fulfilled: boolean;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_tier_calculator_fulfillments
       (org_id, sponsor_id, season_year, benefit, fulfilled, fulfilled_at, notes, logged_by)
     VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN now() ELSE NULL END,$6,$7)
     ON CONFLICT (sponsor_id, season_year, benefit) DO UPDATE SET
       fulfilled = EXCLUDED.fulfilled,
       fulfilled_at = CASE WHEN EXCLUDED.fulfilled THEN COALESCE(sponsor_tier_calculator_fulfillments.fulfilled_at, now()) ELSE NULL END,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [input.orgId, input.sponsorId, input.seasonYear, input.benefit, input.fulfilled, input.notes, input.userId],
  );
}
