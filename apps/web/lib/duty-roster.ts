// Duty roster — scouting / pit / drive team / outreach slots assigned to
// members or subteams. Pure helpers for API, calendar UI, and unit tests.
// No demo rows: empty until someone assigns a duty.

import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";

export const DUTY_KINDS = ["scouting", "pit", "drive_team", "outreach"] as const;
export type DutyKind = (typeof DUTY_KINDS)[number];

export const DUTY_KIND_LABELS: Record<DutyKind, string> = {
  scouting: "Scouting",
  pit: "Pit duty",
  drive_team: "Drive team",
  outreach: "Outreach",
};

export type DutyWorkflowLink = { href: string; label: string };

export type DutyAssignment = {
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
  mine: boolean;
};

export type DutyRosterView =
  | {
      status: "ready";
      orgId: string;
      teamNumber: number | null;
      orgName: string;
      role: string;
      userId: string;
      canManage: boolean;
      duties: DutyAssignment[];
      members: { userId: string; name: string | null; email: string | null }[];
      subteams: { id: string; name: string; color: string }[];
    }
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
    };

function withOrgPath(path: string, orgId: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Deep links from a duty card into scout / pit / command / outreach surfaces. */
export function dutyWorkflowLinks(kind: DutyKind, orgId: string): DutyWorkflowLink[] {
  switch (kind) {
    case "scouting":
      return [
        { href: withOrgPath("/scouting", orgId), label: "Scout forms" },
        { href: withOrgPath("/scouting/lineup", orgId), label: "Lineup & coverage" },
      ];
    case "pit":
      return [
        { href: withOrgPath("/pit", orgId), label: "Pit Command" },
        { href: withOrgPath("/command", orgId), label: "Event Day" },
      ];
    case "drive_team":
      return [
        { href: withOrgPath("/command", orgId), label: "Event Day Command" },
        { href: withOrgPath("/practice", orgId), label: "Practice" },
      ];
    case "outreach":
      return [
        { href: withOrgPath("/impact", orgId), label: "Community Impact" },
        { href: withOrgPath("/business", orgId), label: "Business" },
      ];
  }
}

/** Map a duty kind onto a subteam calendar event kind for the shared calendar. */
export function dutyToCalendarKind(kind: DutyKind): "event" | "outreach" | "meeting" {
  if (kind === "outreach") return "outreach";
  if (kind === "scouting") return "event";
  return "event";
}

export function defaultDutyTitle(kind: DutyKind): string {
  return DUTY_KIND_LABELS[kind];
}

/** Team view = all duties; personal = assigned to me (or my subteam with no member). */
export function filterDutiesForScope(
  duties: DutyAssignment[],
  scope: "team" | "mine",
  userId: string,
  mySubteamIds: string[] = [],
): DutyAssignment[] {
  if (scope === "team") return duties;
  const mine = new Set(mySubteamIds);
  return duties.filter(
    (duty) =>
      duty.assignedUserId === userId ||
      (duty.assignedUserId == null && duty.subteamId != null && mine.has(duty.subteamId)),
  );
}

export function sortDuties<T extends { startsAt: string; title: string }>(duties: T[]): T[] {
  return [...duties].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title),
  );
}

export function groupDutiesByDay<T extends { startsAt: string; title: string }>(
  duties: T[],
): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const duty of sortDuties(duties)) {
    const day = duty.startsAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(duty);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}

export function isDutyKind(value: unknown): value is DutyKind {
  return typeof value === "string" && (DUTY_KINDS as readonly string[]).includes(value);
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return uuid(value, label);
}

function isoDateTime(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date/time`);
  return date.toISOString();
}

function optionalIsoDateTime(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return isoDateTime(value, label);
}

export type DutyAction =
  | {
      action: "create_duty";
      orgId: string;
      title: string;
      kind: DutyKind;
      startsAt: string;
      endsAt: string | null;
      subteamId: string | null;
      assignedUserId: string | null;
      calendarEventId: string | null;
      notes: string;
      /** When true and no calendarEventId, create a linked calendar event. */
      linkCalendar: boolean;
    }
  | {
      action: "update_duty";
      orgId: string;
      id: string;
      title?: string;
      kind?: DutyKind;
      startsAt?: string;
      endsAt?: string | null;
      subteamId?: string | null;
      assignedUserId?: string | null;
      notes?: string;
    }
  | { action: "delete_duty"; orgId: string; id: string };

export function parseDutyAction(input: unknown): DutyAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid duty action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_duty": {
      const kind = isDutyKind(body.kind) ? body.kind : null;
      if (!kind) throw new Error("Kind is invalid");
      const title =
        body.title == null || String(body.title).trim() === ""
          ? defaultDutyTitle(kind)
          : requiredText(body.title, "Title", 200);
      const startsAt = isoDateTime(body.startsAt, "Start");
      const endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (endsAt && endsAt < startsAt) throw new Error("End must be on or after start");
      return {
        action,
        orgId,
        title,
        kind,
        startsAt,
        endsAt,
        subteamId: optionalUuid(body.subteamId, "Subteam"),
        assignedUserId: optionalUuid(body.assignedUserId, "Assignee"),
        calendarEventId: optionalUuid(body.calendarEventId, "Calendar event"),
        notes: optionalText(body.notes, 2000),
        linkCalendar: body.linkCalendar !== false,
      };
    }
    case "update_duty": {
      const id = uuid(body.id, "Duty");
      const patch: Extract<DutyAction, { action: "update_duty" }> = { action, orgId, id };
      if (body.title !== undefined) patch.title = requiredText(body.title, "Title", 200);
      if (body.kind !== undefined) {
        if (!isDutyKind(body.kind)) throw new Error("Kind is invalid");
        patch.kind = body.kind;
      }
      if (body.startsAt !== undefined) patch.startsAt = isoDateTime(body.startsAt, "Start");
      if (body.endsAt !== undefined) patch.endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (body.subteamId !== undefined) patch.subteamId = optionalUuid(body.subteamId, "Subteam");
      if (body.assignedUserId !== undefined) {
        patch.assignedUserId = optionalUuid(body.assignedUserId, "Assignee");
      }
      if (body.notes !== undefined) patch.notes = optionalText(body.notes, 2000);
      return patch;
    }
    case "delete_duty":
      return { action, orgId, id: uuid(body.id, "Duty") };
    default:
      throw new Error("Unsupported duty action");
  }
}

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
    try {
      await client.query(
        `DELETE FROM subteam_calendar_events
         WHERE id = $1 AND org_id = $2 AND notes LIKE 'Duty:%'`,
        [calendarEventId, input.orgId],
      );
    } catch {
      // Linked event may already be gone or calendar tables unavailable.
    }
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
      message: "Select a team workspace to assign duties on the calendar.",
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
    client.query<{ id: string; name: string; color: string }>(
      `SELECT id, name, color FROM team_subteams WHERE org_id = $1 ORDER BY sort_order, lower(name)`,
      [org.orgId],
    ).catch(() => ({ rows: [] as { id: string; name: string; color: string }[] })),
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
    subteams: subteams.rows,
  };
}
