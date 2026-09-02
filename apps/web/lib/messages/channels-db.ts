/**
 * Database side of team-chat channels (migration 0494_chat_channels.sql).
 *
 * Every query runs on the request `PoolClient` from `withRls`. The rules live in ./channels.ts;
 * this file only reads and writes. Each entry point degrades when the migration has not run yet
 * (`supportsChannels` false): the inbox collapses to the single "Team" channel plus DMs exactly as
 * before, and the channel actions throw a message naming the migration instead of crashing.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  canEditMessage,
  canLeaveChannel,
  canManageChannel,
  canPostToChannel,
  GENERAL_SLUG,
  normalizeChannelDescription,
  normalizeChannelKind,
  normalizeChannelTitle,
  revisionForEdit,
  slugifyChannelTitle,
  uniqueChannelSlug,
  type ChannelKind,
  type ConversationKind,
} from "./channels";
import { isOrgChatAdmin } from "./supervision";

const TEAM_CHANNEL_TITLE = "Team";
const MAX_BODY = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHANNELS_MIGRATION_HINT = "Channels require migration 0494_chat_channels";

let channelsSupportedCache: boolean | null = null;

export async function supportsChannels(client: PoolClient): Promise<boolean> {
  if (channelsSupportedCache != null) return channelsSupportedCache;
  try {
    const row = await client.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('org_conversation_members', 'org_message_revisions')
       GROUP BY table_schema
       HAVING COUNT(*) = 2`,
    );
    channelsSupportedCache = Boolean(row.rowCount);
  } catch {
    channelsSupportedCache = false;
  }
  return channelsSupportedCache;
}

export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  slug: string | null;
  description: string | null;
  subteamId: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  updatedAt: string;
  lastMessageAt: string | null;
  lastBody: string | null;
  peerUserId: string | null;
  peerName: string | null;
  unreadCount: number;
  isMember: boolean;
  memberRole: string | null;
  canPost: boolean;
};

export type ChannelPermissions = {
  channelsSupported: boolean;
  /** Owner/admin org role or mentor/coach team role: post announcements, create/archive channels. */
  canAnnounce: boolean;
  canCreate: boolean;
};

/** Announce/manage permission. Falls back to owner/admin before migration 0494. */
export async function canAnnounceFor(client: PoolClient, orgId: string, userId: string): Promise<boolean> {
  if (!(await supportsChannels(client))) return isOrgChatAdmin(client, orgId, userId);
  const row = await client.query<{ allowed: boolean | null }>(
    `SELECT org_chat_can_announce($1::uuid, $2::uuid) AS allowed`,
    [orgId, userId],
  );
  return Boolean(row.rows[0]?.allowed);
}

export async function channelPermissions(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<ChannelPermissions> {
  const channelsSupported = await supportsChannels(client);
  const canAnnounce = await canAnnounceFor(client, orgId, userId);
  return { channelsSupported, canAnnounce, canCreate: channelsSupported && canAnnounce };
}

/**
 * The org's #general channel, created on first use. Before 0494 this is the legacy "Team"
 * conversation; after it, the same row carries slug 'general' and the caller is guaranteed a
 * member row (a member who joined the org after the backfill is added here).
 */
export async function ensureGeneralChannel(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const channelsSupported = await supportsChannels(client);
  const existing = channelsSupported
    ? await client.query<{ id: string; slug: string | null }>(
        `SELECT id, slug FROM org_conversations
         WHERE org_id = $1 AND kind = 'team' AND (slug = $2 OR lower(title) = lower($3))
         ORDER BY (slug = $2) DESC, created_at ASC
         LIMIT 1`,
        [orgId, GENERAL_SLUG, TEAM_CHANNEL_TITLE],
      )
    : await client.query<{ id: string; slug: string | null }>(
        `SELECT id, NULL::text AS slug FROM org_conversations
         WHERE org_id = $1 AND kind = 'team' AND lower(title) = lower($2)
         LIMIT 1`,
        [orgId, TEAM_CHANNEL_TITLE],
      );

  let conversationId = existing.rows[0]?.id ?? null;

  if (!conversationId) {
    await client.query("SAVEPOINT ensure_general_channel");
    try {
      const inserted = channelsSupported
        ? await client.query<{ id: string }>(
            `INSERT INTO org_conversations (org_id, kind, title, slug, created_by)
             VALUES ($1, 'team', $2, $3, $4)
             RETURNING id`,
            [orgId, TEAM_CHANNEL_TITLE, GENERAL_SLUG, userId],
          )
        : await client.query<{ id: string }>(
            `INSERT INTO org_conversations (org_id, kind, title, created_by)
             VALUES ($1, 'team', $2, $3)
             RETURNING id`,
            [orgId, TEAM_CHANNEL_TITLE, userId],
          );
      await client.query("RELEASE SAVEPOINT ensure_general_channel");
      conversationId = inserted.rows[0]!.id;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT ensure_general_channel");
      const again = await client.query<{ id: string }>(
        `SELECT id FROM org_conversations
         WHERE org_id = $1 AND kind = 'team' AND lower(title) = lower($2)
         LIMIT 1`,
        [orgId, TEAM_CHANNEL_TITLE],
      );
      conversationId = again.rows[0]?.id ?? null;
    }
  }
  if (!conversationId) throw new Error("Could not open team channel");

  if (channelsSupported) {
    if (existing.rows[0] && !existing.rows[0].slug) {
      await client.query(
        `UPDATE org_conversations SET slug = $2
         WHERE id = $1 AND slug IS NULL
           AND NOT EXISTS (SELECT 1 FROM org_conversations o WHERE o.org_id = $3 AND o.slug = $2)`,
        [conversationId, GENERAL_SLUG, orgId],
      );
    }
    await client.query(
      `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
       VALUES ($1, $2, $3, 'member')
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [orgId, conversationId, userId],
    );
  }

  return conversationId;
}

type RawInboxRow = Omit<ConversationRow, "canPost" | "isMember" | "unreadCount"> & {
  isMember: boolean | null;
  unreadCount: number | string;
};

/**
 * Every conversation the caller can see, with unread counts. Channels (team/announce/subteam)
 * read their cursor from org_conversation_members; DMs from org_conversation_participants.
 */
export async function listInbox(
  client: PoolClient,
  orgId: string,
  userId: string,
  options: { supervisionSupported: boolean; canAnnounce: boolean },
): Promise<ConversationRow[]> {
  await ensureGeneralChannel(client, orgId, userId);
  const channelsSupported = await supportsChannels(client);

  // A supervised DM has three participants, so the peer label has to aggregate rather than join
  // row-per-participant (that would duplicate the conversation in the inbox). Supervisors are
  // excluded from the label: the thread is still "you and Sam", with a supervision banner inside.
  const peersCte = options.supervisionSupported
    ? `peers AS (
       SELECT p.conversation_id,
              MIN(u.id::text)::uuid AS peer_user_id,
              string_agg(u.name, ', ' ORDER BY lower(u.name)) AS peer_name
       FROM org_conversation_participants p
       INNER JOIN users u ON u.id = p.user_id
       INNER JOIN visible v ON v.id = p.conversation_id AND v.kind = 'dm'
       WHERE p.user_id <> $2
         AND NOT EXISTS (
           SELECT 1 FROM org_conversation_supervisors s
           WHERE s.conversation_id = p.conversation_id AND s.supervisor_user_id = p.user_id
         )
       GROUP BY p.conversation_id
     )`
    : `peers AS (
       SELECT p.conversation_id, u.id AS peer_user_id, u.name AS peer_name
       FROM org_conversation_participants p
       INNER JOIN users u ON u.id = p.user_id
       INNER JOIN visible v ON v.id = p.conversation_id AND v.kind = 'dm'
       WHERE p.user_id <> $2
     )`;

  const visibleCols = channelsSupported
    ? `c.id, c.kind, c.title, c.slug, c.description, c.subteam_id, c.archived_at, c.created_by, c.updated_at`
    : `c.id, c.kind, c.title,
       CASE WHEN c.kind = 'team' AND lower(c.title) = 'team' THEN 'general' ELSE NULL END AS slug,
       NULL::text AS description, NULL::uuid AS subteam_id, NULL::timestamptz AS archived_at,
       c.created_by, c.updated_at`;

  const readsCte = channelsSupported
    ? `reads AS (
       SELECT p.conversation_id, p.last_read_at, NULL::text AS role
       FROM org_conversation_participants p
       INNER JOIN visible v ON v.id = p.conversation_id AND v.kind = 'dm'
       WHERE p.user_id = $2
       UNION ALL
       SELECT cm.conversation_id, cm.last_read_at, cm.role
       FROM org_conversation_members cm
       WHERE cm.user_id = $2
     )`
    : `reads AS (
       SELECT conversation_id, last_read_at, NULL::text AS role
       FROM org_conversation_participants
       WHERE user_id = $2
     )`;

  const isMemberExpr = channelsSupported ? `(v.kind = 'dm' OR r.conversation_id IS NOT NULL)` : `true`;
  const unreadGate = channelsSupported
    ? `(v.kind = 'dm' OR (r.conversation_id IS NOT NULL AND v.archived_at IS NULL))`
    : `true`;

  const rows = await client.query<RawInboxRow>(
    `WITH visible AS (
       SELECT ${visibleCols}
       FROM org_conversations c
       WHERE c.org_id = $1
         AND (
           c.kind <> 'dm'
           OR EXISTS (
             SELECT 1 FROM org_conversation_participants p
             WHERE p.conversation_id = c.id AND p.user_id = $2
           )
         )
     ),
     last_msg AS (
       SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.body,
         m.created_at,
         m.deleted_at
       FROM org_messages m
       INNER JOIN visible v ON v.id = m.conversation_id
       WHERE m.deleted_at IS NULL
       ORDER BY m.conversation_id, m.created_at DESC
     ),
     ${peersCte},
     ${readsCte}
     SELECT
       v.id,
       v.kind,
       v.title,
       v.slug,
       v.description,
       v.subteam_id AS "subteamId",
       v.archived_at::text AS "archivedAt",
       v.created_by AS "createdBy",
       v.updated_at::text AS "updatedAt",
       lm.created_at::text AS "lastMessageAt",
       CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE NULL END AS "lastBody",
       pe.peer_user_id AS "peerUserId",
       pe.peer_name AS "peerName",
       ${isMemberExpr} AS "isMember",
       r.role AS "memberRole",
       CASE WHEN ${unreadGate} THEN COALESCE((
         SELECT COUNT(*)::int
         FROM org_messages m
         WHERE m.conversation_id = v.id
           AND m.deleted_at IS NULL
           AND m.author_user_id <> $2
           AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
       ), 0) ELSE 0 END AS "unreadCount"
     FROM visible v
     LEFT JOIN last_msg lm ON lm.conversation_id = v.id
     LEFT JOIN peers pe ON pe.conversation_id = v.id
     LEFT JOIN reads r ON r.conversation_id = v.id
     ORDER BY
       CASE
         WHEN v.kind = 'team' AND v.slug = 'general' THEN 0
         WHEN v.kind = 'announce' THEN 1
         WHEN v.kind = 'subteam' THEN 2
         WHEN v.kind = 'team' THEN 3
         ELSE 4
       END,
       (v.archived_at IS NOT NULL),
       CASE WHEN v.kind = 'dm' THEN NULL ELSE lower(v.title) END,
       COALESCE(lm.created_at, v.updated_at) DESC`,
    [orgId, userId],
  );

  return rows.rows.map((row) => {
    const isMember = Boolean(row.isMember);
    const unreadCount = Math.max(0, Number(row.unreadCount) || 0);
    return {
      ...row,
      isMember,
      unreadCount,
      canPost: canPostToChannel({
        kind: row.kind,
        archived: Boolean(row.archivedAt),
        isMember,
        canAnnounce: options.canAnnounce,
      }).ok,
    };
  });
}

export type ConversationMeta = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  slug: string | null;
  archivedAt: string | null;
  createdBy: string | null;
};

export async function conversationMeta(
  client: PoolClient,
  orgId: string,
  conversationId: string,
): Promise<ConversationMeta | null> {
  const channelsSupported = await supportsChannels(client);
  const row = channelsSupported
    ? await client.query<ConversationMeta>(
        `SELECT id, kind, title, slug, archived_at::text AS "archivedAt", created_by AS "createdBy"
         FROM org_conversations WHERE id = $1::uuid AND org_id = $2::uuid`,
        [conversationId, orgId],
      )
    : await client.query<ConversationMeta>(
        `SELECT id, kind, title,
                CASE WHEN kind = 'team' AND lower(title) = 'team' THEN 'general' ELSE NULL END AS slug,
                NULL::text AS "archivedAt", created_by AS "createdBy"
         FROM org_conversations WHERE id = $1::uuid AND org_id = $2::uuid`,
        [conversationId, orgId],
      );
  return row.rows[0] ?? null;
}

export async function channelMembership(
  client: PoolClient,
  conversationId: string,
  userId: string,
): Promise<{ member: boolean; role: string | null }> {
  if (!(await supportsChannels(client))) return { member: true, role: null };
  const row = await client.query<{ role: string }>(
    `SELECT role FROM org_conversation_members WHERE conversation_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [conversationId, userId],
  );
  return { member: Boolean(row.rowCount), role: row.rows[0]?.role ?? null };
}

/**
 * Move the caller's read cursor to now. Channels write org_conversation_members; #general and
 * other open channels auto-join on first read so the badge logic never sees a missing row.
 */
export async function markConversationRead(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversation: ConversationMeta,
): Promise<void> {
  const channelsSupported = await supportsChannels(client);
  if (conversation.kind !== "dm" && channelsSupported) {
    const updated = await client.query(
      `UPDATE org_conversation_members SET last_read_at = now()
       WHERE conversation_id = $1::uuid AND user_id = $2::uuid`,
      [conversation.id, userId],
    );
    if (!updated.rowCount && conversation.kind === "team") {
      await client.query(
        `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role, last_read_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'member', now())
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now()`,
        [orgId, conversation.id, userId],
      );
    }
    return;
  }

  await client.query(
    `INSERT INTO org_conversation_participants (conversation_id, user_id, last_read_at)
     SELECT $1, $2, now()
     WHERE EXISTS (SELECT 1 FROM org_conversations c WHERE c.id = $1 AND c.kind <> 'dm')
        OR EXISTS (
          SELECT 1 FROM org_conversation_participants p
          WHERE p.conversation_id = $1 AND p.user_id = $2
        )
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_at = now()`,
    [conversation.id, userId],
  );
}

/** Join an open/announce/subteam channel; #general and open channels also auto-join on send. */
export async function joinChannel(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
): Promise<{ ok: true }> {
  if (!(await supportsChannels(client))) throw new Error(CHANNELS_MIGRATION_HINT);
  const meta = await conversationMeta(client, orgId, conversationId);
  if (!meta || meta.kind === "dm") throw new Error("Channel not found");
  if (meta.archivedAt) throw new Error("This channel is archived");
  await client.query(
    `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'member')
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [orgId, conversationId, userId],
  );
  return { ok: true };
}

export async function leaveChannel(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
): Promise<{ ok: true }> {
  if (!(await supportsChannels(client))) throw new Error(CHANNELS_MIGRATION_HINT);
  const meta = await conversationMeta(client, orgId, conversationId);
  if (!meta) throw new Error("Channel not found");
  const gate = canLeaveChannel({ kind: meta.kind, slug: meta.slug });
  if (!gate.ok) throw new Error(gate.reason);
  await client.query(
    `DELETE FROM org_conversation_members WHERE conversation_id = $1::uuid AND user_id = $2::uuid`,
    [conversationId, userId],
  );
  return { ok: true };
}

export async function listSubteams(client: PoolClient, orgId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const rows = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM team_subteams WHERE org_id = $1::uuid ORDER BY sort_order, lower(name)`,
      [orgId],
    );
    return rows.rows;
  } catch {
    return [];
  }
}

export async function createChannel(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: unknown;
    kind: unknown;
    subteamId?: unknown;
    description?: unknown;
  },
): Promise<{ conversationId: string; slug: string }> {
  if (!(await supportsChannels(client))) throw new Error(CHANNELS_MIGRATION_HINT);
  if (!(await canAnnounceFor(client, input.orgId, input.userId))) {
    throw new Error("Only mentors and team admins can create channels");
  }

  const title = normalizeChannelTitle(input.title);
  const description = normalizeChannelDescription(input.description);
  let kind: ChannelKind = normalizeChannelKind(input.kind);
  const rawSubteam = typeof input.subteamId === "string" ? input.subteamId.trim() : "";
  let subteamId: string | null = null;
  if (rawSubteam && kind !== "announce") {
    if (!UUID_RE.test(rawSubteam)) throw new Error("Choose a valid subteam");
    const subteam = await client.query(
      `SELECT 1 FROM team_subteams WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [rawSubteam, input.orgId],
    );
    if (!subteam.rowCount) throw new Error("That subteam is not on this team");
    subteamId = rawSubteam;
    kind = "subteam";
  }

  const duplicate = await client.query(
    `SELECT 1 FROM org_conversations
     WHERE org_id = $1::uuid AND kind <> 'dm' AND lower(title) = lower($2) LIMIT 1`,
    [input.orgId, title],
  );
  if (duplicate.rowCount) throw new Error("A channel with that name already exists");

  const taken = await client.query<{ slug: string }>(
    `SELECT slug FROM org_conversations WHERE org_id = $1::uuid AND slug IS NOT NULL`,
    [input.orgId],
  );
  const slug = uniqueChannelSlug(
    slugifyChannelTitle(title),
    taken.rows.map((row) => row.slug),
  );

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO org_conversations (org_id, kind, title, slug, description, subteam_id, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid)
     RETURNING id`,
    [input.orgId, kind, title, slug, description, subteamId, input.userId],
  );
  const conversationId = inserted.rows[0]!.id;

  await client.query(
    `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'moderator')
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [input.orgId, conversationId, input.userId],
  );

  if (kind === "announce") {
    // Announcements are for everyone: seed the whole org so unread badges work from day one.
    await client.query(
      `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
       SELECT $1::uuid, $2::uuid, m.user_id, 'member'
       FROM memberships m
       WHERE m.org_id = $1::uuid
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [input.orgId, conversationId],
    );
  } else if (subteamId) {
    await client.query(
      `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
       SELECT $1::uuid, $2::uuid, sm.user_id, 'member'
       FROM team_subteam_members sm
       INNER JOIN memberships m ON m.org_id = sm.org_id AND m.user_id = sm.user_id
       WHERE sm.org_id = $1::uuid AND sm.subteam_id = $3::uuid
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [input.orgId, conversationId, subteamId],
    );
  }

  return { conversationId, slug };
}

export async function archiveChannel(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
): Promise<{ ok: true }> {
  if (!(await supportsChannels(client))) throw new Error(CHANNELS_MIGRATION_HINT);
  const meta = await conversationMeta(client, orgId, conversationId);
  if (!meta || meta.kind === "dm") throw new Error("Channel not found");
  if (meta.slug === GENERAL_SLUG) throw new Error("#general cannot be archived");
  const membership = await channelMembership(client, conversationId, userId);
  const canAnnounce = await canAnnounceFor(client, orgId, userId);
  if (!canManageChannel({ canAnnounce, memberRole: membership.role, isCreator: meta.createdBy === userId })) {
    throw new Error("Only mentors, team admins, or the channel's moderators can archive it");
  }
  await client.query(
    `UPDATE org_conversations SET archived_at = COALESCE(archived_at, now()), updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND kind <> 'dm'`,
    [conversationId, orgId],
  );
  return { ok: true };
}

export async function orgHasAnnounceChannel(client: PoolClient, orgId: string): Promise<boolean> {
  if (!(await supportsChannels(client))) return false;
  const row = await client.query(
    `SELECT 1 FROM org_conversations
     WHERE org_id = $1::uuid AND kind = 'announce' AND archived_at IS NULL LIMIT 1`,
    [orgId],
  );
  return Boolean(row.rowCount);
}

export type EditedMessage = {
  id: string;
  body: string;
  editedAt: string | null;
  updatedAt: string;
  changed: boolean;
};

/** Edit your own message; writes the prior body to org_message_revisions first. */
export async function editMessage(
  client: PoolClient,
  input: { orgId: string; userId: string; messageId: string; body: unknown; unlimitedEdit: boolean },
): Promise<EditedMessage> {
  if (!(await supportsChannels(client))) throw new Error(`Editing messages requires migration 0494_chat_channels`);
  const trimmed = typeof input.body === "string" ? input.body.trim() : "";
  if (!trimmed) throw new Error("Message body is required");
  if (trimmed.length > MAX_BODY) throw new Error(`Message must be ${MAX_BODY} characters or fewer`);

  const current = await client.query<{
    id: string;
    body: string;
    createdAt: string;
    authorUserId: string;
    deletedAt: string | null;
    editedAt: string | null;
    updatedAt: string;
    archivedAt: string | null;
  }>(
    `SELECT m.id,
            m.body,
            m.created_at::text AS "createdAt",
            m.author_user_id AS "authorUserId",
            m.deleted_at::text AS "deletedAt",
            m.edited_at::text AS "editedAt",
            COALESCE(m.updated_at, m.created_at)::text AS "updatedAt",
            c.archived_at::text AS "archivedAt"
     FROM org_messages m
     INNER JOIN org_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1::uuid AND m.org_id = $2::uuid`,
    [input.messageId, input.orgId],
  );
  const message = current.rows[0];
  if (!message) throw new Error("Message not found");
  if (message.archivedAt) throw new Error("This channel is archived");

  const gate = canEditMessage({
    authorUserId: message.authorUserId,
    actorUserId: input.userId,
    createdAt: message.createdAt,
    deleted: Boolean(message.deletedAt),
    unlimited: input.unlimitedEdit,
  });
  if (!gate.ok) throw new Error(gate.reason);

  const revision = revisionForEdit(message.body, trimmed);
  if (!revision) {
    return { id: message.id, body: message.body, editedAt: message.editedAt, updatedAt: message.updatedAt, changed: false };
  }

  await client.query(
    `INSERT INTO org_message_revisions (org_id, message_id, prior_body, action, actor_user_id)
     VALUES ($1::uuid, $2::uuid, $3, 'edit', $4::uuid)`,
    [input.orgId, input.messageId, revision.priorBody, input.userId],
  );
  const updated = await client.query<{ id: string; body: string; editedAt: string; updatedAt: string }>(
    `UPDATE org_messages
     SET body = $3, edited_at = now(), updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND author_user_id = $4::uuid AND deleted_at IS NULL
     RETURNING id, body, edited_at::text AS "editedAt", updated_at::text AS "updatedAt"`,
    [input.messageId, input.orgId, trimmed, input.userId],
  );
  if (!updated.rowCount) throw new Error("Could not edit message");
  return { ...updated.rows[0]!, changed: true };
}

/** Deletes keep their body in the revision log: for a safeguarding record, gone is not gone. */
export async function recordDeleteRevision(
  client: PoolClient,
  orgId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  if (!(await supportsChannels(client))) return;
  await client.query(
    `INSERT INTO org_message_revisions (org_id, message_id, prior_body, action, actor_user_id)
     SELECT $1::uuid, m.id, m.body, 'delete', $3::uuid
     FROM org_messages m
     WHERE m.id = $2::uuid AND m.org_id = $1::uuid AND m.author_user_id = $3::uuid AND m.deleted_at IS NULL`,
    [orgId, messageId, userId],
  );
}

/** Add every current org member to the channel's member list (used by announce channels). */
export async function seedOrgMembers(client: PoolClient, orgId: string, conversationId: string): Promise<void> {
  await client.query(
    `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
     SELECT $1::uuid, $2::uuid, m.user_id, 'member'
     FROM memberships m
     WHERE m.org_id = $1::uuid
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [orgId, conversationId],
  );
}
