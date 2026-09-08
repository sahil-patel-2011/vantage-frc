import { auth, emitNotification, emitPreferredNotification } from "@vantage/core";
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
import {
  assertChannelWritable,
  canManageChannels,
  channelNotificationTitle,
  createChannel,
  isDefaultChannelName,
  listChannels,
  memberRole,
  renameChannel,
  setChannelArchived,
  supportsChannelArchive,
} from "../../../lib/messages/channels";
import { clampWaitMs, LONG_POLL_TICK_MS } from "../../../lib/messages/sync";
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
const TEAM_CHANNEL_TITLE = "Team";
const MAX_BODY = 8000;
const POLL_LIMIT = 100;

type ConversationRow = {
  id: string;
  kind: "team" | "dm";
  title: string | null;
  updatedAt: string;
  lastMessageAt: string | null;
  lastBody: string | null;
  peerUserId: string | null;
  peerName: string | null;
  unreadCount: number;
  archivedAt: string | null;
  isDefaultChannel: boolean;
};

type MessageRow = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
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

/**
 * Ask the catalog whether an optional table/column exists, without letting the
 * answer poison anything.
 *
 * These probes are process-lifetime caches. They used to be a bare
 * `try { … } catch { cache = false }`, which had two teeth:
 *
 *  1. The request runs in one `withRls` transaction. If an earlier statement had
 *     already aborted it, the probe failed with 25P02 and the catch cached
 *     `false` — permanently disabling mentions, pins or object links for the
 *     whole server process, for every org, until a restart. A transient failure
 *     in one request turned into a fleet-wide feature outage.
 *  2. Swallowing inside the transaction leaves it aborted for everything after.
 *
 * A savepoint contains the failure, and a failed probe is answered `false` for
 * this request only — never cached. Only a definitive answer is remembered.
 */
async function probeSchemaSupport(client: PoolClient, sql: string): Promise<boolean | null> {
  const savepoint = "messages_schema_probe";
  try {
    await client.query(`SAVEPOINT ${savepoint}`);
  } catch {
    // Not inside a usable transaction; probe directly and still refuse to cache
    // a failure.
    try {
      return Boolean((await client.query(sql)).rowCount);
    } catch {
      return null;
    }
  }
  try {
    const row = await client.query(sql);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return Boolean(row.rowCount);
  } catch {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      // Connection is unusable; withRls will roll the request back.
    }
    return null;
  }
}

async function supportsObjectLinks(client: PoolClient): Promise<boolean> {
  if (objectLinksSupportedCache != null) return objectLinksSupportedCache;
  const supported = await probeSchemaSupport(
    client,
    `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'org_message_object_links'
       LIMIT 1`,
  );
  if (supported == null) return false;
  objectLinksSupportedCache = supported;
  return supported;
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
      `SELECT title FROM team_todos WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
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
      `SELECT title
       FROM knowledge_pages
       WHERE id = $1::uuid AND org_id = $2::uuid
       LIMIT 1`,
      [link.objectId, orgId],
    );
    if (!row.rowCount) throw new Error("Linked knowledge page was not found");
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
         FROM team_todos
         WHERE org_id = $1::uuid
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

  if (objectType === "goal") {
    const rows = await client
      .query<{ id: string; title: string; category: string }>(
        `SELECT id::text, title, category
         FROM season_goals
         WHERE org_id = $1::uuid
           AND lower(title) LIKE lower($2)
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string; category: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
      subtitle: row.category,
    }));
  }

  if (objectType === "risk") {
    const rows = await client
      .query<{ id: string; title: string; status: string }>(
        `SELECT id::text, title, status
         FROM risk_register
         WHERE org_id = $1::uuid
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

  if (objectType === "knowledge") {
    const rows = await client
      .query<{ id: string; title: string; templateKind: string }>(
        `SELECT id::text, title, template_kind AS "templateKind"
         FROM knowledge_pages
         WHERE org_id = $1::uuid
           AND lower(title) LIKE lower($2)
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ${limit}`,
        [orgId, like],
      )
      .catch(() => ({ rows: [] as { id: string; title: string; templateKind: string }[] }));
    return rows.rows.map((row) => ({
      objectType,
      objectId: row.id,
      label: row.title,
      href: objectAppHref(orgId, objectType, row.id),
      subtitle: row.templateKind.replaceAll("_", " "),
    }));
  }

  return [];
}

async function supportsMessageMentions(client: PoolClient): Promise<boolean> {
  if (mentionsSupportedCache != null) return mentionsSupportedCache;
  const supported = await probeSchemaSupport(
    client,
    `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'org_message_mentions'
       LIMIT 1`,
  );
  if (supported == null) return false;
  mentionsSupportedCache = supported;
  return supported;
}

async function supportsMessagePins(client: PoolClient): Promise<boolean> {
  if (pinsSupportedCache != null) return pinsSupportedCache;
  const supported = await probeSchemaSupport(
    client,
    `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'org_messages'
         AND column_name = 'pinned_at'
       LIMIT 1`,
  );
  if (supported == null) return false;
  pinsSupportedCache = supported;
  return supported;
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
  const message = error instanceof Error ? error.message : "Messages request failed";
  // A refused channel mutation is an authorization answer, not a malformed request.
  const resolved =
    status === 400 && /^Only an owner or admin can/.test(message) ? 403 : status;
  return Response.json({ error: message }, { status: resolved });
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

async function ensureTeamChannel(client: PoolClient, orgId: string, userId: string) {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM org_conversations
     WHERE org_id = $1 AND kind = 'team' AND lower(title) = lower($2)
     LIMIT 1`,
    [orgId, TEAM_CHANNEL_TITLE],
  );
  if (existing.rowCount) return existing.rows[0]!.id;

  await client.query("SAVEPOINT ensure_team_channel");
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO org_conversations (org_id, kind, title, created_by)
       VALUES ($1, 'team', $2, $3)
       RETURNING id`,
      [orgId, TEAM_CHANNEL_TITLE, userId],
    );
    await client.query("RELEASE SAVEPOINT ensure_team_channel");
    return inserted.rows[0]!.id;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT ensure_team_channel");
    const again = await client.query<{ id: string }>(
      `SELECT id FROM org_conversations
       WHERE org_id = $1 AND kind = 'team' AND lower(title) = lower($2)
       LIMIT 1`,
      [orgId, TEAM_CHANNEL_TITLE],
    );
    if (!again.rowCount) throw new Error("Could not open team channel");
    return again.rows[0]!.id;
  }
}

async function listInbox(
  client: PoolClient,
  orgId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ConversationRow[]> {
  await ensureTeamChannel(client, orgId, userId);

  // Archived channels keep their history and stay exportable; they just leave the working inbox.
  const archiveSupported = await supportsChannelArchive(client);
  const archivedSelect = archiveSupported ? "c.archived_at" : "NULL::timestamptz";
  const archivedFilter =
    archiveSupported && !options.includeArchived ? "AND (c.kind <> 'team' OR c.archived_at IS NULL)" : "";

  // A supervised DM has three participants, so the peer label has to aggregate rather than join
  // row-per-participant (that would duplicate the conversation in the inbox). Supervisors are
  // excluded from the label: the thread is still "you and Sam", with a supervision banner inside.
  const supervisionSupported = await supportsYouthProtection(client);
  const peersCte = supervisionSupported
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

  const rows = await client.query<ConversationRow>(
    `WITH visible AS (
       SELECT c.id, c.kind, c.title, c.updated_at, ${archivedSelect} AS archived_at
       FROM org_conversations c
       WHERE c.org_id = $1
         AND (
           c.kind = 'team'
           OR EXISTS (
             SELECT 1 FROM org_conversation_participants p
             WHERE p.conversation_id = c.id AND p.user_id = $2
           )
         )
         ${archivedFilter}
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
     reads AS (
       SELECT conversation_id, last_read_at
       FROM org_conversation_participants
       WHERE user_id = $2
     )
     SELECT
       v.id,
       v.kind,
       v.title,
       v.updated_at::text AS "updatedAt",
       lm.created_at::text AS "lastMessageAt",
       CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE NULL END AS "lastBody",
       pe.peer_user_id AS "peerUserId",
       pe.peer_name AS "peerName",
       COALESCE((
         SELECT COUNT(*)::int
         FROM org_messages m
         LEFT JOIN reads r ON r.conversation_id = v.id
         WHERE m.conversation_id = v.id
           AND m.deleted_at IS NULL
           AND m.author_user_id <> $2
           AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
       ), 0) AS "unreadCount",
       v.archived_at::text AS "archivedAt",
       (v.kind = 'team' AND lower(COALESCE(v.title, $3)) = lower($3)) AS "isDefaultChannel"
     FROM visible v
     LEFT JOIN last_msg lm ON lm.conversation_id = v.id
     LEFT JOIN peers pe ON pe.conversation_id = v.id
     ORDER BY
       CASE WHEN v.archived_at IS NOT NULL THEN 2 WHEN v.kind = 'team' THEN 0 ELSE 1 END,
       CASE WHEN v.kind = 'team' AND lower(COALESCE(v.title, $3)) = lower($3) THEN 0 ELSE 1 END,
       COALESCE(lm.created_at, v.updated_at) DESC`,
    [orgId, userId, TEAM_CHANNEL_TITLE],
  );

  return rows.rows;
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

async function listMessages(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
  since?: string | null,
  options?: { markRead?: boolean; before?: { createdAt: string; id: string | null } | null },
): Promise<{
  conversation: ConversationRow | null;
  messages: MessageRow[];
  pinned: MessageRow[];
  hasEarlier: boolean;
  pinsSupported: boolean;
  mentionsSupported: boolean;
  supervisors: SupervisorRef[];
  supervisionNotice: string;
}> {
  const access = await client.query<{ kind: "team" | "dm"; title: string | null }>(
    `SELECT kind, title FROM org_conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId],
  );
  if (!access.rowCount) throw new Error("Conversation not found");

  const pinsSupported = await supportsMessagePins(client);
  const mentionsSupported = await supportsMessageMentions(client);
  const before = since ? null : (options?.before ?? null);

  let messageList: MessageRow[];
  let hasEarlier = false;

  if (since) {
    // Incremental poll: everything changed after the client's watermark.
    const messages = pinsSupported
      ? await client.query<MessageRow>(
          `SELECT
             m.id,
             CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
             m.created_at::text AS "createdAt",
             COALESCE(m.updated_at, m.created_at)::text AS "updatedAt",
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
             AND COALESCE(m.updated_at, m.created_at) > $4::timestamptz
           ORDER BY m.created_at ASC
           LIMIT ${POLL_LIMIT}`,
          [conversationId, orgId, userId, since],
        )
      : await client.query<MessageRow>(
          `SELECT
             m.id,
             CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
             m.created_at::text AS "createdAt",
             COALESCE(m.deleted_at, m.created_at)::text AS "updatedAt",
             m.author_user_id AS "authorUserId",
             COALESCE(u.name, 'Member') AS "authorName",
             m.deleted_at::text AS "deletedAt",
             NULL::text AS "pinnedAt",
             NULL::uuid AS "pinnedBy",
             (m.author_user_id = $3) AS mine
           FROM org_messages m
           LEFT JOIN users u ON u.id = m.author_user_id
           WHERE m.conversation_id = $1
             AND m.org_id = $2
             AND (
               m.created_at > $4::timestamptz
               OR (m.deleted_at IS NOT NULL AND m.deleted_at > $4::timestamptz)
             )
           ORDER BY m.created_at ASC
           LIMIT ${POLL_LIMIT}`,
          [conversationId, orgId, userId, since],
        );
    messageList = messages.rows;
  } else {
    // Initial load or a "Show earlier messages" page: fetch the NEWEST rows
    // before the cursor (page size + 1 sentinel), then reverse for display.
    // Without this an active conversation opened at its oldest 100 messages.
    const rows = pinsSupported
      ? await client.query<MessageRow>(
          `SELECT
             m.id,
             CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
             m.created_at::text AS "createdAt",
             COALESCE(m.updated_at, m.created_at)::text AS "updatedAt",
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
             AND (
               $4::timestamptz IS NULL
               OR (m.created_at, m.id) < ($4::timestamptz, COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
             )
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT ${HISTORY_PAGE_SIZE + 1}`,
          [conversationId, orgId, userId, before?.createdAt ?? null, before?.id ?? null],
        )
      : await client.query<MessageRow>(
          `SELECT
             m.id,
             CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
             m.created_at::text AS "createdAt",
             COALESCE(m.deleted_at, m.created_at)::text AS "updatedAt",
             m.author_user_id AS "authorUserId",
             COALESCE(u.name, 'Member') AS "authorName",
             m.deleted_at::text AS "deletedAt",
             NULL::text AS "pinnedAt",
             NULL::uuid AS "pinnedBy",
             (m.author_user_id = $3) AS mine
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
    await client.query(
      `INSERT INTO org_conversation_participants (conversation_id, user_id, last_read_at)
       SELECT $1, $2, now()
       WHERE EXISTS (SELECT 1 FROM org_conversations c WHERE c.id = $1 AND c.kind = 'team')
          OR EXISTS (
            SELECT 1 FROM org_conversation_participants p
            WHERE p.conversation_id = $1 AND p.user_id = $2
          )
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET last_read_at = now()`,
      [conversationId, userId],
    );

    if (access.rows[0]!.kind === "dm") {
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
    }

    if (access.rows[0]!.kind === "team") {
      await client.query(
        `UPDATE notifications
         SET read_at = now()
         WHERE user_id = $1
           AND org_id = $2
           AND type = 'message_mention'
           AND read_at IS NULL
           AND payload->>'conversationId' = $3`,
        [userId, orgId, conversationId],
      );
    }
  }

  // Archived channels stay readable, so resolve the header row even though the working inbox hides it.
  const inbox = await listInbox(client, orgId, userId, { includeArchived: true });
  const conversation = inbox.find((item) => item.id === conversationId) ?? null;

  // Both parties always see who else is in the room and why. This is not dismissible in the UI.
  const supervisors =
    access.rows[0]!.kind === "dm" ? await listSupervisors(client, conversationId) : [];

  return {
    conversation,
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

  const conversation = await client.query<{ kind: "team" | "dm"; title: string | null }>(
    `SELECT kind, title FROM org_conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId],
  );
  if (!conversation.rowCount) throw new Error("Conversation not found");

  const kind = conversation.rows[0]!.kind;
  const channelTitle = conversation.rows[0]!.title;
  if (kind === "dm") await guardDmSend(client, orgId, userId, conversationId);
  if (kind === "team") await assertChannelWritable(client, orgId, conversationId);
  const mentionsSupported = await supportsMessageMentions(client);

  if (objectLink && kind !== "team") {
    throw new Error("Object links are only supported on the team channel");
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
  await client.query(
    `INSERT INTO org_conversation_participants (conversation_id, user_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_at = now()`,
    [conversationId, userId],
  );

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
  }
  if (kind === "team") {
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
      for (const mentionedUserId of mentionedIds) {
        await client.query(
          `INSERT INTO org_message_mentions (message_id, org_id, mentioned_user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [messageId, orgId, mentionedUserId],
        );
      }
    }

    const author = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
    const fromName = author.rows[0]?.name ?? "Teammate";
    const preview = trimmed.slice(0, 120);
    const href = `/team?tab=messages&orgId=${encodeURIComponent(orgId)}&conversationId=${encodeURIComponent(conversationId)}`;
    const mentioned = new Set(mentionedIds);
    for (const mentionedUserId of mentionedIds) {
      await emitPreferredNotification(client, {
        userId: mentionedUserId,
        orgId,
        type: "message_mention",
        payload: {
          conversationId,
          messageId,
          preview,
          fromUserId: userId,
          fromName,
          title: isDefaultChannelName(channelTitle)
            ? "You were mentioned in Team chat"
            : `You were mentioned in #${channelTitle}`,
          body: `${fromName} mentioned you: ${preview}`,
          href,
        },
      });
    }
    for (const member of members.rows) {
      if (member.id === userId || mentioned.has(member.id)) continue;
      await emitPreferredNotification(client, {
        userId: member.id,
        orgId,
        type: "team_chat",
        payload: {
          conversationId,
          messageId,
          preview,
          fromUserId: userId,
          fromName,
          // Every channel would otherwise arrive as the same undifferentiated line.
          title: channelNotificationTitle(channelTitle),
          body: `${fromName}: ${preview}`,
          href,
        },
      });
    }

    await maybeBridgeTeamSlackMessage(client, {
      orgId,
      userId,
      messageId,
      conversationId,
      body: trimmed,
    });
  }

  if (kind === "team" && objectLink) {
    await maybeBridgeObjectLinkedMessage(client, {
      orgId,
      userId,
      messageId,
      conversationId,
      body: trimmed,
      objectLink,
    });
  }

  return { ...inserted.rows[0]!, objectLink };
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

  const row = await client.query<{ id: string; kind: "team" | "dm" }>(
    `SELECT m.id, c.kind
     FROM org_messages m
     INNER JOIN org_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND m.org_id = $2 AND m.deleted_at IS NULL`,
    [messageId, orgId],
  );
  if (!row.rowCount) throw new Error("Message not found");
  if (row.rows[0]!.kind !== "team") throw new Error("Only team-channel messages can be pinned");

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

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const mode = url.searchParams.get("mode") ?? "inbox";
    const conversationId = url.searchParams.get("conversationId");
    const since = url.searchParams.get("since");
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

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);

      if (mode === "members") {
        return { members: await listMembers(client, orgId, session.user.id) };
      }

      if (mode === "channels") {
        const includeArchived = url.searchParams.get("includeArchived") === "1";
        const [channels, role] = await Promise.all([
          listChannels(client, orgId, session.user.id, { includeArchived }),
          memberRole(client, orgId, session.user.id),
        ]);
        return {
          channels,
          canManageChannels: canManageChannels(role),
          archiveSupported: await supportsChannelArchive(client),
        };
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
        return { unreadCount: await unreadTotal(client, orgId, session.user.id) };
      }

      if (conversationId) {
        const pinsSupported = await supportsMessagePins(client);
        if (waitMs > 0 && since) {
          const deadline = Date.now() + waitMs;
          while (Date.now() < deadline) {
            if (await hasThreadUpdates(client, orgId, conversationId, since, pinsSupported)) break;
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await sleep(Math.min(LONG_POLL_TICK_MS, remaining));
          }
        }

        const thread = await listMessages(client, orgId, session.user.id, conversationId, since, {
          before,
          // Paging back through history should not rewrite read state; the
          // initial load and incremental polls still mark the thread read.
          markRead: !before,
        });
        const conversations = await listInbox(client, orgId, session.user.id);
        const activeArchived = thread.conversation?.archivedAt ? [thread.conversation] : [];
        return {
          currentUserId: session.user.id,
          conversations: [...conversations, ...activeArchived],
          unreadCount: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
          canManageChannels: canManageChannels(await memberRole(client, orgId, session.user.id)),
          channelArchiveSupported: await supportsChannelArchive(client),
          youthProtection: await youthProtectionState(client, orgId, session.user.id),
          ...thread,
        };
      }

      const conversations = await listInbox(client, orgId, session.user.id);
      return {
        currentUserId: session.user.id,
        conversations,
        unreadCount: conversations.reduce((sum, item) => sum + item.unreadCount, 0),
        canManageChannels: canManageChannels(await memberRole(client, orgId, session.user.id)),
        channelArchiveSupported: await supportsChannelArchive(client),
        messages: [] as MessageRow[],
        pinned: [] as MessageRow[],
        pinsSupported: await supportsMessagePins(client),
        mentionsSupported: await supportsMessageMentions(client),
        youthProtection: await youthProtectionState(client, orgId, session.user.id),
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

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!(await postLimiter.allow(session.user.id))) {
      return rateLimitedResponse("Message rate limit reached. Wait a moment and try again.");
    }
    const body = (await request.json()) as {
      orgId?: string;
      action?:
        | "open_dm"
        | "send"
        | "soft_delete"
        | "ensure_team"
        | "pin"
        | "unpin"
        | "create_channel"
        | "rename_channel"
        | "archive_channel"
        | "unarchive_channel";
      peerUserId?: string;
      conversationId?: string;
      body?: string;
      messageId?: string;
      mentionedUserIds?: unknown;
      objectLink?: unknown;
      title?: unknown;
    };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const action = body.action ?? "send";

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);

      if (action === "ensure_team") {
        const conversationId = await ensureTeamChannel(client, orgId, session.user.id);
        return { conversationId };
      }

      // Channel management is owner/admin only. The RLS policies on org_conversations still allow
      // any member to insert/update a team row, so these service guards are the enforcement point
      // until the coordinated migration tightens the policies to match.
      if (action === "create_channel") {
        const created = await createChannel(client, {
          orgId,
          actorUserId: session.user.id,
          title: body.title,
        });
        return { ...created, channels: await listChannels(client, orgId, session.user.id) };
      }

      if (action === "rename_channel") {
        const conversationId = String(body.conversationId ?? "");
        if (!conversationId) throw new Error("conversationId is required");
        const renamed = await renameChannel(client, {
          orgId,
          actorUserId: session.user.id,
          conversationId,
          title: body.title,
        });
        return { ...renamed, channels: await listChannels(client, orgId, session.user.id) };
      }

      if (action === "archive_channel" || action === "unarchive_channel") {
        const conversationId = String(body.conversationId ?? "");
        if (!conversationId) throw new Error("conversationId is required");
        const result = await setChannelArchived(client, {
          orgId,
          actorUserId: session.user.id,
          conversationId,
          archived: action === "archive_channel",
        });
        return { ...result, channels: await listChannels(client, orgId, session.user.id) };
      }

      if (action === "open_dm") {
        const peerUserId = String(body.peerUserId ?? "");
        if (!peerUserId) throw new Error("peerUserId is required");
        const conversationId = await openDm(client, orgId, session.user.id, peerUserId);
        return { conversationId };
      }

      if (action === "soft_delete") {
        const messageId = String(body.messageId ?? "");
        if (!messageId) throw new Error("messageId is required");
        const pinsSupported = await supportsMessagePins(client);
        const updated = pinsSupported
          ? await client.query(
              `UPDATE org_messages
               SET deleted_at = now(),
                   updated_at = now(),
                   pinned_at = NULL,
                   pinned_by = NULL
               WHERE id = $1 AND org_id = $2 AND author_user_id = $3 AND deleted_at IS NULL
               RETURNING id`,
              [messageId, orgId, session.user.id],
            )
          : await client.query(
              `UPDATE org_messages
               SET deleted_at = now()
               WHERE id = $1 AND org_id = $2 AND author_user_id = $3 AND deleted_at IS NULL
               RETURNING id`,
              [messageId, orgId, session.user.id],
            );
        if (!updated.rowCount) throw new Error("Message not found or already deleted");
        return { ok: true };
      }

      if (action === "pin" || action === "unpin") {
        const messageId = String(body.messageId ?? "");
        if (!messageId) throw new Error("messageId is required");
        return setPinned(client, orgId, session.user.id, messageId, action === "pin");
      }

      const conversationId = String(body.conversationId ?? "");
      if (!conversationId) throw new Error("conversationId is required");
      const objectLink = parseObjectLinkInput(body.objectLink);
      const message = await sendMessage(
        client,
        orgId,
        session.user.id,
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
