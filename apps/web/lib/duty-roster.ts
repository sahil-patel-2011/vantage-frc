// Duty roster — DB / notification side. Client-safe types and helpers live in
// duty-roster-shared.ts so Soft-UI never pulls @vantage/core into the browser.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { emitPreferredNotification } from "@vantage/core";
import {
  DUTY_KIND_LABELS,
  dutyToCalendarKind,
  dutyWorkflowLinks,
  type DutyAction,
  type DutyAssignment,
  type DutyKind,
  type DutyRosterView,
} from "./duty-roster-shared";

export {
  DUTY_KINDS,
  DUTY_KIND_LABELS,
  defaultDutyTitle,
  dutyToCalendarKind,
  dutyWorkflowLinks,
  filterDutiesForScope,
  groupDutiesByDay,
  isDutyKind,
  parseDutyAction,
  sortDuties,
  type DutyAction,
  type DutyAssignment,
  type DutyKind,
  type DutyRosterView,
  type DutyWorkflowLink,
} from "./duty-roster-shared";

type DutyRow = {
  id: string;
  title: string;
  kind: DutyKind;
  startsAt: string;
  endsAt: string | null;
  subteamId: string | null;
  subteamName: string | null;
  subteamColor: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  calendarEventId: string | null;
  notes: string;
  createdByName: string | null;
};

async function loadDutyRows(client: PoolClient, orgId: string): Promise<DutyRow[]> {
  const result = await client.query<DutyRow>(
    `SELECT d.id, d.title, d.kind,
            d.starts_at::text AS "startsAt", d.ends_at::text AS "endsAt",
            d.subteam_id AS "subteamId", st.name AS "subteamName", st.color AS "subteamColor",
            d.assigned_user_id AS "assignedUserId", au.name AS "assignedUserName",
            d.calendar_event_id AS "calendarEventId", d.notes,
            cb.name AS "createdByName"
     FROM duty_assignments d
     LEFT JOIN team_subteams st ON st.id = d.subteam_id
     LEFT JOIN users au ON au.id = d.assigned_user_id
     LEFT JOIN users cb ON cb.id = d.created_by
     WHERE d.org_id = $1
       AND d.starts_at > now() - interval '120 days'
     ORDER BY d.starts_at ASC
     LIMIT 800`,
    [orgId],
  );
  return result.rows;
}

function mapDuty(row: DutyRow, userId: string): DutyAssignment {
  return {
    ...row,
    mine: row.assignedUserId === userId,
  };
}

export async function listDutiesForOrg(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<DutyAssignment[]> {
  const rows = await loadDutyRows(client, orgId);
  return rows.map((row) => mapDuty(row, userId));
}

async function assertOrgMember(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new Error("Organization membership required");
  return row.rows[0]!.role;
}

async function assertSubteam(client: PoolClient, orgId: string, subteamId: string | null) {
  if (!subteamId) return;
  const row = await client.query(`SELECT 1 FROM team_subteams WHERE org_id = $1 AND id = $2`, [
    orgId,
    subteamId,
  ]);
  if (!row.rowCount) throw new Error("Unknown subteam");
}

async function assertAssignee(client: PoolClient, orgId: string, userId: string | null) {
  if (!userId) return;
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
    orgId,
    userId,
  ]);
  if (!row.rowCount) throw new Error("Assignee must be a team member");
}

function dutyHref(orgId: string, dutyId: string): string {
  return `/team/calendar?orgId=${encodeURIComponent(orgId)}&dutyId=${encodeURIComponent(dutyId)}`;
}

async function notifyDutyAssigned(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    assigneeUserId: string;
    dutyId: string;
    title: string;
    kind: DutyKind;
  },
): Promise<void> {
  if (input.assigneeUserId === input.actorUserId) return;
  const actor = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    input.actorUserId,
  ]);
  const links = dutyWorkflowLinks(input.kind, input.orgId);
  await emitPreferredNotification(client, {
    userId: input.assigneeUserId,
    orgId: input.orgId,
    type: "duty_assigned",
    payload: {
      title: "Duty assigned to you",
      body: `${actor.rows[0]?.name ?? "A teammate"} assigned you “${input.title}” (${DUTY_KIND_LABELS[input.kind]}).`,
      dutyId: input.dutyId,
      kind: input.kind,
      href: dutyHref(input.orgId, input.dutyId),
      workflowHref: links[0]?.href ?? dutyHref(input.orgId, input.dutyId),
    },
  });
}

async function createLinkedCalendarEvent(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    kind: DutyKind;
    startsAt: string;
    endsAt: string | null;
    subteamId: string | null;
    notes: string;
  },
): Promise<string | null> {
  try {
    const calendarKind = dutyToCalendarKind(input.kind);
    const notePrefix = `Duty: ${DUTY_KIND_LABELS[input.kind]}`;
    const notes = input.notes ? `${notePrefix}\n${input.notes}` : notePrefix;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subteam_calendar_events
         (org_id, subteam_id, title, kind, starts_at, ends_at, location, notes, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, '', $7, $8::uuid)
       RETURNING id`,
      [
        input.orgId,
        input.subteamId,
        input.title,
        calendarKind,
        input.startsAt,
        input.endsAt,
        notes,
        input.userId,
      ],
    );
    return inserted.rows[0]?.id ?? null;
  } catch {
    // Calendar tables may be absent in some environments — duty still saves.
    return null;
  }
}

export async function createDuty(
  client: PoolClient,
  input: Extract<DutyAction, { action: "create_duty" }> & { userId: string },
): Promise<string> {
  await assertOrgMember(client, input.orgId, input.userId);
  await assertSubteam(client, input.orgId, input.subteamId);
  await assertAssignee(client, input.orgId, input.assignedUserId);

  let calendarEventId = input.calendarEventId;
  if (!calendarEventId && input.linkCalendar) {
    calendarEventId = await createLinkedCalendarEvent(client, {
      orgId: input.orgId,
      userId: input.userId,
      title: input.title,
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      subteamId: input.subteamId,
      notes: input.notes,
    });
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO duty_assignments
       (org_id, title, kind, starts_at, ends_at, subteam_id, assigned_user_id,
        calendar_event_id, notes, created_by)
     VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6::uuid, $7::uuid,
             $8::uuid, $9, $10::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.title,
      input.kind,
      input.startsAt,
      input.endsAt,
      input.subteamId,
      input.assignedUserId,
      calendarEventId,
      input.notes,
      input.userId,
    ],
  );
  const dutyId = inserted.rows[0]!.id;

  if (input.assignedUserId) {
    await notifyDutyAssigned(client, {
      orgId: input.orgId,
      actorUserId: input.userId,
      assigneeUserId: input.assignedUserId,
      dutyId,
      title: input.title,
      kind: input.kind,
    });
  }

  return dutyId;
}

export async function updateDuty(
  client: PoolClient,
  input: Extract<DutyAction, { action: "update_duty" }> & { userId: string },
): Promise<void> {
  await assertOrgMember(client, input.orgId, input.userId);

  const existing = await client.query<{
    assignedUserId: string | null;
    title: string;
    kind: DutyKind;
  }>(
    `SELECT assigned_user_id AS "assignedUserId", title, kind
     FROM duty_assignments WHERE id = $1 AND org_id = $2`,
    [input.id, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Duty not found");

  if (input.subteamId !== undefined) await assertSubteam(client, input.orgId, input.subteamId);
  if (input.assignedUserId !== undefined) {
    await assertAssignee(client, input.orgId, input.assignedUserId);
  }

  const startsAt = input.startsAt;
  const endsAt = input.endsAt;
  if (startsAt && endsAt && endsAt < startsAt) throw new Error("End must be on or after start");

  await client.query(
    `UPDATE duty_assignments SET
       title = COALESCE($3, title),
       kind = COALESCE($4, kind),
       starts_at = COALESCE($5::timestamptz, starts_at),
       ends_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE ends_at END,
       subteam_id = CASE WHEN $8::boolean THEN $9::uuid ELSE subteam_id END,
       assigned_user_id = CASE WHEN $10::boolean THEN $11::uuid ELSE assigned_user_id END,
       notes = COALESCE($12, notes),
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.id,
      input.orgId,
      input.title ?? null,
      input.kind ?? null,
      input.startsAt ?? null,
      input.endsAt !== undefined,
      input.endsAt ?? null,
      input.subteamId !== undefined,
      input.subteamId ?? null,
      input.assignedUserId !== undefined,
      input.assignedUserId ?? null,
      input.notes ?? null,
    ],
  );

  const nextAssignee = input.assignedUserId !== undefined ? input.assignedUserId : row.assignedUserId;
  const nextTitle = input.title ?? row.title;
  const nextKind = input.kind ?? row.kind;
  if (nextAssignee && nextAssignee !== row.assignedUserId) {
    await notifyDutyAssigned(client, {
      orgId: input.orgId,
      actorUserId: input.userId,
      assigneeUserId: nextAssignee,
      dutyId: input.id,
      title: nextTitle,
      kind: nextKind,
    });
  }
}

export async function deleteDuty(
  client: PoolClient,
  input: { orgId: string; id: string; userId: string },
): Promise<void> {
  await assertOrgMember(client, input.orgId, input.userId);
  const existing = await client.query<{ calendarEventId: string | null }>(
    `SELECT calendar_event_id AS "calendarEventId"
     FROM duty_assignments WHERE id = $1 AND org_id = $2`,
    [input.id, input.orgId],
  );
  if (!existing.rowCount) throw new Error("Duty not found");

  await client.query(`DELETE FROM duty_assignments WHERE id = $1 AND org_id = $2`, [
    input.id,
    input.orgId,
  ]);

  const calendarEventId = existing.rows[0]?.calendarEventId;
  if (calendarEventId) {
    // Linked event may already be gone or calendar tables unavailable. Savepointed
    // so that stays a tolerated miss: the duty DELETE above is already in this
    // transaction, and a bare catch here would have taken it down at COMMIT.
    await withSavepoint(
      client,
      () =>
        client.query(
          `DELETE FROM subteam_calendar_events
           WHERE id = $1 AND org_id = $2 AND notes LIKE 'Duty:%'`,
          [calendarEventId, input.orgId],
        ),
      null,
    );
  }
}

export async function computeDutyRosterView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<DutyRosterView> {
  const membership = await client.query<{
    orgId: string;
    role: string;
    orgName: string;
    teamNumber: number | null;
  }>(
    `SELECT m.org_id AS "orgId", m.role, o.name AS "orgName", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to assign duties on the calendar.",
      orgId: null,
    };
  }

  const [duties, members, subteams] = await Promise.all([
    listDutiesForOrg(client, org.orgId, input.userId),
    client.query<{ userId: string; name: string | null; email: string | null }>(
      `SELECT m.user_id AS "userId", u.name, u.email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1
       ORDER BY lower(coalesce(u.name, u.email)), u.email
       LIMIT 500`,
      [org.orgId],
    ),
    // team_subteams is optional here; `.catch(() => …)` alone left the shared
    // transaction aborted, so a missing table emptied the duties and members
    // loaded alongside it rather than just the subteam colours.
    withSavepoint(
      client,
      async () =>
        (
          await client.query<{ id: string; name: string; color: string }>(
            `SELECT id, name, color FROM team_subteams WHERE org_id = $1 ORDER BY sort_order, lower(name)`,
            [org.orgId],
          )
        ).rows,
      [] as { id: string; name: string; color: string }[],
    ),
  ]);

  return {
    status: "ready",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    orgName: org.orgName,
    role: org.role,
    userId: input.userId,
    canManage: org.role === "owner" || org.role === "admin",
    duties,
    members: members.rows,
    subteams,
  };
}
