import type { PoolClient } from "@neondatabase/serverless";
import { computeTeamHealthReadiness, summarizeTeamHealth, type TeamHealthAttendanceEvent, type TeamHealthReadiness, type TeamHealthSummary } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type TeamHealthSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO morale. */
function setupSteps(orgId: string | null): TeamHealthSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Team Health.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Engagement stays blank until real roll-call entries exist.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My Hours",
      detail: "Shop-time engagement stays blank until members clock in.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
  ];
}

export type TeamHealthDashboardView =
  | {
      status: "setup_required";
      message: string;
      steps: TeamHealthSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      events: TeamHealthAttendanceEvent[];
      summary: TeamHealthSummary;
      readiness: TeamHealthReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

type EventRow = {
  id: string;
  title: string;
  kind: string;
  occurredOn: string;
  creditHours: string | number;
};

type EntryRow = {
  eventId: string;
  userId: string | null;
  personName: string;
  hours: string | number | null;
};

type SessionRow = {
  id: string;
  userId: string;
  name: string;
  kind: string;
  clockIn: string;
  clockOut: string | null;
};

type RosterRow = {
  userId: string;
  name: string;
};

export async function computeTeamHealthDashboardView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<TeamHealthDashboardView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to see engagement from attendance and hour logs.",
      steps: setupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [eventResult, entryResult, sessionResult, rosterResult, seasonResult] = await Promise.all([
    client.query<EventRow>(
      `SELECT id, title, kind, occurred_on::text AS "occurredOn", credit_hours AS "creditHours"
       FROM attendance_events
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<EntryRow>(
      `SELECT ae.event_id AS "eventId", ae.user_id::text AS "userId", ae.person_name AS "personName", ae.hours
       FROM attendance_entries ae
       JOIN attendance_events ev ON ev.id = ae.event_id
       WHERE ae.org_id = $1 AND ev.season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<SessionRow>(
      `SELECT h.id, h.user_id::text AS "userId",
              COALESCE(NULLIF(trim(u.name), ''), u.email) AS name,
              h.kind, h.clock_in::text AS "clockIn", h.clock_out::text AS "clockOut"
       FROM hour_logs h
       JOIN users u ON u.id = h.user_id
       WHERE h.org_id = $1 AND extract(year FROM h.clock_in) = $2
       ORDER BY h.clock_in DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<RosterRow>(
      `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY name`,
      [org.orgId],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT season_year AS "seasonYear" FROM attendance_events WHERE org_id = $1
       UNION
       SELECT extract(year FROM clock_in)::int AS "seasonYear" FROM hour_logs WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const events = eventResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    occurredOn: row.occurredOn,
    creditHours: Number(row.creditHours) || 0,
  }));
  const entries = entryResult.rows.map((row) => ({
    eventId: row.eventId,
    userId: row.userId,
    personName: row.personName,
    hours: row.hours == null ? null : Number(row.hours),
  }));
  const sessions = sessionResult.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name ?? "Unknown member",
    kind: row.kind,
    clockIn: row.clockIn,
    clockOut: row.clockOut,
  }));
  const roster = rosterResult.rows.map((row) => ({
    userId: row.userId,
    name: row.name ?? "Unknown member",
  }));

  const summary = summarizeTeamHealth({ roster, events, entries, sessions });
  const readiness = computeTeamHealthReadiness(summary);
  const seasons = seasonResult.rows.map((row) => Number(row.seasonYear)).filter((year) => Number.isFinite(year));
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const eventEntryCounts = new Map<string, number>();
  for (const entry of entries) {
    eventEntryCounts.set(entry.eventId, (eventEntryCounts.get(entry.eventId) ?? 0) + 1);
  }

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    events: events.map((event) => ({
      ...event,
      entryCount: eventEntryCounts.get(event.id) ?? 0,
    })),
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}
