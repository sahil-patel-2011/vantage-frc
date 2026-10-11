import type { PoolClient } from "@neondatabase/serverless";
import { LifecycleError, normalizeTeamName } from "./model";

type Client = Pick<PoolClient, "query">;

/** One of the person's teams, with what they may do to it. Read through RLS as that person. */
export type TeamLifecycleView = {
  orgId: string;
  name: string;
  teamNumber: number | null;
  role: "owner" | "admin" | "scout" | "viewer";
  memberCount: number;
  /** Another owner exists, so this person may leave even as an owner. */
  otherOwner: boolean;
  /** Owners and team admins rename the team (organizations_admin_profile_update). */
  canRename: boolean;
  canDelete: boolean;
  /** False for the last owner, who hands the team over first. */
  canLeave: boolean;
  /** A paid plan still bills this team; it is cancelled before the team is deleted. */
  paidPlan: boolean;
};

type ViewRow = {
  orgId: string;
  name: string;
  teamNumber: number | null;
  role: TeamLifecycleView["role"];
  memberCount: string | number;
  ownerCount: string | number;
  paidPlan: boolean;
};

function toView(row: ViewRow): TeamLifecycleView {
  const owner = row.role === "owner";
  const otherOwner = Number(row.ownerCount) > (owner ? 1 : 0);
  return {
    orgId: row.orgId,
    name: row.name,
    teamNumber: row.teamNumber,
    role: row.role,
    memberCount: Number(row.memberCount),
    otherOwner,
    canRename: owner || row.role === "admin",
    canDelete: owner,
    canLeave: !owner || otherOwner,
    paidPlan: row.paidPlan === true,
  };
}

const VIEW_SQL = `SELECT o.id::text AS "orgId", o.name, o.team_number AS "teamNumber", m.role::text AS role,
         (SELECT count(*) FROM memberships x WHERE x.org_id = o.id) AS "memberCount",
         (SELECT count(*) FROM memberships x WHERE x.org_id = o.id AND x.role = 'owner') AS "ownerCount",
         CASE WHEN m.role = 'owner' THEN team_has_live_subscription(o.id) ELSE false END AS "paidPlan"
    FROM memberships m JOIN organizations o ON o.id = m.org_id
   WHERE m.user_id = $1::uuid`;

/** Every team the person is on, in the order the chooser lists them (number, then name). */
export async function listTeamLifecycle(client: Client, userId: string): Promise<TeamLifecycleView[]> {
  const result = await client.query<ViewRow>(`${VIEW_SQL} ORDER BY o.team_number NULLS LAST, o.name`, [userId]);
  return result.rows.map(toView);
}

/** One team, or null when the person is not on it (RLS shows nothing of a team you're not on). */
export async function loadTeamLifecycle(client: Client, userId: string, orgId: string): Promise<TeamLifecycleView | null> {
  const result = await client.query<ViewRow>(`${VIEW_SQL} AND o.id = $2::uuid`, [userId, orgId]);
  return result.rows[0] ? toView(result.rows[0]) : null;
}

/** Owners and team admins rename the team. Returns the stored name. */
export async function renameTeam(client: Client, actorUserId: string, orgId: string, rawName: unknown): Promise<string> {
  const name = normalizeTeamName(rawName);
  if (!name) throw new LifecycleError("invalid_name");
  const team = await loadTeamLifecycle(client, actorUserId, orgId);
  if (!team) throw new LifecycleError("not_a_member");
  if (!team.canRename) throw new LifecycleError("not_allowed");
  if (team.name === name) return name;
  const updated = await client.query<{ name: string }>(
    `UPDATE organizations SET name = $2 WHERE id = $1::uuid RETURNING name`,
    [orgId, name],
  );
  if (!updated.rows[0]) throw new LifecycleError("not_allowed");
  await client.query(
    `INSERT INTO membership_audit_events(org_id, actor_user_id, action, metadata)
     VALUES ($1::uuid, $2::uuid, 'team.renamed', $3::jsonb)`,
    [orgId, actorUserId, JSON.stringify({ before: team.name, after: name })],
  );
  return updated.rows[0].name;
}

/** Leave a team (0720 leave_team: the last owner is refused). */
export async function leaveTeam(client: Client, orgId: string): Promise<void> {
  await client.query(`SELECT leave_team($1::uuid)`, [orgId]);
}

/** Delete a team for good (0720 delete_team: owner or platform admin, typed number, no paid plan). */
export async function deleteTeam(client: Client, orgId: string, confirm: string): Promise<void> {
  await client.query(`SELECT delete_team($1::uuid, $2::text)`, [orgId, confirm]);
}

/** Delete the signed-in person's own account (0720 delete_my_account: typed email address). */
export async function deleteMyAccount(client: Client, confirm: string): Promise<void> {
  await client.query(`SELECT delete_my_account($1::text)`, [confirm]);
}
