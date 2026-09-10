// Grant calendar read/write layer. Request-path only: every query runs on the `withRls`
// PoolClient with parameterized SQL. Never imports @vantage/db/admin.

import type { PoolClient } from "@neondatabase/serverless";
import { matchOpportunities } from "./eligibility";
import type {
  GrantCalendarMatch,
  GrantCalendarOpportunity,
  GrantEligibilityRules,
  OrgGrantProfile,
} from "./types";

export type GrantCalendarSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type GrantCalendarEntry = GrantCalendarMatch & {
  /** True when the signed-in member is watching this grant. */
  watching: boolean;
  /** Whether that watch wants email/in-app alerts. */
  notify: boolean;
  /** How many people on this team are watching (so two mentors don't chase the same grant). */
  watcherCount: number;
  /** True for a row this team added itself (editable/removable). */
  teamAdded: boolean;
};

export type GrantCalendarView =
  | {
      status: "setup_required";
      message: string;
      steps: GrantCalendarSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      seasonYear: number;
      canManage: boolean;
      profile: OrgGrantProfile;
      /** Human-readable list of the profile gaps that produce `unknown` verdicts. */
      profileGaps: string[];
      entries: GrantCalendarEntry[];
      platformCount: number;
      teamCount: number;
      computedAt: string;
    };

const PROFILE_GAP_COPY: Record<string, string> = {
  rookieYear: "Rookie year (link your team number so we can read it from FIRST's team data).",
  seasonYear: "Current season.",
  stateProv: "Team state or province (Team settings).",
  titleI: "Title I status of your school.",
  nonprofit501c3: "Whether your team holds its own 501(c)(3).",
  studentCount: "Student count (Team background).",
  mentorCount: "Mentor count (Team background).",
};

function currentSeasonYear(now = new Date()): number {
  // FRC seasons are named for the calendar year of championship; the next season's kickoff is
  // in January, so anything from September on already belongs to next year's season.
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; role: string } | null> {
  const membership = await client.query<{ orgId: string; role: string }>(
    `SELECT m.org_id AS "orgId", m.role::text AS role
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

/** Read every profile field the eligibility rules can ask about. Unrecorded stays null. */
export async function loadOrgGrantProfile(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<OrgGrantProfile> {
  const result = await client.query<{
    teamNumber: number | null;
    rookieYear: number | null;
    stateProv: string | null;
    country: string | null;
    titleI: boolean | null;
    nonprofit501c3: boolean | null;
    studentCount: number | null;
    mentorCount: number | null;
  }>(
    `SELECT o.team_number AS "teamNumber",
            t.rookie_year AS "rookieYear",
            NULLIF(BTRIM(COALESCE(o.state_prov, '')), '') AS "stateProv",
            NULLIF(BTRIM(COALESCE(t.country, '')), '') AS country,
            b.title_i AS "titleI",
            b.nonprofit_501c3 AS "nonprofit501c3",
            b.student_count AS "studentCount",
            b.mentor_count AS "mentorCount"
     FROM organizations o
     LEFT JOIN teams_ref t ON t.team_number = o.team_number
     LEFT JOIN team_background_profile b ON b.org_id = o.id
     WHERE o.id = $1::uuid`,
    [orgId],
  );
  const row = result.rows[0];
  return {
    orgId,
    teamNumber: toNumber(row?.teamNumber),
    rookieYear: toNumber(row?.rookieYear),
    seasonYear,
    stateProv: row?.stateProv ?? null,
    country: row?.country ?? null,
    titleI: toBoolean(row?.titleI),
    nonprofit501c3: toBoolean(row?.nonprofit501c3),
    studentCount: toNumber(row?.studentCount),
    mentorCount: toNumber(row?.mentorCount),
  };
}

type OpportunityRow = {
  id: string;
  orgId: string | null;
  name: string;
  funder: string;
  url: string | null;
  opensOn: string | null;
  closesOn: string | null;
  typicalAmountUsd: string | null;
  eligibility: GrantEligibilityRules | null;
  notes: string | null;
  isActive: boolean;
  watching: boolean;
  notify: boolean;
  watcherCount: string | number | null;
};

function mapOpportunity(row: OpportunityRow): GrantCalendarOpportunity {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    funder: row.funder,
    url: row.url,
    opensOn: row.opensOn,
    closesOn: row.closesOn,
    typicalAmountUsd: toNumber(row.typicalAmountUsd),
    eligibility: row.eligibility ?? {},
    notes: row.notes,
    isActive: row.isActive,
  };
}

/**
 * The calendar this team sees: platform-curated rows (org_id IS NULL) plus its own additions.
 * RLS already enforces that split; the predicate here is belt-and-braces for readability.
 */
export async function computeGrantCalendarView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; now?: Date },
): Promise<GrantCalendarView> {
  const now = input.now ?? new Date();
  const membership = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!membership) {
    return {
      status: "setup_required",
      message:
        "Select a team to open the grant calendar. Deadlines and eligibility are scoped to your team.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
    };
  }

  const seasonYear = currentSeasonYear(now);
  const profile = await loadOrgGrantProfile(client, membership.orgId, seasonYear);

  const rows = await client.query<OpportunityRow>(
    `SELECT g.id,
            g.org_id AS "orgId",
            g.name,
            g.funder,
            g.url,
            g.opens_on::text AS "opensOn",
            g.closes_on::text AS "closesOn",
            g.typical_amount_usd::text AS "typicalAmountUsd",
            g.eligibility,
            g.notes,
            g.is_active AS "isActive",
            (mine.id IS NOT NULL) AS watching,
            COALESCE(mine.notify, false) AS notify,
            COALESCE(watchers.total, 0) AS "watcherCount"
     FROM grant_calendar_opportunities g
     LEFT JOIN grant_calendar_watchlist mine
       ON mine.opportunity_id = g.id
      AND mine.org_id = $1::uuid
      AND mine.member_user_id = $2::uuid
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total
       FROM grant_calendar_watchlist w
       WHERE w.opportunity_id = g.id AND w.org_id = $1::uuid
     ) watchers ON true
     WHERE g.is_active = true
       AND (g.org_id IS NULL OR g.org_id = $1::uuid)`,
    [membership.orgId, input.userId],
  );

  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  const matches = matchOpportunities(
    profile,
    rows.rows.map(mapOpportunity),
    now,
  );

  const entries: GrantCalendarEntry[] = matches.map((match) => {
    const row = byId.get(match.opportunity.id);
    return {
      ...match,
      watching: Boolean(row?.watching),
      notify: Boolean(row?.notify),
      watcherCount: toNumber(row?.watcherCount) ?? 0,
      teamAdded: match.opportunity.orgId !== null,
    };
  });

  const gapKeys = Array.from(new Set(entries.flatMap((entry) => entry.missingFields)));
  const profileGaps = gapKeys
    .map((key) => PROFILE_GAP_COPY[key])
    .filter((copy): copy is string => Boolean(copy));

  return {
    status: "live",
    orgId: membership.orgId,
    seasonYear,
    canManage: membership.role === "owner" || membership.role === "admin",
    profile,
    profileGaps,
    entries,
    platformCount: rows.rows.filter((row) => row.orgId === null).length,
    teamCount: rows.rows.filter((row) => row.orgId !== null).length,
    computedAt: now.toISOString(),
  };
}

/** Toggle the signed-in member's watch on one grant. Owns only their own row (RLS enforced). */
export async function setWatch(
  client: PoolClient,
  input: { orgId: string; userId: string; opportunityId: string; watching: boolean; notify: boolean },
): Promise<void> {
  if (!input.watching) {
    await client.query(
      `DELETE FROM grant_calendar_watchlist
       WHERE org_id = $1::uuid AND opportunity_id = $2::uuid AND member_user_id = $3::uuid`,
      [input.orgId, input.opportunityId, input.userId],
    );
    return;
  }
  await client.query(
    `INSERT INTO grant_calendar_watchlist (org_id, opportunity_id, member_user_id, notify)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
     ON CONFLICT (org_id, opportunity_id, member_user_id)
     DO UPDATE SET notify = EXCLUDED.notify, updated_at = now()`,
    [input.orgId, input.opportunityId, input.userId, input.notify],
  );
}

/** Add one grant this team found itself. Owner/admin only (RLS enforced). */
export async function addTeamOpportunity(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    funder: string;
    url: string | null;
    opensOn: string | null;
    closesOn: string | null;
    typicalAmountUsd: number | null;
    notes: string | null;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO grant_calendar_opportunities
       (org_id, name, funder, url, opens_on, closes_on, typical_amount_usd, notes, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5::date, $6::date, $7::numeric, $8, $9::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.name,
      input.funder,
      input.url,
      input.opensOn,
      input.closesOn,
      input.typicalAmountUsd,
      input.notes,
      input.userId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("Could not add the grant — the row was rejected.");
  return id;
}

/** Remove one of this team's own rows. Platform rows are unreachable by RLS. */
export async function removeTeamOpportunity(
  client: PoolClient,
  input: { orgId: string; opportunityId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM grant_calendar_opportunities WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.opportunityId, input.orgId],
  );
}

/**
 * Record the eligibility facts nothing else stores, so an `unknown` verdict can become a real
 * one. `null` clears the field back to unrecorded — we never coerce it to false.
 */
export async function setEligibilityFacts(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    titleI: boolean | null;
    nonprofit501c3: boolean | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO team_background_profile (org_id, title_i, nonprofit_501c3, updated_by, updated_at)
     VALUES ($1::uuid, $2::boolean, $3::boolean, $4::uuid, now())
     ON CONFLICT (org_id) DO UPDATE
       SET title_i = EXCLUDED.title_i,
           nonprofit_501c3 = EXCLUDED.nonprofit_501c3,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [input.orgId, input.titleI, input.nonprofit501c3, input.userId],
  );
}
