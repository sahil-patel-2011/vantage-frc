import type { PoolClient } from "@neondatabase/serverless";
import { summarizeOutreachCalendar, upcomingOutreachEvents } from ".";
import type { OutreachAudience, OutreachCalendarSummary, OutreachCategory, OutreachEvent, OutreachStatus } from "./types";

export type OutreachCalendarSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type OutreachCalendarView =
  | {
      status: "setup_required";
      message: string;
      steps: OutreachCalendarSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      events: OutreachEvent[];
      upcoming: OutreachEvent[];
      summary: OutreachCalendarSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type EventRow = {
  id: string;
  title: string;
  category: OutreachCategory;
  scheduledOn: string;
  status: OutreachStatus;
  audience: OutreachAudience;
  projectedHours: string | number;
  projectedPeopleReached: number;
  location: string | null;
  notes: string | null;
  seasonYear: number;
};

function mapEvent(row: EventRow): OutreachEvent {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    scheduledOn: row.scheduledOn,
    status: row.status,
    audience: row.audience,
    projectedHours: Number(row.projectedHours) || 0,
    projectedPeopleReached: Number(row.projectedPeopleReached) || 0,
    location: row.location,
    notes: row.notes,
    seasonYear: row.seasonYear,
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

export async function computeOutreachCalendarView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null; now?: Date },
): Promise<OutreachCalendarView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear(input.now);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to plan outreach events and projected impact.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [eventResult, seasonResult] = await Promise.all([
    client.query<EventRow>(
      `SELECT id, title, category, scheduled_on::text AS "scheduledOn", status, audience,
              projected_hours AS "projectedHours", projected_people_reached AS "projectedPeopleReached",
              location, notes, season_year AS "seasonYear"
       FROM outreach_calendar_events
       WHERE org_id = $1 AND season_year = $2
       ORDER BY scheduled_on ASC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM outreach_calendar_events WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const events = eventResult.rows.map(mapEvent);
  const summary = summarizeOutreachCalendar(events);
  const upcoming = upcomingOutreachEvents(events, todayIso(input.now)).slice(0, 8);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    events,
    upcoming,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createOutreachEvent(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    category: OutreachCategory;
    scheduledOn: string;
    status: OutreachStatus;
    audience: OutreachAudience;
    projectedHours: number;
    projectedPeopleReached: number;
    location: string | null;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outreach_calendar_events (
       org_id, title, category, scheduled_on, status, audience, projected_hours,
       projected_people_reached, location, notes, season_year, created_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.orgId,
      input.title,
      input.category,
      input.scheduledOn,
      input.status,
      input.audience,
      Math.max(0, input.projectedHours),
      Math.max(0, Math.round(input.projectedPeopleReached)),
      input.location,
      input.notes,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateOutreachEventStatus(
  client: PoolClient,
  input: { orgId: string; eventId: string; status: OutreachStatus },
): Promise<void> {
  await client.query(
    `UPDATE outreach_calendar_events SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.eventId, input.orgId],
  );
}

export async function deleteOutreachEvent(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<void> {
  await client.query(`DELETE FROM outreach_calendar_events WHERE id = $1 AND org_id = $2`, [
    input.eventId,
    input.orgId,
  ]);
}
