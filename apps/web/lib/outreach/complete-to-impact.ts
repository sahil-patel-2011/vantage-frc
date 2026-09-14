/**
 * Bridge planned outreach-calendar events onto the one community-impact log.
 *
 * /outreach-calendar is the forward-looking plan (0284 outreach_calendar_events).
 * /impact is the record of outreach that happened (0038 impact_activities). Completing
 * an event writes a real impact_activities row — not a parallel hours island — using
 * only the event's projected hours and reach. Idempotency prefers source_event_id (0513)
 * and falls back to the description marker for pre-column rows. Planned/confirmed/canceled
 * events stay empty on the impact side until someone actually completes them. Hours are
 * never invented.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { ImpactAudience, ImpactCategory } from "../impact/types";

export type OutreachEventForImpact = {
  id: string;
  title: string;
  category: string;
  scheduledOn: string;
  status: string;
  audience: string;
  projectedHours: string | number;
  projectedPeopleReached: string | number;
  location: string | null;
  notes: string | null;
  seasonYear: number;
};

export type CompleteOutreachToImpactResult = {
  eventId: string;
  activityId: string;
  /** True when this call inserted the impact_activities row. */
  created: boolean;
};

export class CompleteOutreachError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "CompleteOutreachError";
  }
}

const IMPACT_CATEGORIES: readonly ImpactCategory[] = [
  "stem_demo",
  "mentoring",
  "community_event",
  "competition",
  "media",
  "sustainability",
  "other",
];

const IMPACT_AUDIENCES: readonly ImpactAudience[] = [
  "k12",
  "college",
  "public",
  "industry",
  "other_teams",
  "internal",
  "other",
];

/** Marker stamped into impact_activities.description so a second complete is a no-op. */
export function outreachImpactSourceMarker(eventId: string): string {
  return `[outreach-calendar:${eventId}]`;
}

export function shouldWriteImpactForStatus(status: string): boolean {
  return status === "completed";
}

/**
 * Convert projected hours to duration_minutes. Zero/invalid input stays zero —
 * never a DEMO hour floor.
 */
export function projectedHoursToDurationMinutes(value: string | number | null | undefined): number {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.max(0, Math.round(hours * 60));
}

export function mapOutreachCategoryToImpact(category: string): ImpactCategory {
  return (IMPACT_CATEGORIES as readonly string[]).includes(category)
    ? (category as ImpactCategory)
    : "other";
}

export function mapOutreachAudienceToImpact(audience: string): ImpactAudience {
  return (IMPACT_AUDIENCES as readonly string[]).includes(audience)
    ? (audience as ImpactAudience)
    : "other";
}

export function impactDescriptionFromOutreach(notes: string | null | undefined, eventId: string): string {
  const marker = outreachImpactSourceMarker(eventId);
  const trimmed = typeof notes === "string" ? notes.trim() : "";
  return trimmed ? `${trimmed}\n\n${marker}` : marker;
}

export function peopleReachedFromOutreach(value: string | number | null | undefined): number {
  const people = Number(value);
  if (!Number.isFinite(people) || people <= 0) return 0;
  return Math.max(0, Math.round(people));
}

export type ImpactActivityInsert = {
  orgId: string;
  title: string;
  category: ImpactCategory;
  occurredOn: string;
  durationMinutes: number;
  participantCount: number;
  peopleReached: number;
  audience: ImpactAudience;
  location: string | null;
  description: string;
  seasonYear: number;
  evidenceAwards: string[];
  loggedBy: string;
  /** outreach_calendar_events.id — preferred idempotency key (0513). */
  sourceEventId: string;
};

/**
 * Pure mapping from a calendar event onto the impact_activities insert shape.
 * Hours and reach come only from the event; participant_count and award tags stay empty.
 */
export function impactActivityFromOutreachEvent(
  event: OutreachEventForImpact,
  input: { orgId: string; userId: string },
): ImpactActivityInsert {
  return {
    orgId: input.orgId,
    title: event.title,
    category: mapOutreachCategoryToImpact(event.category),
    occurredOn: event.scheduledOn,
    durationMinutes: projectedHoursToDurationMinutes(event.projectedHours),
    participantCount: 0,
    peopleReached: peopleReachedFromOutreach(event.projectedPeopleReached),
    audience: mapOutreachAudienceToImpact(event.audience),
    location: event.location,
    description: impactDescriptionFromOutreach(event.notes, event.id),
    seasonYear: event.seasonYear,
    evidenceAwards: [],
    loggedBy: input.userId,
    sourceEventId: event.id,
  };
}

export async function loadOutreachEventForImpact(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<OutreachEventForImpact | null> {
  const result = await client.query<OutreachEventForImpact>(
    `SELECT id, title, category, scheduled_on::text AS "scheduledOn", status, audience,
            projected_hours AS "projectedHours", projected_people_reached AS "projectedPeopleReached",
            location, notes, season_year AS "seasonYear"
     FROM outreach_calendar_events
     WHERE id = $1 AND org_id = $2`,
    [input.eventId, input.orgId],
  );
  return result.rows[0] ?? null;
}

export async function findLatestOutreachEventId(
  client: PoolClient,
  input: { orgId: string; title: string; scheduledOn: string },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM outreach_calendar_events
     WHERE org_id = $1 AND title = $2 AND scheduled_on = $3::date
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.orgId, input.title, input.scheduledOn],
  );
  return result.rows[0]?.id ?? null;
}

async function findExistingImpactActivityId(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<string | null> {
  const byColumn = await client.query<{ id: string }>(
    `SELECT id FROM impact_activities
     WHERE org_id = $1 AND source_event_id = $2::uuid
     LIMIT 1`,
    [input.orgId, input.eventId],
  );
  if (byColumn.rows[0]?.id) return byColumn.rows[0].id;

  const marker = `%${outreachImpactSourceMarker(input.eventId)}%`;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM impact_activities
     WHERE org_id = $1 AND description LIKE $2
     LIMIT 1`,
    [input.orgId, marker],
  );
  return result.rows[0]?.id ?? null;
}

async function insertImpactActivity(
  client: PoolClient,
  row: ImpactActivityInsert,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO impact_activities (
       org_id, title, category, occurred_on, duration_minutes, participant_count,
       people_reached, audience, location, description, season_year, evidence_awards, logged_by,
       source_event_id
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14::uuid)
     RETURNING id`,
    [
      row.orgId,
      row.title,
      row.category,
      row.occurredOn,
      row.durationMinutes,
      row.participantCount,
      row.peopleReached,
      row.audience,
      row.location,
      row.description,
      row.seasonYear,
      row.evidenceAwards,
      row.loggedBy,
      row.sourceEventId,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new CompleteOutreachError("Could not log the completed event to Impact.");
  return id;
}

/**
 * Mark the calendar event completed and insert the matching impact_activities row.
 * Idempotent: a second complete returns the existing activity instead of a duplicate.
 */
export async function completeOutreachEventToImpact(
  client: PoolClient,
  input: { orgId: string; userId: string; eventId: string },
): Promise<CompleteOutreachToImpactResult> {
  const event = await loadOutreachEventForImpact(client, input);
  if (!event) {
    throw new CompleteOutreachError("Outreach event not found.", 404);
  }

  const existingId = await findExistingImpactActivityId(client, input);
  const activityId = existingId ?? (await insertImpactActivity(client, impactActivityFromOutreachEvent(event, input)));

  if (event.status !== "completed") {
    await client.query(
      `UPDATE outreach_calendar_events SET status = 'completed', updated_at = now()
       WHERE id = $1 AND org_id = $2`,
      [input.eventId, input.orgId],
    );
  }

  return { eventId: event.id, activityId, created: !existingId };
}
