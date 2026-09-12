import type { PoolClient } from "@neondatabase/serverless";
import { daysUntil, evaluateGrantEligibility } from ".";
import type { CatalogGrant, GrantEligibilityRules, GrantMatch, TeamEligibilityProfile } from "./types";

export type GrantEligibilitySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type GrantEligibilityView =
  | {
      status: "setup_required";
      message: string;
      steps: GrantEligibilitySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      profile: TeamEligibilityProfile;
      eligible: GrantMatch[];
      ineligible: GrantMatch[];
      upcomingDeadlines: GrantMatch[];
      catalogSize: number;
      computedAt: string;
    };

type CatalogRow = {
  id: string;
  name: string;
  funder: string;
  description: string | null;
  amountMin: number | null;
  amountMax: number | null;
  applicationUrl: string | null;
  eligibilityRules: GrantEligibilityRules;
  deadlineType: CatalogGrant["deadlineType"];
  deadlineDate: string | null;
  seasonYear: number | null;
  isActive: boolean;
};

function mapCatalogRow(row: CatalogRow): CatalogGrant {
  return {
    id: row.id,
    name: row.name,
    funder: row.funder,
    description: row.description,
    amountMin: row.amountMin != null ? Number(row.amountMin) : null,
    amountMax: row.amountMax != null ? Number(row.amountMax) : null,
    applicationUrl: row.applicationUrl,
    eligibilityRules: row.eligibilityRules ?? {},
    deadlineType: row.deadlineType,
    deadlineDate: row.deadlineDate,
    seasonYear: row.seasonYear,
    isActive: row.isActive,
  };
}

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

async function loadTeamProfile(
  client: PoolClient,
  orgId: string,
  teamNumber: number | null,
): Promise<TeamEligibilityProfile> {
  const [orgResult, refResult, backgroundResult, matcherProfileResult] = await Promise.all([
    client.query<{ region: string | null }>(`SELECT state_prov AS region FROM organizations WHERE id = $1`, [orgId]),
    teamNumber
      ? client.query<{ rookieYear: number | null; country: string | null }>(
          `SELECT rookie_year AS "rookieYear", country FROM teams_ref WHERE team_number = $1 LIMIT 1`,
          [teamNumber],
        )
      : Promise.resolve({ rows: [] as Array<{ rookieYear: number | null; country: string | null }> }),
    client.query<{ demographics: string | null; studentCount: number | null; mentorCount: number | null }>(
      `SELECT demographics, student_count AS "studentCount", mentor_count AS "mentorCount"
       FROM team_background_profile WHERE org_id = $1`,
      [orgId],
    ),
    client.query<{ mentorEmployers: string[] }>(
      `SELECT mentor_employers AS "mentorEmployers" FROM grant_eligibility_matcher_profile WHERE org_id = $1`,
      [orgId],
    ),
  ]);

  const region = orgResult.rows[0]?.region ?? null;
  const rookieYear = refResult.rows[0]?.rookieYear ?? null;
  const country = refResult.rows[0]?.country ?? null;
  const background = backgroundResult.rows[0] ?? null;
  const mentorEmployers = matcherProfileResult.rows[0]?.mentorEmployers ?? [];

  const missingFields: string[] = [];
  if (!region) missingFields.push("region");
  if (rookieYear == null) missingFields.push("rookie year");
  if (!background?.demographics) missingFields.push("demographics narrative");
  if (background?.studentCount == null) missingFields.push("student count");
  if (background?.mentorCount == null) missingFields.push("mentor count");
  if (mentorEmployers.length === 0) missingFields.push("mentor employers");

  return {
    orgId,
    teamNumber,
    rookieYear,
    region,
    country,
    studentCount: background?.studentCount ?? null,
    mentorCount: background?.mentorCount ?? null,
    hasDemographicsFocus: !!background?.demographics,
    mentorEmployers,
    missingFields,
  };
}

/** Recompute every catalog grant's eligibility for this org and upsert the match snapshot. */
async function recomputeMatches(client: PoolClient, orgId: string, profile: TeamEligibilityProfile): Promise<CatalogGrant[]> {
  const catalogResult = await client.query<CatalogRow>(
    `SELECT id, name, funder, description, amount_min AS "amountMin", amount_max AS "amountMax",
            application_url AS "applicationUrl", eligibility_rules AS "eligibilityRules",
            deadline_type AS "deadlineType", deadline_date::text AS "deadlineDate",
            season_year AS "seasonYear", is_active AS "isActive"
     FROM grant_eligibility_matcher_catalog
     WHERE is_active = true
     ORDER BY deadline_date ASC NULLS LAST, name ASC`,
  );
  const catalog = catalogResult.rows.map(mapCatalogRow);

  for (const grant of catalog) {
    const outcome = evaluateGrantEligibility(profile, grant);
    await client.query(
      `INSERT INTO grant_eligibility_matcher_matches (org_id, grant_id, is_eligible, score, matched_reasons, unmet_reasons, computed_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6::text[], now())
       ON CONFLICT (org_id, grant_id) DO UPDATE SET
         is_eligible = EXCLUDED.is_eligible,
         score = EXCLUDED.score,
         matched_reasons = EXCLUDED.matched_reasons,
         unmet_reasons = EXCLUDED.unmet_reasons,
         computed_at = now()`,
      [orgId, grant.id, outcome.isEligible, outcome.score, outcome.matchedReasons, outcome.unmetReasons],
    );
  }

  return catalog;
}

type MatchRow = {
  id: string;
  grantId: string;
  isEligible: boolean;
  score: number;
  matchedReasons: string[];
  unmetReasons: string[];
  deadlineFlaggedAt: string | null;
  dismissedAt: string | null;
  computedAt: string;
};

export async function computeGrantEligibilityView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<GrantEligibilityView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to see grants your team qualifies for.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const profile = await loadTeamProfile(client, org.orgId, org.teamNumber);
  const catalog = await recomputeMatches(client, org.orgId, profile);

  if (catalog.length === 0) {
    return {
      status: "setup_required",
      message: "No grants are in the catalog yet. A platform admin adds and maintains the grants catalog.",
      steps: [
        { id: "profile", label: "Complete team profile", detail: "Region, rookie year, and mentor details improve matches", href: "/settings/team" },
      ],
      orgId: org.orgId,
    };
  }

  const matchResult = await client.query<MatchRow>(
    `SELECT id, grant_id AS "grantId", is_eligible AS "isEligible", score,
            matched_reasons AS "matchedReasons", unmet_reasons AS "unmetReasons",
            deadline_flagged_at AS "deadlineFlaggedAt", dismissed_at AS "dismissedAt",
            computed_at AS "computedAt"
     FROM grant_eligibility_matcher_matches
     WHERE org_id = $1 AND dismissed_at IS NULL`,
    [org.orgId],
  );

  const catalogById = new Map(catalog.map((g) => [g.id, g]));
  const matches: GrantMatch[] = matchResult.rows
    .map((row) => {
      const grant = catalogById.get(row.grantId);
      if (!grant) return null;
      return {
        id: row.id,
        grantId: row.grantId,
        grant,
        isEligible: row.isEligible,
        score: row.score,
        matchedReasons: row.matchedReasons ?? [],
        unmetReasons: row.unmetReasons ?? [],
        deadlineFlaggedAt: row.deadlineFlaggedAt,
        dismissedAt: row.dismissedAt,
        computedAt: row.computedAt,
        daysUntilDeadline: daysUntil(grant.deadlineDate),
      } satisfies GrantMatch;
    })
    .filter((m): m is GrantMatch => m != null)
    .sort((a, b) => b.score - a.score);

  const eligible = matches.filter((m) => m.isEligible);
  const ineligible = matches.filter((m) => !m.isEligible);
  const upcomingDeadlines = eligible
    .filter((m) => m.daysUntilDeadline != null && m.daysUntilDeadline >= 0 && m.daysUntilDeadline <= 45)
    .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    profile,
    eligible,
    ineligible,
    upcomingDeadlines,
    catalogSize: catalog.length,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setMentorEmployers(
  client: PoolClient,
  input: { orgId: string; userId: string; mentorEmployers: string[] },
): Promise<void> {
  await client.query(
    `INSERT INTO grant_eligibility_matcher_profile (org_id, mentor_employers, updated_by, updated_at)
     VALUES ($1, $2::text[], $3, now())
     ON CONFLICT (org_id) DO UPDATE SET
       mentor_employers = EXCLUDED.mentor_employers,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.mentorEmployers, input.userId],
  );
}

export async function dismissMatch(client: PoolClient, input: { orgId: string; matchId: string }): Promise<void> {
  await client.query(
    `UPDATE grant_eligibility_matcher_matches SET dismissed_at = now() WHERE id = $1 AND org_id = $2`,
    [input.matchId, input.orgId],
  );
}
