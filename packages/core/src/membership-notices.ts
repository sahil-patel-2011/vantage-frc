import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "./in-app-notifications";
import { roleHint, roleLabel, rolePhrase, selfDescribedWords, suggestedRoleFor } from "./role-words";

/**
 * The inbox rows a change of membership writes for the person it happened to (QA A3-15/16):
 * nobody was told when an owner changed their access, took them off the team, or handed them
 * the team, and a removed student found a "Profile saved, join your team" screen with no word
 * of why. Plus the owners' "X joined" notice, which now says how they came in.
 *
 * Builders are pure (tested without a database); the emit helpers run inside the caller's
 * transaction, each in a savepoint, so a notice that cannot be written (a database before
 * migration 0721) never undoes the change itself. The peer-insert policies are in 0721.
 */

export const MEMBERSHIP_NOTICE_TYPES = {
  roleChanged: "team_role_changed",
  removed: "team_removed",
  ownershipGiven: "team_ownership_given",
  inviteSuggestion: "invite_suggestion",
} as const;

/** "Team 9301 · QA 3 Alpha", "Team 9301", or the name alone. */
export function teamDisplayName(teamNumber: number | null | undefined, name: string | null | undefined): string {
  const number = typeof teamNumber === "number" && Number.isFinite(teamNumber) ? `Team ${teamNumber}` : null;
  const clean = name?.trim() || null;
  if (number && clean && clean.toLowerCase() !== number.toLowerCase()) return `${number} · ${clean}`;
  return number ?? clean ?? "your team";
}

export function roleChangedNotice(input: {
  orgId: string;
  team: string;
  actorName: string | null;
  role: string;
  previousRole: string | null;
}) {
  const who = input.actorName?.trim() || "A team lead";
  const raised = input.previousRole ? rankOf(input.role) > rankOf(input.previousRole) : true;
  return {
    type: MEMBERSHIP_NOTICE_TYPES.roleChanged,
    payload: {
      title: `You're now ${rolePhrase(input.role)} on ${input.team}`,
      body:
        `${who} changed your access from ${roleLabel(input.previousRole)} to ${roleLabel(input.role)}. ` +
        `${roleLabel(input.role)}: ${roleHint(input.role)}` +
        (raised ? "" : ` If you think this is a mistake, ask ${who}.`),
      href: `/dashboard?orgId=${encodeURIComponent(input.orgId)}`,
      role: input.role,
      previousRole: input.previousRole,
    },
  };
}

export function removedNotice(input: {
  orgId: string;
  team: string;
  teamNumber: number | null;
  teamName: string | null;
  actorName: string | null;
  removedAt?: string;
}) {
  const who = input.actorName?.trim() || "A team lead";
  return {
    type: MEMBERSHIP_NOTICE_TYPES.removed,
    payload: {
      title: `You were removed from ${input.team}`,
      body: `${who} took you off ${input.team}. Your Vantage account is still yours. If this was a mistake, ask the team's owner to invite you again.`,
      orgId: input.orgId,
      teamNumber: input.teamNumber,
      teamName: input.teamName,
      removedBy: who,
      removedAt: input.removedAt ?? new Date().toISOString(),
    },
  };
}

export function ownershipGivenNotice(input: { orgId: string; team: string; actorName: string | null }) {
  const who = input.actorName?.trim() || "The previous owner";
  return {
    type: MEMBERSHIP_NOTICE_TYPES.ownershipGiven,
    payload: {
      title: `You're now the owner of ${input.team}`,
      body: `${who} handed the team over to you. You decide who joins and what each person can do, in Team admin.`,
      href: `/team/admin?orgId=${encodeURIComponent(input.orgId)}`,
    },
  };
}

/**
 * The owners' and admins' notice when someone joins. A code joiner's access was chosen by
 * nobody, so it says so, and says what the person told us they are when that suggests a
 * different access ("They said they're a parent").
 */
export function inviteAcceptedNotice(input: {
  userId: string;
  who: string;
  role: string | null;
  viaCode: boolean;
  selfRole: string | null;
}) {
  const access = input.role ? roleLabel(input.role) : null;
  const said = selfDescribedWords(input.selfRole);
  const fits = suggestedRoleFor(input.selfRole);
  const mismatch = Boolean(said && fits && input.role && fits !== input.role);
  const title = input.viaCode
    ? `${input.who} joined with the team code${access ? ` as ${access}` : ""}`
    : `${input.who} joined${access ? ` as ${access}` : ""}`;
  let body = "They're on the team now.";
  if (mismatch) {
    body = `They said they're ${said}. If ${roleLabel(fits)} fits better, change their access in Team admin.`;
  } else if (input.viaCode && input.role === "viewer") {
    body = "They can look but not change anything. If they're a student, give them Student access in Team admin.";
  } else if (input.viaCode) {
    body = "Nobody picked their access by hand: check it in Team admin.";
  }
  return { type: "invite_accepted", payload: { userId: input.userId, title, body } };
}

function rankOf(role: string | null | undefined): number {
  return { viewer: 0, scout: 1, admin: 2, owner: 3 }[role ?? ""] ?? -1;
}

type NoticeContext = { teamNumber: number | null; teamName: string | null; team: string; actorName: string | null };

/** Read the context and write the notice in one savepoint: any failure leaves the change itself standing. */
async function emitInSavepoint(
  client: PoolClient,
  orgId: string,
  actorUserId: string,
  build: (context: NoticeContext) => { userId: string; orgId?: string; type: string; payload: Record<string, unknown> },
): Promise<boolean> {
  await client.query("SAVEPOINT membership_notice");
  try {
    const { emitted } = await emitPreferredNotification(client, build(await noticeContext(client, orgId, actorUserId)));
    await client.query("RELEASE SAVEPOINT membership_notice");
    return emitted;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT membership_notice");
    return false;
  }
}

/** Team label and the acting lead's name, read under the lead's own row security. */
async function noticeContext(client: PoolClient, orgId: string, actorUserId: string): Promise<NoticeContext> {
  const row = (
    await client.query<{ teamNumber: number | null; teamName: string | null; actorName: string | null }>(
      `SELECT o.team_number AS "teamNumber", o.name AS "teamName",
              (SELECT COALESCE(NULLIF(btrim(u.name), ''), NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''))
                 FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $2::uuid) AS "actorName"
         FROM organizations o WHERE o.id = $1::uuid`,
      [orgId, actorUserId],
    )
  ).rows[0];
  return {
    teamNumber: row?.teamNumber ?? null,
    teamName: row?.teamName ?? null,
    team: teamDisplayName(row?.teamNumber, row?.teamName),
    actorName: row?.actorName ?? null,
  };
}

export async function notifyRoleChanged(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; userId: string; role: string; previousRole: string | null },
): Promise<boolean> {
  if (input.userId === input.actorUserId || input.role === input.previousRole) return false;
  return emitInSavepoint(client, input.orgId, input.actorUserId, (context) => ({
    userId: input.userId,
    orgId: input.orgId,
    ...roleChangedNotice({ orgId: input.orgId, team: context.team, actorName: context.actorName, role: input.role, previousRole: input.previousRole }),
  }));
}

/** Call after the membership row is gone (the 0721 policy checks it is). No org_id: they can't open the team any more. */
export async function notifyRemovedFromTeam(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; userId: string },
): Promise<boolean> {
  if (input.userId === input.actorUserId) return false;
  return emitInSavepoint(client, input.orgId, input.actorUserId, (context) => ({
    userId: input.userId,
    ...removedNotice({ orgId: input.orgId, ...context }),
  }));
}

/** Call while the giver is still an owner (before they step down). */
export async function notifyOwnershipGiven(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; userId: string },
): Promise<boolean> {
  if (input.userId === input.actorUserId) return false;
  return emitInSavepoint(client, input.orgId, input.actorUserId, (context) => ({
    userId: input.userId,
    orgId: input.orgId,
    ...ownershipGivenNotice({ orgId: input.orgId, team: context.team, actorName: context.actorName }),
  }));
}

export type TeamRemovalNotice = {
  orgId: string;
  team: string;
  removedBy: string | null;
  removedAt: string;
};

/**
 * The newest "you were removed" notice for a person who is not back on that team, for the
 * no-team screen. Their own inbox rows only (notifications_self), from the last 60 days.
 */
export async function latestTeamRemoval(client: PoolClient, userId: string): Promise<TeamRemovalNotice | null> {
  const row = (
    await client.query<{ payload: Record<string, unknown>; createdAt: Date }>(
      `SELECT n.payload, n.created_at AS "createdAt"
         FROM notifications n
        WHERE n.user_id = $1::uuid AND n.type = $2
          AND n.created_at > now() - interval '60 days'
          AND NOT EXISTS (
            SELECT 1 FROM memberships m
             WHERE m.user_id = $1::uuid AND m.org_id::text = n.payload->>'orgId')
        ORDER BY n.created_at DESC
        LIMIT 1`,
      [userId, MEMBERSHIP_NOTICE_TYPES.removed],
    )
  ).rows[0];
  if (!row) return null;
  const payload = row.payload ?? {};
  const orgId = typeof payload.orgId === "string" ? payload.orgId : null;
  if (!orgId) return null;
  const teamNumber = typeof payload.teamNumber === "number" ? payload.teamNumber : null;
  const teamName = typeof payload.teamName === "string" ? payload.teamName : null;
  return {
    orgId,
    team: teamDisplayName(teamNumber, teamName),
    removedBy: typeof payload.removedBy === "string" ? payload.removedBy : null,
    removedAt: typeof payload.removedAt === "string" ? payload.removedAt : row.createdAt.toISOString(),
  };
}
