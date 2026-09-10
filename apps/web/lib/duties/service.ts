import type { PoolClient } from "@neondatabase/serverless";
import { assertOrgManager, isOrgManager, orgRole } from "../team-admin/permissions";
import { loadOnDutyForMyDay, mapWatchRow, pickActiveWatch, watchToMyDayCue } from "./my-day";
import type { WatchAction } from "./parse";
import {
  ROSTER_KINDS,
  WATCH_KINDS,
  type DutiesView,
  type DutyRosterSlot,
  type DutyWatch,
  type RosterKind,
} from "./types";

export { loadOnDutyForMyDay, pickActiveWatch, watchToMyDayCue };

type WatchRow = Parameters<typeof mapWatchRow>[0];

async function hasWatchColumns(client: PoolClient): Promise<boolean> {
  const cols = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'duty_assignments'
       AND column_name = ANY($1::text[])`,
    [["phone", "location_note"]],
  );
  return cols.rows.some((row) => row.column_name === "phone");
}

async function loadWatchRows(client: PoolClient, orgId: string): Promise<WatchRow[]> {
  const extended = await hasWatchColumns(client);
  const contact = extended
    ? `COALESCE(d.phone, '') AS phone, COALESCE(d.location_note, '') AS "locationNote"`
    : `''::text AS phone, ''::text AS "locationNote"`;
  const result = await client.query<WatchRow>(
    `SELECT d.id::text AS id, d.kind, d.title,
            d.assigned_user_id::text AS "assignedUserId", au.name AS "assignedUserName",
            ${contact},
            d.starts_at::text AS "startsAt", d.ends_at::text AS "endsAt",
            d.notes
     FROM duty_assignments d
     LEFT JOIN users au ON au.id = d.assigned_user_id
     WHERE d.org_id = $1::uuid
       AND d.kind = ANY($2::text[])
     ORDER BY d.starts_at ASC
     LIMIT 200`,
    [orgId, [...WATCH_KINDS]],
  );
  return result.rows;
}

function mapWatches(rows: WatchRow[], userId: string): DutyWatch[] {
  return rows.map((row) => mapWatchRow(row, userId)).filter((row): row is DutyWatch => row != null);
}

async function assertAssignee(client: PoolClient, orgId: string, userId: string | null) {
  if (!userId) return;
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
    orgId,
    userId,
  ]);
  if (!row.rowCount) throw new Error("Assignee must be a team member");
}

function migrationHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/kind|check constraint|duty_assignments_kind/i.test(message)) {
    return new Error("Apply the duty on-duty/chaperone migration first (0500_duty_on_duty_chaperone).");
  }
  if (/phone|location_note|column .* does not exist/i.test(message)) {
    return new Error("Apply the duty on-duty/chaperone migration first (0500_duty_on_duty_chaperone).");
  }
  return error instanceof Error ? error : new Error(message);
}

export async function assignWatch(
  client: PoolClient,
  input: Extract<WatchAction, { action: "assign_watch" }> & { userId: string },
): Promise<string> {
  const role = await orgRole(client, input.orgId, input.userId);
  if (!role) throw new Error("Organization membership required");
  assertOrgManager(role, "post an on-duty or chaperone assignment");
  await assertAssignee(client, input.orgId, input.assignedUserId);

  const extended = await hasWatchColumns(client);
  try {
    const inserted = extended
      ? await client.query<{ id: string }>(
          `INSERT INTO duty_assignments
             (org_id, title, kind, starts_at, ends_at, assigned_user_id, notes, created_by, phone, location_note)
           VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6::uuid, $7, $8::uuid, $9, $10)
           RETURNING id::text AS id`,
          [
            input.orgId,
            input.title,
            input.kind,
            input.startsAt,
            input.endsAt,
            input.assignedUserId,
            input.notes,
            input.userId,
            input.phone,
            input.locationNote,
          ],
        )
      : await client.query<{ id: string }>(
          `INSERT INTO duty_assignments
             (org_id, title, kind, starts_at, ends_at, assigned_user_id, notes, created_by)
           VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6::uuid, $7, $8::uuid)
           RETURNING id::text AS id`,
          [
            input.orgId,
            input.title,
            input.kind,
            input.startsAt,
            input.endsAt,
            input.assignedUserId,
            input.notes,
            input.userId,
          ],
        );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Duty was not saved");
    return id;
  } catch (error) {
    throw migrationHint(error);
  }
}

export async function updateWatch(
  client: PoolClient,
  input: Extract<WatchAction, { action: "update_watch" }> & { userId: string },
): Promise<void> {
  const role = await orgRole(client, input.orgId, input.userId);
  if (!role) throw new Error("Organization membership required");
  assertOrgManager(role, "change an on-duty or chaperone assignment");
  if (input.assignedUserId !== undefined) {
    await assertAssignee(client, input.orgId, input.assignedUserId);
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM duty_assignments
     WHERE id = $1::uuid AND org_id = $2::uuid AND kind = ANY($3::text[])`,
    [input.id, input.orgId, [...WATCH_KINDS]],
  );
  if (!existing.rowCount) throw new Error("Duty not found");

  const extended = await hasWatchColumns(client);
  try {
    if (extended) {
      await client.query(
        `UPDATE duty_assignments SET
           title = COALESCE($3, title),
           kind = COALESCE($4, kind),
           starts_at = COALESCE($5::timestamptz, starts_at),
           ends_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE ends_at END,
           assigned_user_id = CASE WHEN $8::boolean THEN $9::uuid ELSE assigned_user_id END,
           notes = COALESCE($10, notes),
           phone = CASE WHEN $11::boolean THEN $12 ELSE phone END,
           location_note = CASE WHEN $13::boolean THEN $14 ELSE location_note END,
           updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [
          input.id,
          input.orgId,
          input.title ?? null,
          input.kind ?? null,
          input.startsAt ?? null,
          input.endsAt !== undefined,
          input.endsAt ?? null,
          input.assignedUserId !== undefined,
          input.assignedUserId ?? null,
          input.notes ?? null,
          input.phone !== undefined,
          input.phone ?? "",
          input.locationNote !== undefined,
          input.locationNote ?? "",
        ],
      );
      return;
    }
    await client.query(
      `UPDATE duty_assignments SET
         title = COALESCE($3, title),
         kind = COALESCE($4, kind),
         starts_at = COALESCE($5::timestamptz, starts_at),
         ends_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE ends_at END,
         assigned_user_id = CASE WHEN $8::boolean THEN $9::uuid ELSE assigned_user_id END,
         notes = COALESCE($10, notes),
         updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [
        input.id,
        input.orgId,
        input.title ?? null,
        input.kind ?? null,
        input.startsAt ?? null,
        input.endsAt !== undefined,
        input.endsAt ?? null,
        input.assignedUserId !== undefined,
        input.assignedUserId ?? null,
        input.notes ?? null,
      ],
    );
  } catch (error) {
    throw migrationHint(error);
  }
}

export async function deleteWatch(
  client: PoolClient,
  input: { orgId: string; id: string; userId: string },
): Promise<void> {
  const role = await orgRole(client, input.orgId, input.userId);
  if (!role) throw new Error("Organization membership required");
  assertOrgManager(role, "remove an on-duty or chaperone assignment");

  const deleted = await client.query(
    `DELETE FROM duty_assignments
     WHERE id = $1::uuid AND org_id = $2::uuid AND kind = ANY($3::text[])`,
    [input.id, input.orgId, [...WATCH_KINDS]],
  );
  if (!deleted.rowCount) throw new Error("Duty not found");
}

export async function applyWatchAction(
  client: PoolClient,
  input: WatchAction & { userId: string },
): Promise<void> {
  switch (input.action) {
    case "assign_watch":
      await assignWatch(client, input);
      return;
    case "update_watch":
      await updateWatch(client, input);
      return;
    case "delete_watch":
      await deleteWatch(client, input);
      return;
  }
}

async function loadRoster(client: PoolClient, orgId: string): Promise<DutyRosterSlot[]> {
  try {
    const result = await client.query<{
      id: string;
      title: string;
      kind: string;
      startsAt: string;
      endsAt: string | null;
      assignedUserId: string | null;
      assignedUserName: string | null;
      subteamName: string | null;
    }>(
      `SELECT d.id::text AS id, d.title, d.kind,
              d.starts_at::text AS "startsAt", d.ends_at::text AS "endsAt",
              d.assigned_user_id::text AS "assignedUserId", au.name AS "assignedUserName",
              st.name AS "subteamName"
       FROM duty_assignments d
       LEFT JOIN users au ON au.id = d.assigned_user_id
       LEFT JOIN team_subteams st ON st.id = d.subteam_id
       WHERE d.org_id = $1::uuid
         AND d.kind = ANY($2::text[])
         AND d.starts_at > now() - interval '120 days'
       ORDER BY d.starts_at ASC
       LIMIT 400`,
      [orgId, [...ROSTER_KINDS]],
    );
    return result.rows.flatMap((row): DutyRosterSlot[] => {
      if (!(ROSTER_KINDS as readonly string[]).includes(row.kind)) return [];
      return [{ ...row, kind: row.kind as RosterKind }];
    });
  } catch {
    return [];
  }
}

export async function computeDutiesView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; now?: Date },
): Promise<DutiesView> {
  const membership = await client.query<{
    orgId: string;
    role: string;
    orgName: string;
    teamNumber: number | null;
  }>(
    `SELECT m.org_id AS "orgId", m.role::text AS role, o.name AS "orgName", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to post who is on duty.",
      orgId: null,
    };
  }

  let watches: DutyWatch[];
  try {
    watches = mapWatches(await loadWatchRows(client, org.orgId), input.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/duty_assignments|relation .* does not exist/i.test(message)) {
      return {
        status: "setup_required",
        message: "Apply the duty roster migration first (0145_duty_roster).",
        orgId: org.orgId,
      };
    }
    throw error;
  }

  const [members, roster] = await Promise.all([
    client.query<{ userId: string; name: string | null; email: string | null }>(
      `SELECT m.user_id::text AS "userId", u.name, u.email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1::uuid
       ORDER BY lower(coalesce(u.name, u.email)), u.email
       LIMIT 500`,
      [org.orgId],
    ),
    loadRoster(client, org.orgId),
  ]);

  const now = input.now ?? new Date();
  const activeWatch = pickActiveWatch(watches, now);

  return {
    status: "ready",
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    role: org.role,
    userId: input.userId,
    canManage: isOrgManager(org.role),
    watches,
    activeWatch,
    myDayCue: activeWatch ? watchToMyDayCue(activeWatch) : null,
    roster,
    members: members.rows,
  };
}
