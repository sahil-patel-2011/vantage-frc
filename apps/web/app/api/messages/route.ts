import { auth, emitNotification, emitNotificationToOrgMembers } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import { type MentionRef, resolveMentionedUserIds } from "../../../lib/messages/mentions";
import { maybeBridgeObjectLinkedMessage } from "../../../lib/messages/discord-bridge";
import { maybeBridgeTeamSlackMessage } from "../../../lib/messages/slack-bridge";
import {
  COMPOSER_OBJECT_TYPES,
  normalizeObjectType,
  objectAppHref,
  parseObjectLinkInput,
  type MessageObjectLink,
} from "../../../lib/messages/object-links";
import { HISTORY_PAGE_SIZE, trimHistoryPage } from "../../../lib/messages/history";
import { clampWaitMs, LONG_POLL_TICK_MS } from "../../../lib/messages/sync";
import {
  canPostToChannel,
  channelLabel,
  GENERAL_SLUG,
  shouldMirrorOutbound,
} from "../../../lib/messages/channels";
import {
  archiveChannel,
  canAnnounceFor,
  channelMembership,
  channelPermissions,
  conversationMeta,
  createChannel,
  editMessage,
  ensureGeneralChannel,
  joinChannel,
  leaveChannel,
  listInbox as listInboxRows,
  listSubteams,
  markConversationRead,
  orgHasAnnounceChannel,
  recordDeleteRevision,
  supportsChannels,
  type ConversationMeta,
  type ConversationRow,
} from "../../../lib/messages/channels-db";
import {
  attachSupervisor,
  dmPartyIds,
  guardDmPair,
  isOrgChatAdmin,
  listSupervisors,
  memberChatClass,
  readDmMode,
  supportsYouthProtection,
  type SupervisorRef,
} from "../../../lib/messages/supervision";
import { supervisionBadge, type DmMode } from "../../../lib/messages/youth-protection";
import { createRateLimiter, rateLimitedResponse } from "../../../lib/rate-limit";

export const maxDuration = 10;

const postLimiter = createRateLimiter({ limit: 60, windowMs: 60_000, namespace: "messages-post" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8000;
const POLL_LIMIT = 100;

type MessageRow = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  authorUserId: string;
  authorName: string;
  deletedAt: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  mine: boolean;
  mentions: MentionRef[];
  objectLink: MessageObjectLink | null;
};

type MemberRow = { id: string; name: string; email: string; role: string };

let pinsSupportedCache: boolean | null = null;
let mentionsSupportedCache: boolean | null = null;
let objectLinksSupportedCache: boolean | null = null;

async function supportsObjectLinks(client: PoolClient): Promise<boolean> {
  if (objectLinksSupportedCache != null) return objectLinksSupportedCache;
  try {
    const row = await client.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'org_message_object_links'
       LIMIT 1`,
    );
    objectLinksSupportedCache = Boolean(row.rowCount);
  } catch {
    objectLinksSupportedCache = false;
  }
  return objectLinksSupportedCache;
}

async function attachObjectLinks(client: PoolClient, orgId: string, messages: MessageRow[]) {
  for (const message of messages) {
    message.objectLink = null;
  }
  if (!messages.length || !(await supportsObjectLinks(client))) return;

  const rows = await client.query<{
    messageId: string;
    objectType: MessageObjectLink["objectType"];
    objectId: string;
    label: string;
    href: string | null;
  }>(
    `SELECT
       message_id AS "messageId",
       object_type AS "objectType",
       object_id AS "objectId",
       label,
       href
     FROM org_message_object_links
     WHERE org_id = $1
       AND message_id = ANY($2::uuid[])
     ORDER BY created_at ASC`,
    [orgId, messages.map((message) => message.id)],
  );
  const byMessage = new Map<string, MessageObjectLink>();
  for (const row of rows.rows) {
    if (byMessage.has(row.messageId)) continue;
    byMessage.set(row.messageId, {
      objectType: row.objectType,
      objectId: row.objectId,
      label: row.label,
      href: row.href,
    });
  }
  for (const message of messages) {
    message.objectLink = byMessage.get(message.id) ?? null;
  }
}

async function enrichObjectLink(
  client: PoolClient,
  orgId: string,
  link: MessageObjectLink,
): Promise<MessageObjectLink> {
  const href = link.href?.trim() || objectAppHref(orgId, link.objectType, link.objectId);
  let label = link.label.trim();

  if (link.objectType === "task") {
    const row = await client.query<{ title: string }>(
      // Tasks live on build_tasks (0502); legacy_id keeps old todo links resolving.
      `SELECT title FROM build_tasks
       WHERE org_id = $2::uuid AND (id = $1::uuid OR legacy_id = $1::uuid)
       ORDER BY (id = $1::uuid) DESC LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked task was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "cad_checkpoint") {
    const row = await client.query<{ title: string }>(
      `SELECT COALESCE(j.title, c.id::text) AS title
       FROM cad_checkpoints c
       INNER JOIN cad_jobs j ON j.id = c.job_id
       WHERE c.id = $1::uuid AND c.org_id = $2::uuid
       LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked CAD checkpoint was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "inventory_item") {
    const row = await client.query<{ name: string }>(
      `SELECT name FROM inventory_items WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked inventory item was not found");
    if (!label) label = row.rows[0]!.name;
  } else if (link.objectType === "event") {
    const row = await client.query<{ title: string }>(
      `SELECT title FROM subteam_calendar_events WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked calendar event was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "announcement") {
    const row = await client.query<{ title: string }>(
      `SELECT title FROM team_announcements WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked announcement was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "goal") {
    const row = await client.query<{ title: string }>(
      `SELECT title FROM season_goals WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked goal was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "risk") {
    const row = await client.query<{ title: string }>(
      `SELECT title FROM risk_register WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked risk was not found");
    if (!label) label = row.rows[0]!.title;
  } else if (link.objectType === "knowledge") {
    const row = await client.query<{ title: string }>(
      `SELECT COALESCE(title, 'Knowledge') AS title FROM team_knowledge WHERE org_id = $1::uuid LIMIT 1`,
      [orgId],
    );
    if (!row.rowCount) throw new Error("Linked knowledge doc was not found");
    if (!label) label = row.rows[0]!.title;
  }

  if (!label) throw new Error("Object link label is required");
  return { ...link, label, href };
}

type LinkTargetRow = MessageObjectLink & { subtitle?: string | null };

async function listLinkTargets(
  client: PoolClient,
  orgId: string,
  objectType: MessageObjectLink["objectType"],
  query: string,
): Promise<LinkTargetRow[]> {
  const q = query.trim().toLowerCase();
  const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : "%";
  const limit = 24;

  if (objectType === "task") {
    const rows = await client
      .query<{ id: string; title: string; status: string }>(
        `SELECT id::text, title, status
         FROM build_tasks
         WHERE org_id = $1::uuid
           AND status <> 'archived'
           AND lower(title) LIKE lower($2)
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string; status: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
      subtitle: row.status,
    }));
  }

  if (objectType === "cad_checkpoint") {
    const rows = await client
      .query<{ id: string; title: string }>(
        `SELECT c.id::text, COALESCE(j.title, c.id::text) AS title
         FROM cad_checkpoints c
         INNER JOIN cad_jobs j ON j.id = c.job_id
         WHERE c.org_id = $1::uuid
           AND lower(COALESCE(j.title, c.id::text)) LIKE lower($2)
         ORDER BY c.created_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
    }));
  }

  if (objectType === "inventory_item") {
    const rows = await client
      .query<{ id: string; name: string; category: string | null }>(
        `SELECT id::text, name, category
         FROM inventory_items
         WHERE org_id = $1::uuid
           AND archived = false
           AND lower(name) LIKE lower($2)
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; name: string; category: string | null }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.name,
      href: objectAppHref(orgId, objectType, row.id),
      subtitle: row.category,
    }));
  }

  if (objectType === "event") {
    const rows = await client
      .query<{ id: string; title: string; kind: string }>(
        `SELECT id::text, title, kind
         FROM subteam_calendar_events
         WHERE org_id = $1::uuid
           AND lower(title) LIKE lower($2)
         ORDER BY starts_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string; kind: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
      subtitle: row.kind,
    }));
  }

  if (objectType === "announcement") {
    const rows = await client
      .query<{ id: string; title: string }>(
        `SELECT id::text, title
         FROM team_announcements
         WHERE org_id = $1::uuid
           AND lower(title) LIKE lower($2)
         ORDER BY created_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
    }));
  }

  return [];
}

async function supportsMessageMentions(client: PoolClient): Promise<boolean> {
  if (mentionsSupportedCache != null) return mentionsSupportedCache;
  try {
    const row = await client.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'org_message_mentions'
       LIMIT 1`,
    );
    mentionsSupportedCache = Boolean(row.rowCount);
  } catch {
    mentionsSupportedCache = false;
  }
  return mentionsSupportedCache;
}

async function supportsMessagePins(client: PoolClient): Promise<boolean> {
  if (pinsSupportedCache != null) return pinsSupportedCache;
  try {
    const row = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'org_messages'
         AND column_name = 'pinned_at'
       LIMIT 1`,
    );
    pinsSupportedCache = Boolean(row.rowCount);
  } catch {
    pinsSupportedCache = false;
  }
  return pinsSupportedCache;
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [
    orgId,
    userId,
  ]);
  if (!row.rowCount) throw new Error("Organization membership required");
}

function fail(error: unknown, status = 400) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Messages request failed" },
    { status },
  );
}

function dmKeyFor(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeClaimedMentionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!UUID_RE.test(trimmed)) continue;
    if (!ids.includes(trimmed)) ids.push(trimmed);
  }
  return ids;
}

async function attachMentions(client: PoolClient, orgId: string, messages: MessageRow[]) {
  if (!messages.length) return;
  for (const message of messages) {
    message.mentions = [];
  }
  const rows = await client.query<{ messageId: string; userId: string; name: string }>(
    `SELECT
       mm.message_id AS "messageId",
       mm.mentioned_user_id AS "userId",
       COALESCE(u.name, 'Member') AS name
     FROM org_message_mentions mm
     INNER JOIN users u ON u.id = mm.mentioned_user_id
     WHERE mm.org_id = $1
       AND mm.message_id = ANY($2::uuid[])
     ORDER BY mm.created_at ASC, lower(u.name)`,
    [orgId, messages.map((message) => message.id)],
  );
  const byMessage = new Map<string, MentionRef[]>();
  for (const row of rows.rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ userId: row.userId, name: row.name });
    byMessage.set(row.messageId, list);
  }
  for (const message of messages) {
    message.mentions = byMessage.get(message.id) ?? [];
  }
}

/** Inbox with the caller's announce permission resolved once (it gates `canPost` per channel). */
async function listInbox(client: PoolClient, orgId: string, userId: string): Promise<ConversationRow[]> {
  const [supervisionSupported, canAnnounce] = await Promise.all([
    supportsYouthProtection(client),
    canAnnounceFor(client, orgId, userId),
  ]);
  return listInboxRows(client, orgId, userId, { supervisionSupported, canAnnounce });
}

async function unreadTotal(client: PoolClient, orgId: string, userId: string): Promise<number> {
  const inbox = await listInbox(client, orgId, userId);
  return inbox.reduce((sum, item) => sum + item.unreadCount, 0);
}

async function listMembers(client: PoolClient, orgId: string, userId: string): Promise<MemberRow[]> {
  const rows = await client.query<MemberRow>(
    `SELECT u.id, u.name, u.email, m.role::text AS role
     FROM memberships m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND m.user_id <> $2
     ORDER BY lower(u.name), lower(u.email)`,
    [orgId, userId],
  );
  return rows.rows;
}

async function hasThreadUpdates(
  client: PoolClient,
  orgId: string,
  conversationId: string,
  since: string | null,
  pinsSupported: boolean,
): Promise<boolean> {
  if (!since) return true;
  const rows = pinsSupported
    ? await client.query(
        `SELECT 1 FROM org_messages
         WHERE conversation_id = $1 AND org_id = $2
           AND COALESCE(updated_at, created_at) > $3::timestamptz
         LIMIT 1`,
        [conversationId, orgId, since],
      )
    : await client.query(
        `SELECT 1 FROM org_messages
         WHERE conversation_id = $1 AND org_id = $2
           AND (
             created_at > $3::timestamptz
             OR (deleted_at IS NOT NULL AND deleted_at > $3::timestamptz)
           )
         LIMIT 1`,
        [conversationId, orgId, since],
      );
  return Boolean(rows.rowCount);
}

/**
 * Anything new in ANOTHER conversation the caller can see (RLS trims DMs)? Lets the rail badges
 * move while the active thread is quiet. `inboxSince` is the client's newest lastMessageAt, so a
 * deleted message can never keep this true forever.
 */
async function hasInboxUpdates(
  client: PoolClient,
  orgId: string,
  conversationId: string,
  inboxSince: string | null,
): Promise<boolean> {
  if (!inboxSince) return false;
  const rows = await client.query(
    `SELECT 1 FROM org_messages
     WHERE org_id = $1::uuid
       AND conversation_id <> $2::uuid
       AND deleted_at IS NULL
       AND created_at > $3::timestamptz
     LIMIT 1`,
    [orgId, conversationId, inboxSince],
  );
  return Boolean(rows.rowCount);
}

async function listMessages(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
  since?: string | null,
  options?: { markRead?: boolean; before?: { createdAt: string; id: string | null } | null },
): Promise<{
  meta: ConversationMeta;
  messages: MessageRow[];
  pinned: MessageRow[];
  hasEarlier: boolean;
  pinsSupported: boolean;
  mentionsSupported: boolean;
  supervisors: SupervisorRef[];
  supervisionNotice: string;
}> {
  const meta = await conversationMeta(client, orgId, conversationId);
  if (!meta) throw new Error("Conversation not found");

  const pinsSupported = await supportsMessagePins(client);
  const mentionsSupported = await supportsMessageMentions(client);
  const channelsSupported = await supportsChannels(client);
  const before = since ? null : (options?.before ?? null);

  // Column fragments differ by which migrations have run; the row shape never does.
  const updatedCol = pinsSupported ? `COALESCE(m.updated_at, m.created_at)` : `COALESCE(m.deleted_at, m.created_at)`;
  const editedCol = channelsSupported ? `m.edited_at::text` : `NULL::text`;
  const pinnedAtCol = pinsSupported ? `m.pinned_at::text` : `NULL::text`;
  const pinnedByCol = pinsSupported ? `m.pinned_by` : `NULL::uuid`;
  const selectCols = `
             m.id,
             CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
             m.created_at::text AS "createdAt",
             ${updatedCol}::text AS "updatedAt",
             ${editedCol} AS "editedAt",
             m.author_user_id AS "authorUserId",
             COALESCE(u.name, 'Member') AS "authorName",
             m.deleted_at::text AS "deletedAt",
             ${pinnedAtCol} AS "pinnedAt",
             ${pinnedByCol} AS "pinnedBy",
             (m.author_user_id = $3) AS mine`;

  let messageList: MessageRow[];
  let hasEarlier = false;

  if (since) {
    // Incremental poll: everything changed after the client's watermark.
    const changedPredicate = pinsSupported
      ? `COALESCE(m.updated_at, m.created_at) > $4::timestamptz`
      : `(m.created_at > $4::timestamptz OR (m.deleted_at IS NOT NULL AND m.deleted_at > $4::timestamptz))`;
    const messages = await client.query<MessageRow>(
      `SELECT ${selectCols}
       FROM org_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.conversation_id = $1
         AND m.org_id = $2
         AND ${changedPredicate}
       ORDER BY m.created_at ASC
       LIMIT ${POLL_LIMIT}`,
      [conversationId, orgId, userId, since],
    );
    messageList = messages.rows;
  } else {
    // Initial load or a "Show earlier messages" page: fetch the NEWEST rows
    // before the cursor (page size + 1 sentinel), then reverse for display.
    // Without this an active conversation opened at its oldest 100 messages.
    const rows = await client.query<MessageRow>(
      `SELECT ${selectCols}
       FROM org_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.conversation_id = $1
         AND m.org_id = $2
         AND (
           $4::timestamptz IS NULL
           OR (m.created_at, m.id) < ($4::timestamptz, COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
         )
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${HISTORY_PAGE_SIZE + 1}`,
      [conversationId, orgId, userId, before?.createdAt ?? null, before?.id ?? null],
    );
    const page = trimHistoryPage(rows.rows, HISTORY_PAGE_SIZE);
    messageList = page.messages;
    hasEarlier = page.hasEarlier;
  }

  const pinned =
    !since && !before && pinsSupported
      ? (
          await client.query<MessageRow>(
            `SELECT
               m.id,
               m.body,
               m.created_at::text AS "createdAt",
               COALESCE(m.updated_at, m.created_at)::text AS "updatedAt",
               ${editedCol} AS "editedAt",
               m.author_user_id AS "authorUserId",
               COALESCE(u.name, 'Member') AS "authorName",
               m.deleted_at::text AS "deletedAt",
               m.pinned_at::text AS "pinnedAt",
               m.pinned_by AS "pinnedBy",
               (m.author_user_id = $3) AS mine
             FROM org_messages m
             LEFT JOIN users u ON u.id = m.author_user_id
             WHERE m.conversation_id = $1
               AND m.org_id = $2
               AND m.deleted_at IS NULL
               AND m.pinned_at IS NOT NULL
             ORDER BY m.pinned_at DESC
             LIMIT 12`,
            [conversationId, orgId, userId],
          )
        ).rows
      : [];

  if (mentionsSupported) {
    await attachMentions(client, orgId, [...messageList, ...pinned]);
  } else {
    for (const message of [...messageList, ...pinned]) {
      message.mentions = [];
    }
  }
  await attachObjectLinks(client, orgId, [...messageList, ...pinned]);

  if (options?.markRead !== false) {
    await markConversationRead(client, orgId, userId, meta);

    if (meta.kind === "dm") {
      await client.query(
        `UPDATE notifications
         SET read_at = now()
         WHERE user_id = $1
           AND org_id = $2
           AND type = 'direct_message'
           AND read_at IS NULL
           AND payload->>'conversationId' = $3`,
        [userId, orgId, conversationId],
      );
    } else {
      await client.query(
        `UPDATE notifications
         SET read_at = now()
         WHERE user_id = $1
           AND org_id = $2
           AND type IN ('message_mention', 'team_chat')
           AND read_at IS NULL
           AND payload->>'conversationId' = $3`,
        [userId, orgId, conversationId],
      );
    }
  }

  // Both parties always see who else is in the room and why. This is not dismissible in the UI.
  const supervisors = meta.kind === "dm" ? await listSupervisors(client, conversationId) : [];

  return {
    meta,
    messages: messageList,
    pinned,
    hasEarlier,
    pinsSupported,
    mentionsSupported,
    supervisors,
    supervisionNotice: supervisionBadge(supervisors.map((item) => item.name)),
  };
}

async function openDm(client: PoolClient, orgId: string, userId: string, peerUserId: string) {
  if (peerUserId === userId) throw new Error("Cannot message yourself");

  const peer = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, peerUserId],
  );
  if (!peer.rowCount) throw new Error("Peer must be an organization member");

  const key = dmKeyFor(userId, peerUserId);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM org_conversations WHERE org_id = $1 AND kind = 'dm' AND dm_key = $2 LIMIT 1`,
    [orgId, key],
  );

  // Youth-protection gate. Runs BEFORE the conversation exists (and again on re-open, so a policy
  // tightened after the fact is applied to threads created under the old one) and throws a message
  // that names the org policy, which the caller surfaces verbatim.
  const guard = await guardDmPair(client, {
    orgId,
    actorUserId: userId,
    peerUserId,
    conversationId: existing.rows[0]?.id ?? null,
  });

  if (existing.rowCount) {
    const existingId = existing.rows[0]!.id;
    if (guard.supervisor) {
      await attachSupervisor(client, {
        orgId,
        conversationId: existingId,
        supervisorUserId: guard.supervisor.userId,
        reason: "ypp_two_adult_rule_backfill",
      });
    }
    return existingId;
  }

  let conversationId: string | undefined;
  await client.query("SAVEPOINT open_dm");
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO org_conversations (org_id, kind, title, dm_key, created_by)
       VALUES ($1, 'dm', NULL, $2, $3)
       RETURNING id`,
      [orgId, key, userId],
    );
    conversationId = inserted.rows[0]?.id;
    await client.query("RELEASE SAVEPOINT open_dm");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT open_dm");
    const again = await client.query<{ id: string }>(
      `SELECT id FROM org_conversations WHERE org_id = $1 AND kind = 'dm' AND dm_key = $2 LIMIT 1`,
      [orgId, key],
    );
    conversationId = again.rows[0]?.id;
  }
  if (!conversationId) throw new Error("Could not open private conversation");

  await client.query(
    `INSERT INTO org_conversation_participants (conversation_id, user_id)
     VALUES ($1, $2), ($1, $3)
     ON CONFLICT DO NOTHING`,
    [conversationId, userId, peerUserId],
  );

  if (guard.supervisor) {
    await attachSupervisor(client, {
      orgId,
      conversationId,
      supervisorUserId: guard.supervisor.userId,
    });
  }

  return conversationId;
}

/**
 * Re-check the youth-protection rule on the send path. Holding a conversationId from before a
 * policy change must not be a way around it, so the rule is enforced where messages are written,
 * not only where conversations are created.
 */
async function guardDmSend(client: PoolClient, orgId: string, userId: string, conversationId: string) {
  if (!(await supportsYouthProtection(client))) return;
  const parties = await dmPartyIds(client, conversationId);
  if (parties.length < 2) return;
  // The rule is about the PAIR, not the sender: a supervisor writing into the room is still
  // evaluated against the two people whose conversation it is.
  const actorIsParty = parties.includes(userId);
  const actorSide = actorIsParty ? userId : parties[0]!;
  const peerUserId = actorIsParty ? parties.find((id) => id !== userId)! : parties[1]!;
  const guard = await guardDmPair(client, {
    orgId,
    actorUserId: actorSide,
    peerUserId,
    conversationId,
  });
  if (guard.supervisor) {
    await attachSupervisor(client, {
      orgId,
      conversationId,
      supervisorUserId: guard.supervisor.userId,
      reason: "ypp_two_adult_rule_backfill",
    });
  }
}

async function sendMessage(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
  body: string,
  claimedMentionIds: string[] = [],
  objectLink: MessageObjectLink | null = null,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message body is required");
  if (trimmed.length > MAX_BODY) throw new Error(`Message must be ${MAX_BODY} characters or fewer`);

  const meta = await conversationMeta(client, orgId, conversationId);
  if (!meta) throw new Error("Conversation not found");

  const kind = meta.kind;
  const channelsSupported = await supportsChannels(client);
  if (kind === "dm") {
    await guardDmSend(client, orgId, userId, conversationId);
  } else {
    // Channel gate, enforced here AND by the org_messages_channel_guard trigger (0494).
    const [membership, canAnnounce] = await Promise.all([
      channelMembership(client, conversationId, userId),
      canAnnounceFor(client, orgId, userId),
    ]);
    const gate = canPostToChannel({
      kind,
      archived: Boolean(meta.archivedAt),
      isMember: membership.member,
      canAnnounce,
    });
    if (!gate.ok) throw new Error(gate.reason);
    if (channelsSupported && !membership.member) {
      // #general / open channels / announce (for an announcer) auto-join on first post.
      await client.query(
        `INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'member')
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [orgId, conversationId, userId],
      );
    }
  }
  const mentionsSupported = await supportsMessageMentions(client);

  if (objectLink && kind === "dm") {
    throw new Error("Object links are only supported in team channels");
  }
  if (objectLink) {
    const linksTable = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'org_message_object_links' LIMIT 1`,
    );
    if (!linksTable.rowCount) {
      throw new Error("Object-linked messages require migration 0164_team_discord_object_links");
    }
    objectLink = await enrichObjectLink(client, orgId, objectLink);
  }

  const inserted = await client.query<{ id: string; createdAt: string; updatedAt: string }>(
    `INSERT INTO org_messages (conversation_id, org_id, author_user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at::text AS "createdAt", COALESCE(updated_at, created_at)::text AS "updatedAt"`,
    [conversationId, orgId, userId, trimmed],
  );

  await client.query(`UPDATE org_conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  await markConversationRead(client, orgId, userId, meta);

  const messageId = inserted.rows[0]!.id;

  if (objectLink) {
    await client.query(
      `INSERT INTO org_message_object_links (message_id, org_id, object_type, object_id, label, href)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [messageId, orgId, objectLink.objectType, objectLink.objectId, objectLink.label, objectLink.href ?? null],
    );
  }

  if (kind === "dm") {
    const peers = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM org_conversation_participants
       WHERE conversation_id = $1 AND user_id <> $2`,
      [conversationId, userId],
    );
    const author = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    for (const peer of peers.rows) {
      await emitNotification(client, {
        userId: peer.userId,
        orgId,
        type: "direct_message",
        payload: {
          conversationId,
          preview: trimmed.slice(0, 120),
          fromUserId: userId,
          fromName: author.rows[0]?.name ?? "Teammate",
        },
      });
    }
  } else {
    const members = await client.query<{ id: string; name: string; email: string }>(
      `SELECT u.id, u.name, u.email
       FROM memberships m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1`,
      [orgId],
    );
    const mentionedIds = mentionsSupported
      ? resolveMentionedUserIds(trimmed, members.rows, claimedMentionIds, userId)
      : [];
    if (mentionedIds.length) {
      await client.query(
        `INSERT INTO org_message_mentions (message_id, org_id, mentioned_user_id)
         SELECT $1::uuid, $2::uuid, unnest($3::uuid[])
         ON CONFLICT DO NOTHING`,
        [messageId, orgId, mentionedIds],
      );
    }

    const author = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    const fromName = author.rows[0]?.name ?? "Teammate";
    const preview = trimmed.slice(0, 120);
    const href = `/team?tab=messages&orgId=${encodeURIComponent(orgId)}&conversationId=${encodeURIComponent(conversationId)}`;
    const isGeneral = kind === "team" && (meta.slug === GENERAL_SLUG || !meta.slug);
    const label = channelLabel({ kind, slug: meta.slug, title: meta.title });
    // Subteam channels notify their members; #general and announcements reach the whole org.
    const audienceConversationId = channelsSupported && kind === "subteam" ? conversationId : null;

    // Two statements for the whole team instead of two queries per member (0494 adds the
    // SECURITY DEFINER audience function so a teammate's opt-out is finally honoured).
    await emitNotificationToOrgMembers(client, {
      orgId,
      type: "message_mention",
      onlyUserIds: mentionedIds,
      excludeUserIds: [userId],
      payload: {
        conversationId,
        messageId,
        preview,
        fromUserId: userId,
        fromName,
        title: isGeneral ? "You were mentioned in Team chat" : `You were mentioned in ${label}`,
        body: `${fromName} mentioned you: ${preview}`,
        href,
      },
    });
    await emitNotificationToOrgMembers(client, {
      orgId,
      type: "team_chat",
      excludeUserIds: [userId, ...mentionedIds],
      conversationId: audienceConversationId,
      payload: {
        conversationId,
        messageId,
        preview,
        fromUserId: userId,
        fromName,
        title: isGeneral ? "New team chat message" : `New message in ${label}`,
        body: `${fromName}: ${preview}`,
        href,
      },
    });

    // Outbound bridges carry announcement channels; #general only until the team has one.
    const mirror = shouldMirrorOutbound({
      kind,
      slug: meta.slug ?? (isGeneral ? GENERAL_SLUG : null),
      orgHasAnnounceChannel: await orgHasAnnounceChannel(client, orgId),
    });
    if (mirror) {
      await maybeBridgeTeamSlackMessage(client, {
        orgId,
        userId,
        messageId,
        conversationId,
        body: trimmed,
      });
      if (objectLink) {
        await maybeBridgeObjectLinkedMessage(client, {
          orgId,
          userId,
          messageId,
          conversationId,
          body: trimmed,
          objectLink,
        });
      }
    }
  }

  return { ...inserted.rows[0]!, editedAt: null, objectLink };
}

async function setPinned(
  client: PoolClient,
  orgId: string,
  userId: string,
  messageId: string,
  pinned: boolean,
) {
  if (!(await supportsMessagePins(client))) {
    throw new Error("Pinned notes require migration 0045_org_message_pins");
  }

  const row = await client.query<{ id: string; kind: ConversationMeta["kind"] }>(
    `SELECT m.id, c.kind
     FROM org_messages m
     INNER JOIN org_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND m.org_id = $2 AND m.deleted_at IS NULL`,
    [messageId, orgId],
  );
  if (!row.rowCount) throw new Error("Message not found");
  if (row.rows[0]!.kind === "dm") throw new Error("Only channel messages can be pinned");

  if (pinned) {
    const updated = await client.query(
      `UPDATE org_messages
       SET pinned_at = now(), pinned_by = $3, updated_at = now()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [messageId, orgId, userId],
    );
    if (!updated.rowCount) throw new Error("Could not pin message");
  } else {
    const updated = await client.query(
      `UPDATE org_messages
       SET pinned_at = NULL, pinned_by = NULL, updated_at = now()
       WHERE id = $1 AND org_id = $2
       RETURNING id`,
      [messageId, orgId],
    );
    if (!updated.rowCount) throw new Error("Could not unpin message");
  }

  return { ok: true, pinned };
}

type YouthProtectionState = {
  supported: boolean;
  dmMode: DmMode;
  viewerClass: "adult" | "youth";
  canManage: boolean;
};

async function youthProtectionState(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<YouthProtectionState> {
  const supported = await supportsYouthProtection(client);
  if (!supported) {
    return { supported: false, dmMode: "open", viewerClass: "youth", canManage: false };
  }
  const [dmMode, viewerClass, canManage] = await Promise.all([
    readDmMode(client, orgId),
    memberChatClass(client, orgId, userId),
    isOrgChatAdmin(client, orgId, userId),
  ]);
  return { supported, dmMode, viewerClass, canManage };
}

/** Announce/create permission plus the edit-window class the client needs to draw controls. */
async function viewerChannelState(client: PoolClient, orgId: string, userId: string) {
  const [permissions, youthProtection] = await Promise.all([
    channelPermissions(client, orgId, userId),
    youthProtectionState(client, orgId, userId),
  ]);
  return {
    youthProtection,
    channelPermissions: {
      ...permissions,
      // Mentors and admins may edit at any time; students get the 15-minute window.
      unlimitedEdit: permissions.canAnnounce || youthProtection.canManage || youthProtection.viewerClass === "adult",
    },
  };
}

async function inboxSnapshot(client: PoolClient, orgId: string, userId: string) {
  const conversations = await listInbox(client, orgId, userId);
  const viewer = await viewerChannelState(client, orgId, userId);
  return {
    currentUserId: userId,
    conversations,
    unreadCount: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
    ...viewer,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const mode = url.searchParams.get("mode") ?? "inbox";
    const conversationId = url.searchParams.get("conversationId");
    const since = url.searchParams.get("since");
    const inboxSince = url.searchParams.get("inboxSince");
    const beforeRaw = url.searchParams.get("before");
    const beforeIdRaw = url.searchParams.get("beforeId");
    const before =
      !since && beforeRaw
        ? {
            createdAt: beforeRaw,
            id: beforeIdRaw && UUID_RE.test(beforeIdRaw) ? beforeIdRaw : null,
          }
        : null;
    const waitMs = clampWaitMs(url.searchParams.get("wait"));
    if (!orgId) throw new Error("orgId is required");
    const userId = session.user.id;

    if (conversationId) {
      if (!UUID_RE.test(conversationId)) throw new Error("Conversation not found");

      const readThread = (client: PoolClient) =>
        listMessages(client, orgId, userId, conversationId, since, {
          before,
          // Paging back through history should not rewrite read state; the
          // initial load and incremental polls still mark the thread read.
          markRead: !before,
        });

      const fullRead = async (client: PoolClient) => {
        const thread = await readThread(client);
        const snapshot = await inboxSnapshot(client, orgId, userId);
        const { meta, ...rest } = thread;
        return {
          ...snapshot,
          ...rest,
          conversation: snapshot.conversations.find((item) => item.id === meta.id) ?? null,
        };
      };

      // Long poll. The connection is NOT held while we wait: one short withRls asks "anything
      // new?", the sleep happens outside it, and the full read runs only once there is something
      // to read (or when the deadline passes, in which case the client gets the inbox it needs
      // plus an empty delta). An old client that sends `since` without `wait` skips all of this.
      if (waitMs > 0 && since) {
        const deadline = Date.now() + waitMs;
        const probe = async (client: PoolClient) => {
          const pins = await supportsMessagePins(client);
          if (await hasThreadUpdates(client, orgId, conversationId, since, pins)) return true;
          return hasInboxUpdates(client, orgId, conversationId, inboxSince);
        };

        const initial = await withRls({ userId, orgId }, async (client) => {
          await requireMembership(client, orgId, userId);
          if (await probe(client)) return { changed: true as const, data: await fullRead(client) };
          return { changed: false as const, data: await inboxSnapshot(client, orgId, userId) };
        });
        if (initial.changed) return Response.json(initial.data);

        let changed = false;
        while (Date.now() < deadline) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await sleep(Math.min(LONG_POLL_TICK_MS, remaining));
          changed = await withRls({ userId, orgId }, (client) => probe(client));
          if (changed) break;
        }

        if (changed) {
          const data = await withRls({ userId, orgId }, async (client) => {
            await requireMembership(client, orgId, userId);
            return fullRead(client);
          });
          return Response.json(data);
        }

        // Empty delta. `supervisors`, `pinsSupported` and friends are deliberately absent: the
        // client only applies those keys when present, so nothing already on screen is reset.
        return Response.json({
          ...initial.data,
          conversation: initial.data.conversations.find((item) => item.id === conversationId) ?? null,
          messages: [] as MessageRow[],
          timedOut: true,
        });
      }

      const data = await withRls({ userId, orgId }, async (client) => {
        await requireMembership(client, orgId, userId);
        return fullRead(client);
      });
      return Response.json(data);
    }

    const data = await withRls({ userId, orgId }, async (client) => {
      await requireMembership(client, orgId, userId);

      if (mode === "members") {
        return { members: await listMembers(client, orgId, userId) };
      }

      if (mode === "link_targets") {
        const objectType = normalizeObjectType(url.searchParams.get("linkType"));
        if (!objectType || !COMPOSER_OBJECT_TYPES.includes(objectType)) {
          throw new Error("Unsupported link type");
        }
        const q = url.searchParams.get("q") ?? "";
        return { targets: await listLinkTargets(client, orgId, objectType, q) };
      }

      if (mode === "unread") {
        return { unreadCount: await unreadTotal(client, orgId, userId) };
      }

      if (mode === "channels") {
        const snapshot = await inboxSnapshot(client, orgId, userId);
        return {
          ...snapshot,
          channels: snapshot.conversations.filter((item) => item.kind !== "dm"),
          subteams: await listSubteams(client, orgId),
        };
      }

      const snapshot = await inboxSnapshot(client, orgId, userId);
      return {
        ...snapshot,
        messages: [] as MessageRow[],
        pinned: [] as MessageRow[],
        hasEarlier: false,
        pinsSupported: await supportsMessagePins(client),
        mentionsSupported: await supportsMessageMentions(client),
        conversation: null,
        supervisors: [] as SupervisorRef[],
        supervisionNotice: "",
      };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

type PostAction =
  | "open_dm"
  | "send"
  | "soft_delete"
  | "ensure_team"
  | "pin"
  | "unpin"
  | "edit"
  | "list_channels"
  | "create_channel"
  | "archive_channel"
  | "join_channel"
  | "leave_channel"
  | "mark_read";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!(await postLimiter.allow(session.user.id))) {
      return rateLimitedResponse("Message rate limit reached. Wait a moment and try again.");
    }
    const body = (await request.json()) as {
      orgId?: string;
      action?: PostAction;
      peerUserId?: string;
      conversationId?: string;
      body?: string;
      messageId?: string;
      mentionedUserIds?: unknown;
      objectLink?: unknown;
      title?: unknown;
      kind?: unknown;
      subteamId?: unknown;
      description?: unknown;
    };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const action = body.action ?? "send";
    const userId = session.user.id;

    const data = await withRls({ userId, orgId }, async (client) => {
      await requireMembership(client, orgId, userId);

      if (action === "ensure_team") {
        const conversationId = await ensureGeneralChannel(client, orgId, userId);
        return { conversationId };
      }

      if (action === "open_dm") {
        const peerUserId = String(body.peerUserId ?? "");
        if (!peerUserId) throw new Error("peerUserId is required");
        const conversationId = await openDm(client, orgId, userId, peerUserId);
        return { conversationId };
      }

      if (action === "list_channels") {
        const snapshot = await inboxSnapshot(client, orgId, userId);
        return {
          ...snapshot,
          channels: snapshot.conversations.filter((item) => item.kind !== "dm"),
          subteams: await listSubteams(client, orgId),
        };
      }

      if (action === "create_channel") {
        const created = await createChannel(client, {
          orgId,
          userId,
          title: body.title,
          kind: body.kind,
          subteamId: body.subteamId,
          description: body.description,
        });
        const snapshot = await inboxSnapshot(client, orgId, userId);
        return { ...created, ...snapshot };
      }

      if (action === "archive_channel" || action === "join_channel" || action === "leave_channel" || action === "mark_read") {
        const conversationId = String(body.conversationId ?? "");
        if (!UUID_RE.test(conversationId)) throw new Error("conversationId is required");
        if (action === "archive_channel") await archiveChannel(client, orgId, userId, conversationId);
        if (action === "join_channel") await joinChannel(client, orgId, userId, conversationId);
        if (action === "leave_channel") await leaveChannel(client, orgId, userId, conversationId);
        if (action === "mark_read") {
          const meta = await conversationMeta(client, orgId, conversationId);
          if (!meta) throw new Error("Conversation not found");
          await markConversationRead(client, orgId, userId, meta);
        }
        const snapshot = await inboxSnapshot(client, orgId, userId);
        return { ok: true, ...snapshot };
      }

      if (action === "edit") {
        const messageId = String(body.messageId ?? "");
        if (!UUID_RE.test(messageId)) throw new Error("messageId is required");
        const viewer = await viewerChannelState(client, orgId, userId);
        const message = await editMessage(client, {
          orgId,
          userId,
          messageId,
          body: body.body,
          unlimitedEdit: viewer.channelPermissions.unlimitedEdit,
        });
        return { message };
      }

      if (action === "soft_delete") {
        const messageId = String(body.messageId ?? "");
        if (!messageId) throw new Error("messageId is required");
        const pinsSupported = await supportsMessagePins(client);
        // The body survives in org_message_revisions (0494) before it is blanked here.
        await recordDeleteRevision(client, orgId, userId, messageId);
        const updated = pinsSupported
          ? await client.query(
              `UPDATE org_messages
               SET deleted_at = now(),
                   updated_at = now(),
                   pinned_at = NULL,
                   pinned_by = NULL
               WHERE id = $1 AND org_id = $2 AND author_user_id = $3 AND deleted_at IS NULL
               RETURNING id`,
              [messageId, orgId, userId],
            )
          : await client.query(
              `UPDATE org_messages
               SET deleted_at = now()
               WHERE id = $1 AND org_id = $2 AND author_user_id = $3 AND deleted_at IS NULL
               RETURNING id`,
              [messageId, orgId, userId],
            );
        if (!updated.rowCount) throw new Error("Message not found or already deleted");
        return { ok: true };
      }

      if (action === "pin" || action === "unpin") {
        const messageId = String(body.messageId ?? "");
        if (!messageId) throw new Error("messageId is required");
        return setPinned(client, orgId, userId, messageId, action === "pin");
      }

      const conversationId = String(body.conversationId ?? "");
      if (!conversationId) throw new Error("conversationId is required");
      const objectLink = parseObjectLinkInput(body.objectLink);
      const message = await sendMessage(
        client,
        orgId,
        userId,
        conversationId,
        String(body.body ?? ""),
        normalizeClaimedMentionIds(body.mentionedUserIds),
        objectLink,
      );
      return { message };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}
