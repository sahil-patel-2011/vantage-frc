import type { PoolClient } from "@neondatabase/serverless";
import { resolveAuthBaseURL } from "./access-policy";
import { assertOrgCapability } from "./capabilities";
import { createInviteToken, isInviteTokenShape, type OrgRole } from "./invite-token";

export const JOIN_LINK_MAX_USES = 50;
export const JOIN_LINK_TTL_DAYS = 30;

export type JoinLinkMemberRole = Extract<OrgRole, "scout" | "viewer">;
export type JoinLinkStatus = "open" | "revoked" | "expired" | "full";

export type TeamJoinLinkPreview = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  memberRole: JoinLinkMemberRole;
  status: JoinLinkStatus;
  remaining: number;
  maxUses: number;
  expiresAt: string;
};

export type TeamJoinLinkRecord = {
  id: string;
  orgId: string;
  memberRole: JoinLinkMemberRole;
  maxUses: number;
  useCount: number;
  remaining: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  url: string | null;
};

export function joinAcceptUrl(token: string): string {
  return `${resolveAuthBaseURL()}/join?token=${encodeURIComponent(token.trim())}`;
}

export function parseJoinLinkMemberRole(value: unknown): JoinLinkMemberRole {
  if (value === "viewer") return "viewer";
  return "scout";
}

export function clampJoinLinkMaxUses(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return JOIN_LINK_MAX_USES;
  return Math.min(JOIN_LINK_MAX_USES, Math.max(1, n));
}

function isJoinLinkStatus(value: string): value is JoinLinkStatus {
  return value === "open" || value === "revoked" || value === "expired" || value === "full";
}

function isJoinLinkMemberRole(value: string): value is JoinLinkMemberRole {
  return value === "scout" || value === "viewer";
}

export async function peekTeamJoinLink(
  client: PoolClient,
  token: string,
): Promise<TeamJoinLinkPreview | null> {
  if (!isInviteTokenShape(token)) return null;
  const result = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    memberRole: string;
    status: string;
    remaining: number;
    maxUses: number;
    expiresAt: string;
  }>(
    `SELECT org_id AS "orgId", org_name AS "orgName", team_number AS "teamNumber",
            member_role AS "memberRole", status, remaining, max_uses AS "maxUses",
            expires_at::text AS "expiresAt"
     FROM peek_team_join_link($1)`,
    [token.trim()],
  );
  const row = result.rows[0];
  if (!row || !isJoinLinkStatus(row.status) || !isJoinLinkMemberRole(row.memberRole)) return null;
  return {
    orgId: row.orgId,
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    memberRole: row.memberRole,
    status: row.status,
    remaining: row.remaining,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt,
  };
}

export async function createTeamJoinLink(
  client: PoolClient,
  actorUserId: string,
  input: { orgId: string; maxUses?: number; memberRole?: JoinLinkMemberRole },
): Promise<{ link: TeamJoinLinkRecord; token: string; url: string }> {
  await assertOrgCapability(client, input.orgId, "manage_members");
  const maxUses = clampJoinLinkMaxUses(input.maxUses);
  const memberRole = parseJoinLinkMemberRole(input.memberRole);
  const { token, tokenHash } = createInviteToken();

  await client.query(
    `UPDATE team_join_links
     SET revoked_at = now(), updated_at = now()
     WHERE org_id = $1::uuid AND revoked_at IS NULL AND expires_at > now() AND use_count < max_uses`,
    [input.orgId],
  );

  const inserted = await client.query<{
    id: string;
    orgId: string;
    memberRole: JoinLinkMemberRole;
    maxUses: number;
    useCount: number;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }>(
    `INSERT INTO team_join_links (
       org_id, token_hash, created_by, member_role, max_uses, expires_at
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4::org_role, $5,
       now() + ($6::int * interval '1 day')
     )
     RETURNING id, org_id AS "orgId", member_role AS "memberRole", max_uses AS "maxUses",
               use_count AS "useCount", expires_at::text AS "expiresAt",
               revoked_at::text AS "revokedAt", created_at::text AS "createdAt"`,
    [input.orgId, tokenHash, actorUserId, memberRole, maxUses, JOIN_LINK_TTL_DAYS],
  );
  const row = inserted.rows[0]!;
  const url = joinAcceptUrl(token);
  return {
    token,
    url,
    link: {
      ...row,
      remaining: row.maxUses - row.useCount,
      url,
    },
  };
}

export async function listTeamJoinLinks(
  client: PoolClient,
  orgId: string,
): Promise<TeamJoinLinkRecord[]> {
  const result = await client.query<{
    id: string;
    orgId: string;
    memberRole: JoinLinkMemberRole;
    maxUses: number;
    useCount: number;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }>(
    `SELECT id, org_id AS "orgId", member_role AS "memberRole", max_uses AS "maxUses",
            use_count AS "useCount", expires_at::text AS "expiresAt",
            revoked_at::text AS "revokedAt", created_at::text AS "createdAt"
     FROM team_join_links
     WHERE org_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT 12`,
    [orgId],
  );
  return result.rows.map((row) => ({
    ...row,
    remaining: Math.max(0, row.maxUses - row.useCount),
    url: null,
  }));
}

export async function revokeTeamJoinLink(
  client: PoolClient,
  actorUserId: string,
  input: { orgId: string; id: string },
): Promise<void> {
  await assertOrgCapability(client, input.orgId, "manage_members");
  const updated = await client.query(
    `UPDATE team_join_links
     SET revoked_at = now(), updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL`,
    [input.id, input.orgId],
  );
  if (!updated.rowCount) throw new Error("Join link not found");
  void actorUserId;
}

export async function tryRedeemTeamJoinLink(
  client: PoolClient,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || !isInviteTokenShape(token)) return false;
  try {
    await redeemTeamJoinLink(client, token);
    return true;
  } catch {
    return false;
  }
}

export async function redeemTeamJoinLink(
  client: PoolClient,
  token: string,
): Promise<{ orgId: string; orgName: string; memberRole: string; alreadyMember: boolean }> {
  if (!isInviteTokenShape(token)) throw new Error("That join link is not valid");
  const result = await client.query<{
    orgId: string;
    orgName: string;
    memberRole: string;
    alreadyMember: boolean;
  }>(
    `SELECT org_id AS "orgId", org_name AS "orgName", member_role AS "memberRole",
            already_member AS "alreadyMember"
     FROM redeem_team_join_link($1)`,
    [token.trim()],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Could not join that team");
  return row;
}

export async function joinLinkAllowsSignup(
  client: PoolClient,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || !isInviteTokenShape(token)) return false;
  const preview = await peekTeamJoinLink(client, token);
  return preview?.status === "open";
}

