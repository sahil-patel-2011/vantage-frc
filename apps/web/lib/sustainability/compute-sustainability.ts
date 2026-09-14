// Sustainability signal reader. Request-path only: every query runs on the `withRls`
// PoolClient with parameterized SQL. Never imports @vantage/db/admin.
//
// This file's only job is to turn REAL recorded rows into `SustainabilitySignals`. It does no
// judging — `assessSustainability` in ./risk.ts owns every threshold — and it never substitutes
// a default for a missing row. A team that has recorded nothing produces empty/null signals,
// which the model reports as `unknown` with a to-record list.
//
// Row sources (verified against the migrations that created them):
//   finance_funding_sources (0434)  season_year, kind, name, received_usd
//   sponsors (0035 + 0150)          pipeline_stage for live prospects
//   grant_calendar_opportunities    (0458) closes_on for a re-application window
//   grant_applications (0036)       season_year + status for "already re-applied"
//   team_background_profile (0162)  student_count, mentor_count

import type { PoolClient } from "@neondatabase/serverless";
import { assessSustainability } from "./risk";
import type { SustainabilityAssessment, SustainabilitySignals } from "./types";

/** How far ahead we look for a re-application window closing. */
export const EXPIRY_LOOKAHEAD_DAYS = 120;

export type SustainabilityView =
  | {
      status: "setup_required";
      message: string;
      /** What to record, in the order that unlocks the most. */
      steps: Array<{ id: string; label: string; detail: string; href: string }>;
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      seasonYear: number;
      assessment: SustainabilityAssessment;
      computedAt: string;
    };

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * FRC seasons are named for the championship year and the next season kicks off in January,
 * so from September on we are already working the following year's season.
 */
export function currentSeasonYear(now = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function daysBetween(fromIso: string, now: Date): number {
  const target = Date.parse(`${fromIso}T00:00:00Z`);
  if (!Number.isFinite(target)) return 0;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - startOfToday) / 86_400_000);
}

/**
 * Read every signal the model can use for one org+season.
 *
 * Exported separately from `computeSustainabilityView` so the alert worker and any future
 * digest can reuse the exact same reads rather than drifting into a second definition.
 */
export async function loadSustainabilitySignals(
  client: PoolClient,
  input: { orgId: string; seasonYear: number; now?: Date },
): Promise<SustainabilitySignals> {
  const now = input.now ?? new Date();

  // ---- Funding sources actually received this season -------------------------------------
  const sources = await client.query<{
    id: string;
    name: string;
    kind: string;
    receivedUsd: string | null;
  }>(
    `SELECT id, name, kind, received_usd::text AS "receivedUsd"
     FROM finance_funding_sources
     WHERE org_id = $1::uuid AND season_year = $2::int
     ORDER BY received_usd DESC NULLS LAST, name`,
    [input.orgId, input.seasonYear],
  );

  // ---- Prior season total, recomputed rather than trusted ---------------------------------
  const prior = await client.query<{ total: string | null; rows: number }>(
    `SELECT SUM(received_usd)::text AS total, COUNT(*)::int AS rows
     FROM finance_funding_sources
     WHERE org_id = $1::uuid AND season_year = $2::int`,
    [input.orgId, input.seasonYear - 1],
  );
  const priorRow = prior.rows[0];
  // No prior-season rows at all means "we were not using Vantage yet", NOT "funding was zero".
  // Reporting 0 there would manufacture a -100% cliff out of thin air.
  const priorSeasonTotalUsd =
    priorRow && priorRow.rows > 0 ? (toNumber(priorRow.total) ?? null) : null;

  // ---- Live sponsor pipeline (anything not yet a closed, active sponsor) ------------------
  const prospects = await client.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM sponsors
     WHERE org_id = $1::uuid
       AND pipeline_stage IN ('prospect', 'ask', 'visit', 'pledged')`,
    [input.orgId],
  );

  // ---- Grants we rely on whose re-application window closes soon --------------------------
  // Only an EXACT name match between a recorded grant funding source and a calendar row counts.
  // A fuzzy match here would put a made-up deadline in front of a mentor, so when nothing
  // matches the factor simply does not appear.
  const expiring = await client.query<{
    id: string;
    name: string;
    amountUsd: string | null;
    endsOn: string;
    replaced: boolean;
  }>(
    `SELECT g.id,
            g.name,
            f.received_usd::text AS "amountUsd",
            g.closes_on::text AS "endsOn",
            -- "Replaced" means the team has actually ACTED on next season's funding, not
            -- that it intends to. A draft nobody submitted is not a replacement, and
            -- counting it would silence the one warning this whole feature exists to give.
            EXISTS (
              SELECT 1 FROM grant_applications a
              WHERE a.org_id = $1::uuid
                AND a.season_year >= $2::int
                AND a.status IN ('submitted', 'awarded')
            ) AS replaced
     FROM finance_funding_sources f
     JOIN grant_calendar_opportunities g
       ON LOWER(BTRIM(g.name)) = LOWER(BTRIM(f.name))
      AND (g.org_id IS NULL OR g.org_id = $1::uuid)
      AND g.is_active = true
      AND g.closes_on IS NOT NULL
      AND g.closes_on >= CURRENT_DATE
      AND g.closes_on <= CURRENT_DATE + ($3::int * INTERVAL '1 day')
     WHERE f.org_id = $1::uuid
       AND f.kind = 'grant'
       AND f.received_usd > 0
       AND f.season_year IN ($2::int, $2::int - 1)
     ORDER BY g.closes_on`,
    [input.orgId, input.seasonYear, EXPIRY_LOOKAHEAD_DAYS],
  );

  // ---- Roster depth, only if recorded -----------------------------------------------------
  const background = await client.query<{
    studentCount: number | null;
    mentorCount: number | null;
  }>(
    `SELECT student_count AS "studentCount", mentor_count AS "mentorCount"
     FROM team_background_profile
     WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const bg = background.rows[0];

  // Dedupe by calendar row: one funding source per opportunity is enough to warn once.
  const seenOpportunities = new Set<string>();
  const expiringGrants: SustainabilitySignals["expiringGrants"] = [];
  for (const row of expiring.rows) {
    if (seenOpportunities.has(row.id)) continue;
    seenOpportunities.add(row.id);
    expiringGrants.push({
      id: row.id,
      name: row.name,
      amountUsd: toNumber(row.amountUsd),
      endsOn: row.endsOn,
      daysUntilEnd: daysBetween(row.endsOn, now),
      replaced: Boolean(row.replaced),
    });
  }

  return {
    seasonYear: input.seasonYear,
    fundingSources: sources.rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      receivedUsd: toNumber(row.receivedUsd) ?? 0,
    })),
    priorSeasonTotalUsd,
    expiringGrants,
    pipelineProspectCount: toNumber(prospects.rows[0]?.total),
    studentCount: toNumber(bg?.studentCount),
    mentorCount: toNumber(bg?.mentorCount),
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string } | null> {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

/** The panel payload: signals read, then handed to the pure model. */
export async function computeSustainabilityView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number; now?: Date },
): Promise<SustainabilityView> {
  const now = input.now ?? new Date();
  const membership = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!membership) {
    return {
      status: "setup_required",
      message:
        "Choose your team to read your sustainability signal. It is computed only from rows your team recorded.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
    };
  }

  const seasonYear = input.seasonYear ?? currentSeasonYear(now);
  const signals = await loadSustainabilitySignals(client, {
    orgId: membership.orgId,
    seasonYear,
    now,
  });

  return {
    status: "live",
    orgId: membership.orgId,
    seasonYear,
    assessment: assessSustainability(signals, membership.orgId),
    computedAt: now.toISOString(),
  };
}
