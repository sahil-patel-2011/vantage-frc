// Compute the per-event readiness view: remaining blockers for ONE event date,
// projected live (never copied) from consent, packing, logistics, and inspection.
// The DURING-event hour-by-hour schedule is lib/event-day-plan, not this module.

import type { PoolClient } from "@neondatabase/serverless";
import type { RecordStatus } from "../consent";
import type { InspectionStatus } from "../inspection";
import {
  projectEventBlockers,
  type EventBlockers,
  type EventSourceSnapshots,
  type SourceBlockers,
} from "./blockers";
import { isIsoDate, resolveDueDates, type ReadinessCountdown } from "./schedule";
import { EVENT_READINESS_TEMPLATE } from "./template";
import type {
  ReadinessCategory,
  ReadinessItem,
  ReadinessPlan,
  ReadinessSourceKind,
  ReadinessStatus,
} from "./types";

export type EventReadinessSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type EventCandidate = {
  eventKey: string;
  eventName: string | null;
  startDate: string | null;
  source: "active" | "packing" | "logistics";
};

export type PlanRef = {
  id: string;
  eventKey: string;
  eventName: string;
  eventStartDate: string;
};

export type CategorySummary = {
  category: ReadinessCategory;
  done: number;
  total: number;
};

export type EventReadinessView =
  | {
      status: "setup_required";
      message: string;
      steps: EventReadinessSetupStep[];
      orgId: string | null;
      teamNumber: number | null;
      eventCandidates: EventCandidate[];
      plans: PlanRef[];
      today: string;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      plan: ReadinessPlan;
      plans: PlanRef[];
      countdown: ReadinessCountdown<ReadinessItem>;
      categories: CategorySummary[];
      sources: SourceBlockers[];
      blockers: EventBlockers;
      remaining: number | null;
      ready: boolean;
      today: string;
      computedAt: string;
    };

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
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

async function listPlans(client: PoolClient, orgId: string): Promise<PlanRef[]> {
  const result = await client.query<PlanRef>(
    `SELECT id, event_key AS "eventKey", event_name AS "eventName", event_start_date::text AS "eventStartDate"
     FROM event_readiness_plans
     WHERE org_id = $1
     ORDER BY event_start_date ASC, event_key ASC`,
    [orgId],
  );
  return result.rows;
}

async function listEventCandidates(client: PoolClient, orgId: string): Promise<EventCandidate[]> {
  const result = await client.query<EventCandidate>(
    `SELECT k.event_key AS "eventKey", e.name AS "eventName", e.start_date::text AS "startDate", k.source
     FROM (
       SELECT c.active_event_key AS event_key, 'active' AS source, 0 AS rank
       FROM org_active_context c
       WHERE c.org_id = $1 AND c.active_event_key IS NOT NULL
       UNION ALL
       SELECT DISTINCT p.event_key, 'packing' AS source, 1 AS rank
       FROM packing_lists p
       WHERE p.org_id = $1 AND p.event_key IS NOT NULL
       UNION ALL
       SELECT DISTINCT t.event_key, 'logistics' AS source, 2 AS rank
       FROM logistics_trips t
       WHERE t.org_id = $1 AND t.event_key IS NOT NULL AND t.event_key <> ''
     ) k
     LEFT JOIN events_ref e ON e.event_key = k.event_key
     ORDER BY k.rank, k.event_key`,
    [orgId],
  );
  const seen = new Set<string>();
  const candidates: EventCandidate[] = [];
  for (const row of result.rows) {
    if (seen.has(row.eventKey)) continue;
    seen.add(row.eventKey);
    candidates.push(row);
  }
  return candidates;
}

type ItemRow = {
  id: string;
  category: ReadinessCategory;
  title: string;
  detail: string;
  dueOn: string | null;
  daysBefore: number | null;
  status: ReadinessStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceKind: ReadinessSourceKind;
  blockedReason: string;
  completedAt: string | null;
};

async function loadItems(client: PoolClient, orgId: string, planId: string): Promise<ReadinessItem[]> {
  const result = await client.query<ItemRow>(
    `SELECT i.id, i.category, i.title, i.detail,
            i.due_on::text AS "dueOn", i.days_before AS "daysBefore", i.status,
            i.owner_user_id AS "ownerUserId", u.name AS "ownerName",
            i.source_kind AS "sourceKind", i.blocked_reason AS "blockedReason",
            i.completed_at AS "completedAt"
     FROM event_readiness_items i
     LEFT JOIN users u ON u.id = i.owner_user_id
     WHERE i.org_id = $1 AND i.plan_id = $2
     ORDER BY i.due_on NULLS LAST, i.days_before DESC NULLS LAST, i.created_at ASC`,
    [orgId, planId],
  );
  return result.rows.map((row) => ({
    ...row,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
  }));
}

async function loadSourceSnapshots(
  client: PoolClient,
  orgId: string,
  eventKey: string,
  seasonYear: number | null,
): Promise<EventSourceSnapshots> {
  const [inspectionItems, weights, settings, consentForms, consentRecords, packingLists, packingItems, trips, travelLegs, rooms] =
    await Promise.all([
      client.query<{ status: InspectionStatus }>(
        `SELECT status FROM inspection_items WHERE org_id = $1`,
        [orgId],
      ),
      client.query<{ totalLbs: number; weighedAt: string }>(
        `SELECT total_lbs::float8 AS "totalLbs", weighed_at::text AS "weighedAt"
         FROM robot_weights WHERE org_id = $1
         ORDER BY weighed_at DESC LIMIT 20`,
        [orgId],
      ),
      client.query<{ weightLimitLbs: number }>(
        `SELECT weight_limit_lbs::float8 AS "weightLimitLbs" FROM inspection_settings WHERE org_id = $1`,
        [orgId],
      ),
      client.query<{ id: string; required: boolean }>(
        `SELECT id, required FROM consent_forms
         WHERE org_id = $1 AND ($2::int IS NULL OR season_year = $2::int)`,
        [orgId, seasonYear],
      ),
      client.query<{ formId: string; personName: string; status: RecordStatus }>(
        `SELECT r.form_id AS "formId", r.person_name AS "personName", r.status
         FROM consent_records r
         JOIN consent_forms f ON f.id = r.form_id
         WHERE r.org_id = $1 AND ($2::int IS NULL OR f.season_year = $2::int)`,
        [orgId, seasonYear],
      ),
      client.query<{ id: string }>(
        `SELECT id FROM packing_lists WHERE org_id = $1 AND event_key = $2`,
        [orgId, eventKey],
      ),
      client.query<{ packed: boolean }>(
        `SELECT i.packed
         FROM packing_items i
         JOIN packing_lists l ON l.id = i.list_id
         WHERE i.org_id = $1 AND l.org_id = $1 AND l.event_key = $2`,
        [orgId, eventKey],
      ),
      client.query<{ id: string }>(
        `SELECT id FROM logistics_trips WHERE org_id = $1 AND event_key = $2`,
        [orgId, eventKey],
      ),
      client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM logistics_travel_legs g
         JOIN logistics_trips t ON t.id = g.trip_id
         WHERE g.org_id = $1 AND t.org_id = $1 AND t.event_key = $2`,
        [orgId, eventKey],
      ),
      client.query<{ occupantUserId: string | null; occupantName: string }>(
        `SELECT ra.occupant_user_id AS "occupantUserId", ra.occupant_name AS "occupantName"
         FROM logistics_room_assignments ra
         JOIN logistics_hotels h ON h.id = ra.hotel_id
         JOIN logistics_trips t ON t.id = h.trip_id
         WHERE ra.org_id = $1 AND t.org_id = $1 AND t.event_key = $2`,
        [orgId, eventKey],
      ),
    ]);

  return {
    inspection: {
      items: inspectionItems.rows,
      weights: weights.rows,
      weightLimitLbs: settings.rows[0]?.weightLimitLbs ?? null,
    },
    consent: { forms: consentForms.rows, records: consentRecords.rows },
    packing: { lists: packingLists.rows.length, items: packingItems.rows },
    logistics: {
      trips: trips.rows.length,
      travelLegs: travelLegs.rows[0]?.n ?? 0,
      rooms: rooms.rows,
    },
  };
}

function summarizeCategories(items: ReadinessItem[]): CategorySummary[] {
  const map = new Map<ReadinessCategory, { done: number; total: number }>();
  for (const item of items) {
    const entry = map.get(item.category) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (item.status === "done" || item.status === "not_applicable") entry.done += 1;
    map.set(item.category, entry);
  }
  return [...map.entries()].map(([category, counts]) => ({ category, ...counts }));
}

export async function computeEventReadinessView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null; today?: string | null },
): Promise<EventReadinessView> {
  const today = input.today && isIsoDate(input.today) ? input.today : todayIsoDate();
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to build a pre-event readiness plan.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      teamNumber: null,
      eventCandidates: [],
      plans: [],
      today,
    };
  }

  const plans = await listPlans(client, org.orgId);
  const requestedKey = input.eventKey && input.eventKey.trim() ? input.eventKey.trim() : null;
  const selected =
    (requestedKey ? plans.find((p) => p.eventKey === requestedKey) : null) ??
    plans.find((p) => p.eventStartDate >= today) ??
    plans[plans.length - 1] ??
    null;

  if (!selected) {
    const eventCandidates = await listEventCandidates(client, org.orgId);
    const steps: EventReadinessSetupStep[] =
      eventCandidates.length > 0
        ? []
        : [
            {
              id: "active-event",
              label: "Set your active event",
              detail: "Pick your registered event on Your team so readiness can date the countdown from it",
              href: "/workspace",
            },
            {
              id: "manual-event",
              label: "Or enter the event by hand",
              detail: "Type an event key (e.g. 2026casj or a scrimmage name) and its start date below",
              href: "/event-readiness",
            },
          ];
    return {
      status: "setup_required",
      message:
        eventCandidates.length > 0
          ? "Pick an event and start a plan — the template dates every step back from the event start."
          : "No event on file yet. Set your active event on Your team, or enter an event key and start date by hand.",
      steps,
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      eventCandidates,
      plans,
      today,
    };
  }

  const planResult = await client.query<ReadinessPlan>(
    `SELECT id, event_key AS "eventKey", event_name AS "eventName",
            event_start_date::text AS "eventStartDate", season_year AS "seasonYear",
            travel_departs_at AS "travelDepartsAt", notes
     FROM event_readiness_plans
     WHERE org_id = $1 AND id = $2::uuid`,
    [org.orgId, selected.id],
  );
  const planRow = planResult.rows[0];
  if (!planRow) throw new Error("plan not found");
  const plan: ReadinessPlan = {
    ...planRow,
    travelDepartsAt: planRow.travelDepartsAt ? new Date(planRow.travelDepartsAt).toISOString() : null,
  };

  const items = await loadItems(client, org.orgId, plan.id);
  const snapshots = await loadSourceSnapshots(client, org.orgId, plan.eventKey, plan.seasonYear);
  const blockers = projectEventBlockers({ eventStartDate: plan.eventStartDate, ...snapshots });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    plan,
    plans,
    countdown: resolveDueDates({ eventStartDate: plan.eventStartDate, items, today }),
    categories: summarizeCategories(items),
    sources: blockers.sources,
    blockers,
    remaining: blockers.remaining,
    ready: blockers.ready,
    today,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createPlan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    eventName: string | null;
    eventStartDate: string | null;
    travelDepartsAt: string | null;
    notes: string | null;
    seedTemplate: boolean;
  },
): Promise<string> {
  const ref = await client.query<{ name: string; startDate: string | null; year: number }>(
    `SELECT name, start_date::text AS "startDate", year FROM events_ref WHERE event_key = $1`,
    [input.eventKey],
  );
  const refRow = ref.rows[0] ?? null;
  const eventStartDate = input.eventStartDate ?? refRow?.startDate ?? null;
  if (!eventStartDate || !isIsoDate(eventStartDate)) {
    throw new Error("This event isn't in the reference data — give its start date to build the countdown.");
  }
  const eventName = input.eventName ?? refRow?.name ?? input.eventKey;
  const seasonYear = refRow?.year ?? Number.parseInt(eventStartDate.slice(0, 4), 10);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO event_readiness_plans (org_id, event_key, season_year, event_name, event_start_date, travel_departs_at, notes, created_by)
     VALUES ($1, $2, $3::int, $4, $5::date, $6::timestamptz, $7, $8)
     ON CONFLICT (org_id, event_key) DO NOTHING
     RETURNING id`,
    [
      input.orgId,
      input.eventKey,
      seasonYear,
      eventName,
      eventStartDate,
      input.travelDepartsAt,
      input.notes ?? "",
      input.userId,
    ],
  );
  const planId = inserted.rows[0]?.id;
  if (!planId) throw new Error("A readiness plan for this event already exists.");

  if (input.seedTemplate) {
    for (const row of EVENT_READINESS_TEMPLATE) {
      await client.query(
        `INSERT INTO event_readiness_items (org_id, plan_id, category, title, detail, days_before, source_kind, created_by)
         VALUES ($1, $2::uuid, $3, $4, $5, $6::int, $7, $8)`,
        [input.orgId, planId, row.category, row.title, row.detail, row.daysBefore, row.sourceKind, input.userId],
      );
    }
  }
  return planId;
}

export async function addItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    planId: string;
    category: ReadinessCategory;
    title: string;
    detail: string | null;
    dueOn: string | null;
    daysBefore: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO event_readiness_items (org_id, plan_id, category, title, detail, due_on, days_before, source_kind, created_by)
     SELECT $1, p.id, $3, $4, $5, $6::date, $7::int, 'manual', $2
     FROM event_readiness_plans p
     WHERE p.id = $8::uuid AND p.org_id = $1`,
    [
      input.orgId,
      input.userId,
      input.category,
      input.title,
      input.detail ?? "",
      input.dueOn,
      input.daysBefore,
      input.planId,
    ],
  );
}

export async function updateItem(
  client: PoolClient,
  input: {
    orgId: string;
    itemId: string;
    title?: string | null;
    detail?: string | null;
    category?: ReadinessCategory | null;
    dueOn?: string | null;
    daysBefore?: number | null;
    clearDates?: boolean;
  },
): Promise<void> {
  await client.query(
    `UPDATE event_readiness_items
     SET title = COALESCE($3, title),
         detail = COALESCE($4, detail),
         category = COALESCE($5, category),
         due_on = CASE WHEN $8::boolean THEN NULL ELSE COALESCE($6::date, due_on) END,
         days_before = CASE WHEN $8::boolean THEN NULL ELSE COALESCE($7::int, days_before) END,
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2`,
    [
      input.itemId,
      input.orgId,
      input.title ?? null,
      input.detail ?? null,
      input.category ?? null,
      input.dueOn ?? null,
      input.daysBefore ?? null,
      input.clearDates ?? false,
    ],
  );
}

export async function setItemStatus(
  client: PoolClient,
  input: { orgId: string; userId: string; itemId: string; status: ReadinessStatus; blockedReason: string | null },
): Promise<void> {
  await client.query(
    `UPDATE event_readiness_items
     SET status = $3,
         blocked_reason = CASE WHEN $3 = 'blocked' THEN COALESCE($5, blocked_reason) ELSE '' END,
         completed_at = CASE WHEN $3 IN ('done', 'not_applicable') THEN now() ELSE NULL END,
         completed_by = CASE WHEN $3 IN ('done', 'not_applicable') THEN $4::uuid ELSE NULL END,
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2`,
    [input.itemId, input.orgId, input.status, input.userId, input.blockedReason],
  );
}

export async function assignItem(
  client: PoolClient,
  input: { orgId: string; itemId: string; ownerUserId: string | null },
): Promise<void> {
  if (input.ownerUserId) {
    const member = await client.query(
      `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2::uuid`,
      [input.orgId, input.ownerUserId],
    );
    if (!member.rowCount) throw new Error("Owner must be a member of this team.");
  }
  await client.query(
    `UPDATE event_readiness_items SET owner_user_id = $3::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2`,
    [input.itemId, input.orgId, input.ownerUserId],
  );
}

export async function deleteItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM event_readiness_items WHERE id = $1::uuid AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
}
