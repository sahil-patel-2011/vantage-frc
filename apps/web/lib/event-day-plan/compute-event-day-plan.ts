import type { PoolClient } from "@neondatabase/serverless";
import { detectConflicts, EVENT_DAY_PLAN_KINDS, groupBlocksByHour, summarizeEventDayPlan } from ".";
import type {
  EventDayPlanBlock,
  EventDayPlanConflict,
  EventDayPlanHourSlot,
  EventDayPlanKind,
  EventDayPlanStatus,
  EventDayPlanSummary,
} from "./types";

export { EVENT_DAY_PLAN_KINDS };

export type EventDayPlanSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type EventDayPlanView =
  | {
      status: "setup_required";
      message: string;
      steps: EventDayPlanSetupStep[];
      orgId: string | null;
      eventKey: string | null;
      planDate: string;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      eventKeys: string[];
      planDate: string;
      blocks: EventDayPlanBlock[];
      hourly: EventDayPlanHourSlot[];
      conflicts: EventDayPlanConflict[];
      summary: EventDayPlanSummary;
      computedAt: string;
    };

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type BlockRow = {
  id: string;
  eventKey: string;
  planDate: string;
  kind: EventDayPlanKind;
  title: string;
  startAt: string;
  endAt: string;
  assignedTo: string | null;
  location: string | null;
  notes: string | null;
  status: EventDayPlanStatus;
};

function mapBlock(row: BlockRow): EventDayPlanBlock {
  return {
    id: row.id,
    eventKey: row.eventKey,
    planDate: row.planDate,
    kind: row.kind,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    assignedTo: row.assignedTo,
    location: row.location,
    notes: row.notes,
    status: row.status,
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

export async function computeEventDayPlanView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null; planDate?: string | null },
): Promise<EventDayPlanView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const planDate = input.planDate && /^\d{4}-\d{2}-\d{2}$/.test(input.planDate) ? input.planDate : todayIsoDate();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to build the event-day plan.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      eventKey: null,
      planDate,
    };
  }

  const eventKeyResult = await client.query<{ eventKey: string }>(
    `SELECT DISTINCT event_key AS "eventKey" FROM event_day_plan_blocks WHERE org_id = $1 ORDER BY event_key`,
    [org.orgId],
  );
  const eventKeys = eventKeyResult.rows.map((r) => r.eventKey);
  const eventKey = input.eventKey && input.eventKey.trim() ? input.eventKey.trim() : eventKeys[0] ?? null;

  if (!eventKey) {
    return {
      status: "setup_required",
      message: "Add your first event-day plan block — qual matches, battery charges, scout shifts, pit-repair windows, or logistics tasks.",
      steps: [
        {
          id: "first-block",
          label: "Log a block",
          detail: "Add a scout shift, battery charge, or pit-repair window for event day",
          href: "/event-day-plan",
        },
      ],
      orgId: org.orgId,
      eventKey: null,
      planDate,
    };
  }

  const blockResult = await client.query<BlockRow>(
    `SELECT id, event_key AS "eventKey", plan_date::text AS "planDate", kind, title,
            start_at AS "startAt", end_at AS "endAt", assigned_to AS "assignedTo",
            location, notes, status
     FROM event_day_plan_blocks
     WHERE org_id = $1 AND event_key = $2 AND plan_date = $3::date
     ORDER BY start_at ASC`,
    [org.orgId, eventKey, planDate],
  );

  const blocks = blockResult.rows.map((row) => ({
    ...mapBlock(row),
    startAt: new Date(row.startAt).toISOString(),
    endAt: new Date(row.endAt).toISOString(),
  }));
  const conflicts = detectConflicts(blocks);
  const hourly = groupBlocksByHour(blocks);
  const summary = summarizeEventDayPlan(blocks, conflicts);
  if (!eventKeys.includes(eventKey)) eventKeys.unshift(eventKey);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    eventKeys,
    planDate,
    blocks,
    hourly,
    conflicts,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addBlock(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    planDate: string;
    kind: EventDayPlanKind;
    title: string;
    startAt: string;
    endAt: string;
    assignedTo: string | null;
    location: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO event_day_plan_blocks (
       org_id, event_key, plan_date, kind, title, start_at, end_at, assigned_to, location, notes, created_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11)`,
    [
      input.orgId,
      input.eventKey,
      input.planDate,
      input.kind,
      input.title,
      input.startAt,
      input.endAt,
      input.assignedTo,
      input.location,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateBlockStatus(
  client: PoolClient,
  input: { orgId: string; blockId: string; status: EventDayPlanStatus },
): Promise<void> {
  await client.query(
    `UPDATE event_day_plan_blocks SET status = $1 WHERE id = $2 AND org_id = $3`,
    [input.status, input.blockId, input.orgId],
  );
}

export async function deleteBlock(
  client: PoolClient,
  input: { orgId: string; blockId: string },
): Promise<void> {
  await client.query(`DELETE FROM event_day_plan_blocks WHERE id = $1 AND org_id = $2`, [
    input.blockId,
    input.orgId,
  ]);
}
