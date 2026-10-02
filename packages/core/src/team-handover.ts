import type { PoolClient } from "@neondatabase/serverless";

export type StepDownRole = "admin" | "scout" | "viewer";

export function assertTeamHandover(input: {
  actorRole: string | null; actorUserId: string; userId: string;
  recipientRole: string | null; recipientVerified: boolean; nextRole: string;
}) {
  if (input.actorRole !== "owner") throw new Error("Only an owner can hand over the team");
  if (input.actorUserId === input.userId) throw new Error("Choose another teammate");
  if (!input.recipientRole) throw new Error("That person must join the team first");
  if (!input.recipientVerified) throw new Error("That person must verify their email first");
  if (!["admin", "scout", "viewer"].includes(input.nextRole)) throw new Error("Choose your new access");
}

/** All membership role changes use this lock, including self-demotion. */
export async function lockTeamAdministration(client: PoolClient, orgId: string) {
  const row = await client.query(`SELECT id FROM organizations WHERE id=$1::uuid FOR UPDATE`, [orgId]);
  if (!row.rowCount) throw new Error("Team not found");
}

/** Call inside withRls: recipient promotion, audit and step-down commit together. */
export async function handOverTeam(client: PoolClient, actorUserId: string,
  input: { orgId: string; userId: string; role: StepDownRole }) {
  await lockTeamAdministration(client, input.orgId);
  const people = await client.query<{ userId: string; role: string; verified: boolean }>(
    `SELECT m.user_id AS "userId", m.role, u.email_verified AS verified
     FROM memberships m JOIN users u ON u.id=m.user_id
     WHERE m.org_id=$1 AND m.user_id=ANY($2::uuid[]) FOR UPDATE OF m`,
    [input.orgId, [actorUserId, input.userId]],
  );
  const actor = people.rows.find(row => row.userId === actorUserId);
  const recipient = people.rows.find(row => row.userId === input.userId);
  assertTeamHandover({ actorRole: actor?.role ?? null, actorUserId, userId: input.userId,
    recipientRole: recipient?.role ?? null, recipientVerified: recipient?.verified === true, nextRole: input.role });
  await client.query(`UPDATE memberships SET role='owner' WHERE org_id=$1 AND user_id=$2`, [input.orgId, input.userId]);
  // Audit while the actor still has administration rights. A later failure
  // rolls back this event and the promotion as well as the step-down.
  await client.query(
    `INSERT INTO membership_audit_events(org_id,actor_user_id,action,metadata)
     VALUES($1,$2,'team.handed_over',$3::jsonb)`,
    [input.orgId, actorUserId, JSON.stringify({ newOwnerUserId: input.userId, previousOwnerRole: input.role })],
  );
  await client.query(`DELETE FROM membership_capabilities WHERE org_id=$1 AND user_id=$2`, [input.orgId, actorUserId]);
  await client.query(`UPDATE memberships SET role=$3::org_role WHERE org_id=$1 AND user_id=$2`,
    [input.orgId, actorUserId, input.role]);
}
