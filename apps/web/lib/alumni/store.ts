/**
 * Persisted `team_alumni` access. Request-path only: parameterized SQL through the
 * PoolClient from withRls. The directory is the table — empty when the org has
 * no rows, never a pre-seeded classmate list.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { directoryFromRows, parseAlumniWrite } from "./rows";
import type { AlumniDirectory, AlumniRow, AlumniWrite } from "./types";

const LIST_SQL = `SELECT id, full_name AS "fullName", grad_year AS "gradYear", current_role AS "currentRole",
                email, discord_handle AS "discordHandle", linkedin_url AS "linkedinUrl", note,
                is_mentor AS "isMentor", mentor_topic AS "mentorTopic",
                added_by AS "addedBy", created_at AS "createdAt"
         FROM team_alumni WHERE org_id=$1
         ORDER BY is_mentor DESC, grad_year DESC NULLS LAST, full_name ASC`;

export async function assertAlumniAccess(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<void> {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
    orgId,
    userId,
  ]);
  if (!member.rowCount) throw new Error("Organization access denied");
}

export async function listAlumni(
  client: PoolClient,
  input: { orgId: string; viewerId: string },
): Promise<AlumniDirectory> {
  const result = await client.query<Record<string, unknown>>(LIST_SQL, [input.orgId]);
  return directoryFromRows(result.rows, input.viewerId);
}

export async function insertAlumni(
  client: PoolClient,
  input: { orgId: string; userId: string; write: AlumniWrite },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO team_alumni(org_id, full_name, grad_year, current_role, email, discord_handle, linkedin_url, note, is_mentor, mentor_topic, added_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      input.orgId,
      input.write.fullName,
      input.write.gradYear,
      input.write.currentRole,
      input.write.email,
      input.write.discordHandle,
      input.write.linkedinUrl,
      input.write.note,
      input.write.isMentor,
      input.write.mentorTopic,
      input.userId,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Alumni row was not persisted");
  return id;
}

export async function addAlumni(
  client: PoolClient,
  input: { orgId: string; userId: string; body: Record<string, unknown> },
): Promise<{ id: string; directory: AlumniDirectory }> {
  const write = parseAlumniWrite(input.body);
  await assertAlumniAccess(client, input.orgId, input.userId);
  const id = await insertAlumni(client, { orgId: input.orgId, userId: input.userId, write });
  const directory = await listAlumni(client, { orgId: input.orgId, viewerId: input.userId });
  return { id, directory };
}

export async function loadAlumniDirectory(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<AlumniDirectory> {
  await assertAlumniAccess(client, input.orgId, input.userId);
  return listAlumni(client, { orgId: input.orgId, viewerId: input.userId });
}

export async function removeAlumni(
  client: PoolClient,
  input: { orgId: string; userId: string; id: string },
): Promise<void> {
  await assertAlumniAccess(client, input.orgId, input.userId);
  const result = await client.query(`DELETE FROM team_alumni WHERE id=$1 AND org_id=$2`, [
    input.id,
    input.orgId,
  ]);
  if (!result.rowCount) throw new Error("Not allowed to remove this entry");
}

export type { AlumniDirectory, AlumniRow, AlumniWrite };
