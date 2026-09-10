import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { hubHref } from "../nav/hubs";
import { AGENDA_ITEM_KINDS, buildAgendaItems, parseActionItemsFromMinutes, summarizeAgendaSources } from ".";
import {
  agendaForEvent,
  attachMinutes,
  CALENDAR_MEETING_KIND,
  decodeAgendaPayload,
  encodeAgendaItemsColumn,
  encodeAgendaPayload,
  isEmptyUntilMeeting,
  isUuid,
  matchAgendaToMeeting,
  meetingOnFromStartsAt,
  requireCalendarEventId,
  resolveCalendarEventId,
  utcYearFromStartsAt,
} from "./persist";
import type {
  ActionItem,
  ActionItemStatus,
  AgendaItem,
  AgendaSourceCounts,
  AgendaSourceInput,
  CalendarMeeting,
  MeetingAgenda,
  MeetingAgendaStatus,
} from "./types";

export { AGENDA_ITEM_KINDS };

export type MeetingAutopilotSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MeetingAutopilotView =
  | {
      status: "setup_required";
      message: string;
      steps: MeetingAutopilotSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "empty";
      message: string;
      steps: MeetingAutopilotSetupStep[];
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      meetings: CalendarMeeting[];
      liveAgendaItems: AgendaItem[];
      sourceCounts: AgendaSourceCounts;
      agendas: MeetingAgenda[];
      actionItems: ActionItem[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isAgendaStatus(value: unknown): value is MeetingAgendaStatus {
  return value === "draft" || value === "finalized";
}

function isActionItemStatus(value: unknown): value is ActionItemStatus {
  return value === "open" || value === "done";
}

function isoFromPg(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
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

type BlockerRow = { id: string; title: string; subsystem: string; blockedReason: string | null; priority: string };
type OverdueTaskRow = { id: string; title: string; subsystem: string; dueOn: string; priority: string };
type DecisionRow = { id: string; title: string; category: string; createdAt: string };
type FmeaRow = { id: string; title: string; subsystemName: string; severity: number; occurrence: number; detection: number };

async function loadAgendaSources(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<AgendaSourceInput> {
  const [blockerResult, overdueResult, decisionResult, fmeaResult] = await Promise.all([
    client.query<BlockerRow>(
      `SELECT id, title, subsystem, blocked_reason AS "blockedReason", priority
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2 AND status = 'blocked'
       ORDER BY updated_at DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<OverdueTaskRow>(
      `SELECT id, title, subsystem, due_on::text AS "dueOn", priority
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2 AND status NOT IN ('done', 'archived')
         AND due_on IS NOT NULL AND due_on < current_date
       ORDER BY due_on ASC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<DecisionRow>(
      `SELECT id, title, category, created_at::text AS "createdAt"
       FROM decision_records
       WHERE org_id = $1 AND season_year = $2 AND status = 'proposed'
       ORDER BY created_at DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
    client.query<FmeaRow>(
      `SELECT id, title, subsystem_name AS "subsystemName", severity, occurrence, detection
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2 AND status = 'open'
       ORDER BY (occurrence * severity * detection) DESC
       LIMIT 20`,
      [orgId, seasonYear],
    ),
  ]);

  return {
    blockers: blockerResult.rows,
    overdueTasks: overdueResult.rows,
    decisions: decisionResult.rows,
    fmeaFailures: fmeaResult.rows,
  };
}

type AgendaRow = {
  id: string;
  seasonYear: number;
  title: string;
  meetingOn: string | null;
  calendarEventId?: string | null;
  agendaItems: unknown;
  blockerCount: number;
  overdueTaskCount: number;
  decisionCount: number;
  fmeaCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function mapAgenda(row: AgendaRow): MeetingAgenda {
  const payload = decodeAgendaPayload(row.agendaItems);
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    meetingOn: row.meetingOn,
    calendarEventId: resolveCalendarEventId(row.calendarEventId, payload),
    agendaItems: payload.items,
    minutesText: payload.minutesText,
    sourceCounts: {
      blockers: Number(row.blockerCount) || 0,
      overdueTasks: Number(row.overdueTaskCount) || 0,
      decisions: Number(row.decisionCount) || 0,
      fmea: Number(row.fmeaCount) || 0,
    },
    status: isAgendaStatus(row.status) ? row.status : "draft",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const AGENDA_SELECT = `SELECT id, season_year AS "seasonYear", title, meeting_on::text AS "meetingOn",
              calendar_event_id::text AS "calendarEventId", agenda_items AS "agendaItems",
              blocker_count AS "blockerCount", overdue_task_count AS "overdueTaskCount",
              decision_count AS "decisionCount", fmea_count AS "fmeaCount", status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM meeting_autopilot_agendas`;

type ActionItemRow = {
  id: string;
  agendaId: string;
  title: string;
  owner: string | null;
  dueOn: string | null;
  status: string;
  sourceExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapActionItem(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    agendaId: row.agendaId,
    title: row.title,
    owner: row.owner,
    dueOn: row.dueOn,
    status: isActionItemStatus(row.status) ? row.status : "open",
    sourceExcerpt: row.sourceExcerpt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type CalendarEventRow = {
  id: string;
  title: string;
  startsAt: unknown;
  endsAt: unknown;
  location: string | null;
  kind: string;
};

function toMeetingRef(row: CalendarEventRow): { id: string; title: string; meetingOn: string; startsAt: string; endsAt: string | null; location: string } {
  const startsAt = isoFromPg(row.startsAt);
  return {
    id: row.id,
    title: row.title,
    startsAt,
    endsAt: row.endsAt == null ? null : isoFromPg(row.endsAt) || null,
    location: row.location?.trim() || "",
    meetingOn: meetingOnFromStartsAt(startsAt),
  };
}

async function loadCalendarMeetings(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<CalendarEventRow[]> {
  try {
    const result = await client.query<CalendarEventRow>(
      `SELECT id, title, starts_at AS "startsAt", ends_at AS "endsAt", location, kind
       FROM subteam_calendar_events
       WHERE org_id = $1::uuid
         AND kind = 'meeting'
         AND starts_at >= make_timestamptz($2, 1, 1, 0, 0, 0, 'UTC')
         AND starts_at < make_timestamptz($2 + 1, 1, 1, 0, 0, 0, 'UTC')
       ORDER BY starts_at ASC
       LIMIT 50`,
      [orgId, seasonYear],
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function loadMeetingSeasonYears(client: PoolClient, orgId: string): Promise<number[]> {
  try {
    const result = await client.query<{ seasonYear: number }>(
      `SELECT DISTINCT EXTRACT(YEAR FROM starts_at AT TIME ZONE 'UTC')::int AS "seasonYear"
       FROM subteam_calendar_events
       WHERE org_id = $1::uuid AND kind = 'meeting'
       ORDER BY 1 DESC`,
      [orgId],
    );
    return result.rows.map((row) => row.seasonYear).filter((year) => Number.isFinite(year));
  } catch {
    return [];
  }
}

async function loadMeetingEvent(
  client: PoolClient,
  orgId: string,
  calendarEventId: string,
): Promise<CalendarEventRow | null> {
  const result = await client.query<CalendarEventRow>(
    `SELECT id, title, starts_at AS "startsAt", ends_at AS "endsAt", location, kind
     FROM subteam_calendar_events
     WHERE org_id = $1::uuid AND id = $2::uuid AND kind = 'meeting'
     LIMIT 1`,
    [orgId, calendarEventId],
  );
  return result.rows[0] ?? null;
}

async function findAgendaForEvent(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
  calendarEventId: string,
): Promise<AgendaRow | null> {
  const result = await client.query<AgendaRow>(
    `${AGENDA_SELECT}
     WHERE org_id = $1 AND season_year = $2
       AND (
         calendar_event_id = $3::uuid
         OR (
           calendar_event_id IS NULL
           AND jsonb_typeof(agenda_items) = 'object'
           AND agenda_items->>'calendarEventId' = $3
         )
       )
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, seasonYear, calendarEventId],
  );
  return result.rows[0] ?? null;
}

async function loadAgendaById(
  client: PoolClient,
  orgId: string,
  agendaId: string,
): Promise<AgendaRow | null> {
  const result = await client.query<AgendaRow>(
    `${AGENDA_SELECT}
     WHERE org_id = $1 AND id = $2
     LIMIT 1`,
    [orgId, agendaId],
  );
  return result.rows[0] ?? null;
}

function mergeSeasons(seasonYear: number, ...lists: number[][]): number[] {
  const years = new Set<number>([seasonYear]);
  for (const list of lists) {
    for (const year of list) {
      if (Number.isFinite(year) && year > 2000) years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
}

function calendarHref(orgId: string): string {
  return hubHref("/team", "calendar", orgId);
}

function emptyUntilMeeting(input: {
  orgId: string;
  teamNumber: number | null;
  seasonYear: number;
  seasons: number[];
}): Extract<MeetingAutopilotView, { status: "empty" }> {
  return {
    status: "empty",
    message: `No calendar meetings in ${input.seasonYear} yet. Agenda and minutes stay empty until a meeting exists.`,
    steps: [
      {
        id: "calendar",
        label: "Add a meeting",
        detail: "Create a meeting on the team calendar. Agenda and minutes persist against that event.",
        href: calendarHref(input.orgId),
      },
    ],
    orgId: input.orgId,
    teamNumber: input.teamNumber,
    seasonYear: input.seasonYear,
    seasons: input.seasons,
  };
}

export async function computeMeetingAutopilotView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MeetingAutopilotView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to attach meeting agendas and minutes to calendar events.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [meetings, meetingSeasons, sources, agendaResult, actionItemResult, seasonResult] = await Promise.all([
    loadCalendarMeetings(client, org.orgId, seasonYear),
    loadMeetingSeasonYears(client, org.orgId),
    loadAgendaSources(client, org.orgId, seasonYear),
    client.query<AgendaRow>(
      `${AGENDA_SELECT}
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [org.orgId, seasonYear],
    ),
    client.query<ActionItemRow>(
      `SELECT ai.id, ai.agenda_id AS "agendaId", ai.title, ai.owner, ai.due_on::text AS "dueOn", ai.status,
              ai.source_excerpt AS "sourceExcerpt", ai.created_at AS "createdAt", ai.updated_at AS "updatedAt"
       FROM meeting_autopilot_action_items ai
       JOIN meeting_autopilot_agendas a ON a.id = ai.agenda_id
       WHERE ai.org_id = $1 AND a.season_year = $2
       ORDER BY ai.created_at DESC
       LIMIT 200`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM meeting_autopilot_agendas WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = mergeSeasons(
    seasonYear,
    meetingSeasons,
    seasonResult.rows.map((row) => row.seasonYear),
  );

  if (isEmptyUntilMeeting(meetings)) {
    return emptyUntilMeeting({
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      seasons,
    });
  }

  const agendas = agendaResult.rows.map(mapAgenda);
  const meetingRefs = meetings.map(toMeetingRef);
  const liveMeetings: CalendarMeeting[] = meetingRefs.map((meeting) => {
    const linked =
      agendaForEvent(agendas, meeting.id) ??
      agendas.find((agenda) => matchAgendaToMeeting(agenda, meetingRefs) === meeting.id) ??
      null;
    return {
      id: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      location: meeting.location,
      meetingOn: meeting.meetingOn,
      agenda: linked,
      minutesText: linked?.minutesText ?? null,
    };
  });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    meetings: liveMeetings,
    liveAgendaItems: buildAgendaItems(sources),
    sourceCounts: summarizeAgendaSources(sources),
    agendas: agendas.filter((agenda) => liveMeetings.some((meeting) => meeting.agenda?.id === agenda.id)),
    actionItems: actionItemResult.rows.map(mapActionItem),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

async function persistAgendaRow(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    event: CalendarEventRow;
    items: AgendaItem[];
    minutesText: string | null;
    counts: AgendaSourceCounts;
    existing: AgendaRow | null;
  },
): Promise<string> {
  const meeting = toMeetingRef(input.event);
  const payload = encodeAgendaPayload({
    calendarEventId: input.event.id,
    minutesText: input.minutesText,
    items: input.items,
  });
  const itemsJson = encodeAgendaItemsColumn(payload);

  if (input.existing) {
    await client.query(
      `UPDATE meeting_autopilot_agendas
       SET title = $1, meeting_on = $2::date, calendar_event_id = $3::uuid, agenda_items = $4::jsonb,
           blocker_count = $5, overdue_task_count = $6, decision_count = $7, fmea_count = $8,
           updated_at = now()
       WHERE id = $9 AND org_id = $10`,
      [
        meeting.title,
        meeting.meetingOn || null,
        input.event.id,
        JSON.stringify(itemsJson),
        input.counts.blockers,
        input.counts.overdueTasks,
        input.counts.decisions,
        input.counts.fmea,
        input.existing.id,
        input.orgId,
      ],
    );
    return input.existing.id;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO meeting_autopilot_agendas (
       org_id, season_year, title, meeting_on, calendar_event_id, agenda_items,
       blocker_count, overdue_task_count, decision_count, fmea_count, created_by
     ) VALUES ($1,$2,$3,$4::date,$5::uuid,$6::jsonb,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      input.orgId,
      input.seasonYear,
      meeting.title,
      meeting.meetingOn || null,
      input.event.id,
      JSON.stringify(itemsJson),
      input.counts.blockers,
      input.counts.overdueTasks,
      input.counts.decisions,
      input.counts.fmea,
      input.userId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("Could not persist agenda against the calendar meeting");
  return id;
}

export async function generateAgenda(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; calendarEventId: string },
): Promise<string> {
  const calendarEventId = requireCalendarEventId(input.calendarEventId);
  const event = await loadMeetingEvent(client, input.orgId, calendarEventId);
  if (!event || event.kind !== CALENDAR_MEETING_KIND) {
    throw new Error("Meeting not found on the calendar — agenda persists against a calendar event");
  }

  const seasonYear = utcYearFromStartsAt(isoFromPg(event.startsAt)) ?? input.seasonYear;
  const sources = await loadAgendaSources(client, input.orgId, seasonYear);
  const counts = summarizeAgendaSources(sources);

  const items = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "meeting_autopilot",
    requestId: `meeting-autopilot-agenda-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear,
      calendarEventId,
      note: "Deterministic agenda built from open blockers / overdue tasks / unresolved decisions / open FMEA — no external model call",
    },
    invoke: async () => ({
      value: buildAgendaItems(sources),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-meeting-autopilot-v1",
      provider: "vantage-local",
    }),
  });

  const existing = await findAgendaForEvent(client, input.orgId, seasonYear, calendarEventId);
  const existingPayload = existing ? decodeAgendaPayload(existing.agendaItems) : null;

  return persistAgendaRow(client, {
    orgId: input.orgId,
    userId: input.userId,
    seasonYear,
    event,
    items,
    minutesText: existingPayload?.minutesText ?? null,
    counts,
    existing,
  });
}

export async function saveMinutes(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    calendarEventId?: string | null;
    agendaId?: string | null;
    minutesText: string;
  },
): Promise<{ agendaId: string; calendarEventId: string }> {
  let calendarEventId = input.calendarEventId && isUuid(input.calendarEventId) ? input.calendarEventId : null;
  let existing: AgendaRow | null = null;

  if (!calendarEventId && input.agendaId && isUuid(input.agendaId)) {
    existing = await loadAgendaById(client, input.orgId, input.agendaId);
    if (!existing) throw new Error("Agenda not found");
    calendarEventId = resolveCalendarEventId(existing.calendarEventId, decodeAgendaPayload(existing.agendaItems));
  }

  if (!calendarEventId) {
    throw new Error("calendarEventId is required — agenda and minutes persist against a calendar meeting");
  }

  const event = await loadMeetingEvent(client, input.orgId, calendarEventId);
  if (!event || event.kind !== CALENDAR_MEETING_KIND) {
    throw new Error("Meeting not found on the calendar — minutes persist against a calendar event");
  }

  const seasonYear = utcYearFromStartsAt(isoFromPg(event.startsAt)) ?? input.seasonYear;
  existing = existing ?? (await findAgendaForEvent(client, input.orgId, seasonYear, calendarEventId));
  const previous = existing ? decodeAgendaPayload(existing.agendaItems) : { calendarEventId, minutesText: null, items: [] };
  const next = attachMinutes({ ...previous, calendarEventId }, input.minutesText);

  const agendaId = await persistAgendaRow(client, {
    orgId: input.orgId,
    userId: input.userId,
    seasonYear,
    event,
    items: next.items,
    minutesText: next.minutesText,
    counts: existing
      ? {
          blockers: Number(existing.blockerCount) || 0,
          overdueTasks: Number(existing.overdueTaskCount) || 0,
          decisions: Number(existing.decisionCount) || 0,
          fmea: Number(existing.fmeaCount) || 0,
        }
      : { blockers: 0, overdueTasks: 0, decisions: 0, fmea: 0 },
    existing,
  });

  return { agendaId, calendarEventId };
}

export async function draftMinutesActionItems(
  client: PoolClient,
  input: { orgId: string; userId: string; agendaId: string; minutesText: string },
): Promise<number> {
  const parsed = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "meeting_autopilot",
    requestId: `meeting-autopilot-minutes-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      agendaId: input.agendaId,
      note: "Deterministic minutes-to-action-item parsing — no external model call",
    },
    invoke: async () => ({
      value: parseActionItemsFromMinutes(input.minutesText),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-meeting-autopilot-v1",
      provider: "vantage-local",
    }),
  });

  for (const item of parsed.slice(0, 100)) {
    await client.query(
      `INSERT INTO meeting_autopilot_action_items (
         org_id, agenda_id, title, owner, due_on, source_excerpt, created_by
       ) VALUES ($1,$2,$3,$4,$5::date,$6,$7)`,
      [input.orgId, input.agendaId, item.title, item.owner, item.dueOn, item.sourceExcerpt, input.userId],
    );
  }
  return parsed.length;
}

export async function updateActionItemStatus(
  client: PoolClient,
  input: { orgId: string; actionItemId: string; status: ActionItemStatus },
): Promise<void> {
  await client.query(
    `UPDATE meeting_autopilot_action_items SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.actionItemId, input.orgId],
  );
}

export async function updateAgendaStatus(
  client: PoolClient,
  input: { orgId: string; agendaId: string; status: MeetingAgendaStatus },
): Promise<void> {
  await client.query(
    `UPDATE meeting_autopilot_agendas SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.agendaId, input.orgId],
  );
}

export async function deleteAgenda(client: PoolClient, input: { orgId: string; agendaId: string }): Promise<void> {
  await client.query(`DELETE FROM meeting_autopilot_agendas WHERE id = $1 AND org_id = $2`, [
    input.agendaId,
    input.orgId,
  ]);
}

export async function deleteActionItem(
  client: PoolClient,
  input: { orgId: string; actionItemId: string },
): Promise<void> {
  await client.query(`DELETE FROM meeting_autopilot_action_items WHERE id = $1 AND org_id = $2`, [
    input.actionItemId,
    input.orgId,
  ]);
}
