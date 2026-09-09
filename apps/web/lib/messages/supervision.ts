/**
 * Database side of the youth-protection DM rules (migration 0455_chat_youth_protection.sql).
 *
 * All reads go through the request `PoolClient` from `withRls`. Teammate `team_role` is not
 * readable under RLS, so classification and the adult-admin roster come from the two
 * SECURITY DEFINER helpers the migration installs, which disclose only what the two-adult rule
 * needs (an adult/youth label, and who could serve as the second adult).
 *
 * Every function degrades to "not supported" when the migration has not run yet, so chat keeps
 * working on an un-migrated database instead of crashing.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { cachedSchemaSupport } from "../schema-probe";
import {
  DEFAULT_DM_MODE,
  decideDm,
  normalizeChatClass,
  normalizeDmMode,
  type ChatMemberClass,
  type DmMode,
  type SupervisorCandidate,
} from "./youth-protection";

let youthProtectionSupportedCache: boolean | null = null;

export type SupervisorRef = {
  userId: string;
  name: string;
  reason: string;
  addedAt: string;
};

/**
 * Whether migration 0455 is present.
 *
 * This one is worth naming: the old `catch { cache = false }` meant a single
 * aborted transaction anywhere in the process could latch youth protection OFF —
 * for every org, until a restart — and the DM route would then stop applying the
 * two-adult rule while reporting nothing wrong. A probe that cannot answer now
 * answers `false` for this request only and is never cached.
 */
export async function supportsYouthProtection(client: PoolClient): Promise<boolean> {
  return cachedSchemaSupport(
    client,
    {
      read: () => youthProtectionSupportedCache,
      write: (value) => {
        youthProtectionSupportedCache = value;
      },
    },
    `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('org_chat_policy', 'org_conversation_supervisors')
       GROUP BY table_schema
       HAVING COUNT(*) = 2`,
  );
}

/** Test seam: the capability probe is cached per process like the other chat probes. */
export function resetYouthProtectionCapabilityCache(): void {
  youthProtectionSupportedCache = null;
}

export async function readDmMode(client: PoolClient, orgId: string): Promise<DmMode> {
  if (!(await supportsYouthProtection(client))) return DEFAULT_DM_MODE;
  const row = await client.query<{ dmMode: string }>(
    `SELECT dm_mode AS "dmMode" FROM org_chat_policy WHERE org_id = $1::uuid LIMIT 1`,
    [orgId],
  );
  // No row means the team has never opened the policy screen. The default is supervised, which
  // is the entire point: the safe shape must not require anyone to go find a setting.
  if (!row.rowCount) return DEFAULT_DM_MODE;
  return normalizeDmMode(row.rows[0]!.dmMode);
}

/** True when the caller holds the org owner/admin role (the RLS write predicate, checked up front). */
export async function isOrgChatAdmin(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM memberships
     WHERE org_id = $1::uuid AND user_id = $2::uuid AND role IN ('owner','admin')
     LIMIT 1`,
    [orgId, userId],
  );
  return Boolean(row.rowCount);
}

export async function writeDmMode(
  client: PoolClient,
  orgId: string,
  actorUserId: string,
  mode: DmMode,
): Promise<DmMode> {
  if (!(await supportsYouthProtection(client))) {
    throw new Error("Chat safety settings require migration 0455_chat_youth_protection");
  }
  if (!(await isOrgChatAdmin(client, orgId, actorUserId))) {
    throw new Error("Only an owner or admin can change chat safety settings");
  }
  const row = await client.query<{ dmMode: string }>(
    `INSERT INTO org_chat_policy (org_id, dm_mode, updated_by, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, now())
     ON CONFLICT (org_id) DO UPDATE
       SET dm_mode = excluded.dm_mode,
           updated_by = excluded.updated_by,
           updated_at = now()
     RETURNING dm_mode AS "dmMode"`,
    [orgId, mode, actorUserId],
  );
  if (!row.rowCount) throw new Error("Only an owner or admin can change chat safety settings");
  return normalizeDmMode(row.rows[0]!.dmMode);
}

export async function memberChatClass(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<ChatMemberClass> {
  if (!(await supportsYouthProtection(client))) return "youth";
  const row = await client.query<{ chatClass: string | null }>(
    `SELECT org_member_chat_class($1::uuid, $2::uuid) AS "chatClass"`,
    [orgId, userId],
  );
  return normalizeChatClass(row.rows[0]?.chatClass ?? null);
}

export async function adultAdmins(client: PoolClient, orgId: string): Promise<SupervisorCandidate[]> {
  if (!(await supportsYouthProtection(client))) return [];
  const rows = await client.query<{
    userId: string;
    name: string;
    memberRole: string;
    memberSince: string | null;
  }>(
    `SELECT user_id AS "userId",
            name,
            member_role AS "memberRole",
            member_since::text AS "memberSince"
     FROM org_adult_admins($1::uuid)`,
    [orgId],
  );
  return rows.rows;
}

export async function listSupervisors(
  client: PoolClient,
  conversationId: string,
): Promise<SupervisorRef[]> {
  if (!(await supportsYouthProtection(client))) return [];
  const rows = await client.query<SupervisorRef>(
    `SELECT s.supervisor_user_id AS "userId",
            COALESCE(u.name, 'Member') AS name,
            s.reason,
            s.added_at::text AS "addedAt"
     FROM org_conversation_supervisors s
     INNER JOIN users u ON u.id = s.supervisor_user_id
     WHERE s.conversation_id = $1::uuid
     ORDER BY s.added_at ASC`,
    [conversationId],
  );
  return rows.rows;
}

export type DmGuard = {
  supported: boolean;
  mode: DmMode;
  /** Set when a second adult must be added to (or is already on) this conversation. */
  supervisor: SupervisorCandidate | null;
  needsSupervision: boolean;
};

/**
 * Decide whether this pair may hold a private conversation, and who the second adult is.
 * Throws with a message naming the org policy when the pair is not allowed — the caller surfaces
 * it verbatim so a student is told the rule rather than seeing a generic failure.
 */
export async function guardDmPair(
  client: PoolClient,
  args: {
    orgId: string;
    actorUserId: string;
    peerUserId: string;
    conversationId?: string | null;
  },
): Promise<DmGuard> {
  if (!(await supportsYouthProtection(client))) {
    return { supported: false, mode: "open", supervisor: null, needsSupervision: false };
  }

  const mode = await readDmMode(client, args.orgId);
  const [actorClass, peerClass] = await Promise.all([
    memberChatClass(client, args.orgId, args.actorUserId),
    memberChatClass(client, args.orgId, args.peerUserId),
  ]);
  const needsSupervision = actorClass !== peerClass;

  const existing = args.conversationId ? await listSupervisors(client, args.conversationId) : [];
  const candidates =
    needsSupervision && mode === "supervised" && existing.length === 0
      ? await adultAdmins(client, args.orgId)
      : [];

  const decision = decideDm({
    mode,
    initiatorClass: actorClass,
    peerClass,
    candidates,
    partyUserIds: [args.actorUserId, args.peerUserId],
    existingSupervisorIds: existing.map((item) => item.userId),
  });

  if (decision.outcome === "refuse") throw new Error(decision.message);
  return {
    supported: true,
    mode,
    supervisor: decision.outcome === "supervise" ? decision.supervisor : null,
    needsSupervision,
  };
}

/**
 * Record the second adult and add them to the conversation. Insert-only by design: the
 * supervision record cannot be removed by either party (no DELETE grant on the table).
 */
export async function attachSupervisor(
  client: PoolClient,
  args: {
    orgId: string;
    conversationId: string;
    supervisorUserId: string;
    reason?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO org_conversation_supervisors (conversation_id, supervisor_user_id, org_id, reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
     ON CONFLICT (conversation_id, supervisor_user_id) DO NOTHING`,
    [args.conversationId, args.supervisorUserId, args.orgId, args.reason ?? "ypp_two_adult_rule"],
  );
  await client.query(
    `INSERT INTO org_conversation_participants (conversation_id, user_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT DO NOTHING`,
    [args.conversationId, args.supervisorUserId],
  );
}

/** The two people a DM is actually between — supervisors are excluded. */
export async function dmPartyIds(
  client: PoolClient,
  conversationId: string,
): Promise<string[]> {
  const supported = await supportsYouthProtection(client);
  const rows = supported
    ? await client.query<{ userId: string }>(
        `SELECT p.user_id AS "userId"
         FROM org_conversation_participants p
         WHERE p.conversation_id = $1::uuid
           AND NOT EXISTS (
             SELECT 1 FROM org_conversation_supervisors s
             WHERE s.conversation_id = p.conversation_id AND s.supervisor_user_id = p.user_id
           )
         ORDER BY p.joined_at ASC, p.user_id ASC`,
        [conversationId],
      )
    : await client.query<{ userId: string }>(
        `SELECT user_id AS "userId" FROM org_conversation_participants
         WHERE conversation_id = $1::uuid
         ORDER BY joined_at ASC, user_id ASC`,
        [conversationId],
      );
  return rows.rows.map((row) => row.userId);
}
