import type { PoolClient } from "@neondatabase/serverless";
import { WATCH_KINDS, type DutyWatch, type MyDayDutyCue, type WatchKind } from "./types";

/**
 * Only assigned watches become a My Day cue. An unassigned slot is a roster
 * hole, not a fabricated adult-on-the-floor.
 */
export function assignedWatches(watches: readonly DutyWatch[]): DutyWatch[] {
  return watches.filter((watch) => Boolean(watch.assignedUserId));
}

/** Active window first; otherwise the soonest future assigned slot. */
export function pickActiveWatch(watches: readonly DutyWatch[], now = new Date()): DutyWatch | null {
  const assigned = assignedWatches(watches);
  if (!assigned.length) return null;
  const t = now.getTime();
  const active = assigned.find((slot) => {
    const start = new Date(slot.startsAt).getTime();
    const end = slot.endsAt ? new Date(slot.endsAt).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(start) && start <= t && t <= end;
  });
  if (active) return active;
  return (
    [...assigned]
      .filter((slot) => new Date(slot.startsAt).getTime() > t)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

export function watchToMyDayCue(watch: DutyWatch): MyDayDutyCue {
  return {
    id: watch.id,
    tripId: null,
    mentorUserId: watch.assignedUserId,
    mentorName: watch.assignedUserName?.trim() || "On duty",
    phone: watch.phone,
    startsAt: watch.startsAt,
    endsAt: watch.endsAt,
    locationNote: watch.locationNote,
    notes: watch.notes,
    kind: watch.kind,
  };
}

type WatchRow = {
  id: string;
  kind: string;
  title: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  phone: string | null;
  startsAt: string;
  endsAt: string | null;
  locationNote: string | null;
  notes: string;
};

function isWatchKindRow(kind: string): kind is WatchKind {
  return (WATCH_KINDS as readonly string[]).includes(kind);
}

export function mapWatchRow(row: WatchRow, userId: string): DutyWatch | null {
  if (!isWatchKindRow(row.kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    assignedUserId: row.assignedUserId,
    assignedUserName: row.assignedUserName,
    phone: row.phone ?? "",
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    locationNote: row.locationNote ?? "",
    notes: row.notes ?? "",
    mine: row.assignedUserId === userId,
  };
}

/**
 * Read helper My Day can import. Returns null until an on-duty or chaperone
 * slot has a real assignee. Missing tables / older kind CHECKs → null, never
 * a fabricated mentor.
 */
export async function loadOnDutyForMyDay(
  client: PoolClient,
  input: { orgId: string; userId?: string; now?: Date },
): Promise<MyDayDutyCue | null> {
  try {
    const result = await client.query<WatchRow>(
      `SELECT d.id::text AS id, d.kind, d.title,
              d.assigned_user_id::text AS "assignedUserId", au.name AS "assignedUserName",
              COALESCE(d.phone, '') AS phone,
              d.starts_at::text AS "startsAt", d.ends_at::text AS "endsAt",
              COALESCE(d.location_note, '') AS "locationNote",
              d.notes
       FROM duty_assignments d
       LEFT JOIN users au ON au.id = d.assigned_user_id
       WHERE d.org_id = $1::uuid
         AND d.kind = ANY($2::text[])
         AND d.assigned_user_id IS NOT NULL
       ORDER BY d.starts_at ASC
       LIMIT 80`,
      [input.orgId, [...WATCH_KINDS]],
    );
    const watches = result.rows
      .map((row) => mapWatchRow(row, input.userId ?? ""))
      .filter((row): row is DutyWatch => row != null);
    const active = pickActiveWatch(watches, input.now ?? new Date());
    return active ? watchToMyDayCue(active) : null;
  } catch {
    return null;
  }
}
