/**
 * Team channels for org chat.
 *
 * `org_conversations` already models "many team threads per org" (migration 0032): `kind = 'team'`
 * with a non-empty `title`, unique per org on `lower(title)`. Until now the product only ever
 * created one row called "Team", so this module is the missing service layer rather than a new
 * data model — no new tables, no change to DMs, history paging, youth-protection policy, or the
 * audited DM export.
 *
 * Two things the schema does NOT give us, and how this file handles them:
 *
 * 1. Archive. There is no `archived_at` column, so `supportsChannelArchive` probes for it the same
 *    way pins/mentions/object-links are probed elsewhere in this feature. Archive lights up the
 *    moment the coordinated migration lands and refuses with a clear message until then; nothing
 *    else in channels depends on it.
 * 2. Write authorization. The RLS policies on `org_conversations` let ANY org member insert and
 *    update a team conversation, which would let a student rename or spawn channels. Every mutation
 *    here is gated on owner/admin first. RLS should be tightened to match (see the migration note).
 */

import type { PoolClient } from "@neondatabase/serverless";
import { cachedSchemaSupport } from "../schema-probe";

/**
 * The channel every workspace gets for free. `ensureTeamChannel` in the route finds it by
 * `lower(title) = 'team'`, so renaming or archiving it would silently mint a second one — both are
 * refused below rather than left as a trap.
 */
export const DEFAULT_CHANNEL_TITLE = "Team";

export const MIN_CHANNEL_NAME = 2;
export const MAX_CHANNEL_NAME = 60;

export type ChannelAction = "create" | "rename" | "archive" | "unarchive";

export type ChannelRow = {
  id: string;
  title: string | null;
  archivedAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type Channel = ChannelRow & {
  title: string;
  isDefault: boolean;
  isArchived: boolean;
};

/** Owner/admin hold the channel controls; everyone else reads and posts. */
export function canManageChannels(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Names are compared the way the unique index compares them (`lower(title)`), after the same
 * whitespace collapse `normalizeChannelName` applies, so "Design " and "design" are one channel.
 */
export function sameChannelName(a: string | null | undefined, b: string | null | undefined): boolean {
  return collapse(a ?? "").toLowerCase() === collapse(b ?? "").toLowerCase();
}

export function isDefaultChannelName(title: string | null | undefined): boolean {
  return sameChannelName(title, DEFAULT_CHANNEL_TITLE);
}

function collapse(value: string): string {
  // Strip control characters first so a pasted newline cannot smuggle a second line into a title.
  return value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point here
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate and canonicalize a channel name. Throws with the sentence the member should read.
 * A leading `#` is accepted and dropped so pasting "#design" from Slack/Discord does the obvious
 * thing instead of creating a channel literally named "#design".
 */
export function normalizeChannelName(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const name = collapse(raw.replace(/^#+/, ""));
  if (!name) throw new Error("Give the channel a name");
  if (name.length < MIN_CHANNEL_NAME) {
    throw new Error(`Channel names need at least ${MIN_CHANNEL_NAME} characters`);
  }
  if (name.length > MAX_CHANNEL_NAME) {
    throw new Error(`Keep channel names to ${MAX_CHANNEL_NAME} characters or fewer`);
  }
  if (!/[\p{L}\p{N}]/u.test(name)) {
    throw new Error("Channel names need at least one letter or number");
  }
  return name;
}

/**
 * Gate a channel mutation. Kept separate from the DB helpers so the rules are unit-testable and so
 * callers get the same refusal wording whether the block is role or default-channel protection.
 */
export function assertChannelPermission(
  action: ChannelAction,
  context: { role: string | null | undefined; isDefault?: boolean },
): void {
  if (!canManageChannels(context.role)) {
    const verb =
      action === "create" ? "create channels" : action === "rename" ? "rename a channel" : "archive a channel";
    throw new Error(`Only an owner or admin can ${verb}`);
  }
  if (context.isDefault && action !== "create") {
    throw new Error(
      `The ${DEFAULT_CHANNEL_TITLE} channel is the workspace default and cannot be renamed or archived`,
    );
  }
}

export function decorateChannel(row: ChannelRow): Channel {
  const title = collapse(row.title ?? "") || DEFAULT_CHANNEL_TITLE;
  return {
    ...row,
    title,
    isDefault: isDefaultChannelName(title),
    isArchived: Boolean(row.archivedAt),
  };
}

/**
 * Default channel first (it is where a new member lands), then live channels by most recent
 * activity, then archived ones. Name is the tiebreaker so the order is stable for a quiet team.
 */
export function sortChannels(rows: ChannelRow[]): Channel[] {
  return rows
    .map(decorateChannel)
    .sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      const aAt = a.lastMessageAt ?? "";
      const bAt = b.lastMessageAt ?? "";
      if (aAt !== bAt) return bAt.localeCompare(aAt);
      return a.title.localeCompare(b.title);
    });
}

/** Notification copy names the channel, otherwise every channel reads as "New team chat message". */
export function channelNotificationTitle(channelTitle: string | null | undefined): string {
  const title = collapse(channelTitle ?? "");
  if (!title || isDefaultChannelName(title)) return "New team chat message";
  return `New message in #${title}`;
}

// ---- database side (all reads/writes go through the caller's withRls client) ----

export const CHANNEL_ARCHIVE_MIGRATION = "org_conversations.archived_at (channel archive)";

let archiveSupportedCache: boolean | null = null;

/** Test seam: the capability probe is cached per process like the other chat capability checks. */
export function resetChannelCapabilityCache(): void {
  archiveSupportedCache = null;
}

export async function supportsChannelArchive(client: PoolClient): Promise<boolean> {
  return cachedSchemaSupport(
    client,
    {
      read: () => archiveSupportedCache,
      write: (value) => {
        archiveSupportedCache = value;
      },
    },
    `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'org_conversations'
         AND column_name = 'archived_at'
       LIMIT 1`,
  );
}

export async function memberRole(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const row = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  return row.rows[0]?.role ?? null;
}

/**
 * Channels visible to this member, with their unread counts. Archived channels are excluded unless
 * asked for — their history stays readable, they just leave the working list.
 */
export async function listChannels(
  client: PoolClient,
  orgId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Channel[]> {
  const archiveSupported = await supportsChannelArchive(client);
  const archivedSelect = archiveSupported ? `c.archived_at::text` : `NULL::text`;
  const archivedFilter = archiveSupported && !options.includeArchived ? `AND c.archived_at IS NULL` : "";

  const rows = await client.query<ChannelRow>(
    `SELECT
       c.id,
       c.title,
       ${archivedSelect} AS "archivedAt",
       (
         SELECT max(m.created_at)::text
         FROM org_messages m
         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
       ) AS "lastMessageAt",
       COALESCE((
         SELECT COUNT(*)::int
         FROM org_messages m
         LEFT JOIN org_conversation_participants p
           ON p.conversation_id = c.id AND p.user_id = $2::uuid
         WHERE m.conversation_id = c.id
           AND m.deleted_at IS NULL
           AND m.author_user_id <> $2::uuid
           AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
       ), 0) AS "unreadCount"
     FROM org_conversations c
     WHERE c.org_id = $1::uuid
       AND c.kind = 'team'
       ${archivedFilter}`,
    [orgId, userId],
  );
  return sortChannels(rows.rows);
}

async function findChannelByName(
  client: PoolClient,
  orgId: string,
  title: string,
): Promise<{ id: string; title: string } | null> {
  const row = await client.query<{ id: string; title: string }>(
    `SELECT id, title FROM org_conversations
     WHERE org_id = $1::uuid AND kind = 'team' AND lower(title) = lower($2)
     LIMIT 1`,
    [orgId, title],
  );
  return row.rows[0] ?? null;
}

export async function loadChannel(
  client: PoolClient,
  orgId: string,
  conversationId: string,
): Promise<{ id: string; title: string; archivedAt: string | null } | null> {
  const archiveSupported = await supportsChannelArchive(client);
  const row = await client.query<{ id: string; title: string; archivedAt: string | null }>(
    `SELECT id, title, ${archiveSupported ? "archived_at::text" : "NULL::text"} AS "archivedAt"
     FROM org_conversations
     WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'team'
     LIMIT 1`,
    [conversationId, orgId],
  );
  return row.rows[0] ?? null;
}

export async function createChannel(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; title: unknown },
): Promise<{ conversationId: string; title: string }> {
  const role = await memberRole(client, input.orgId, input.actorUserId);
  assertChannelPermission("create", { role });
  const title = normalizeChannelName(input.title);

  const existing = await findChannelByName(client, input.orgId, title);
  if (existing) throw new Error(`A channel called "${existing.title}" already exists`);

  // The unique index is the real arbiter under concurrency; the savepoint keeps a lost race from
  // aborting the caller's transaction (same shape as ensureTeamChannel/openDm).
  await client.query("SAVEPOINT create_channel");
  try {
    const inserted = await client.query<{ id: string; title: string }>(
      `INSERT INTO org_conversations (org_id, kind, title, created_by)
       VALUES ($1::uuid, 'team', $2, $3::uuid)
       RETURNING id, title`,
      [input.orgId, title, input.actorUserId],
    );
    await client.query("RELEASE SAVEPOINT create_channel");
    return { conversationId: inserted.rows[0]!.id, title: inserted.rows[0]!.title };
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT create_channel");
    const raced = await findChannelByName(client, input.orgId, title);
    if (raced) throw new Error(`A channel called "${raced.title}" already exists`);
    throw new Error("Could not create the channel");
  }
}

export async function renameChannel(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; conversationId: string; title: unknown },
): Promise<{ conversationId: string; title: string }> {
  const role = await memberRole(client, input.orgId, input.actorUserId);
  const channel = await loadChannel(client, input.orgId, input.conversationId);
  if (!channel) throw new Error("Channel not found");
  assertChannelPermission("rename", { role, isDefault: isDefaultChannelName(channel.title) });

  const title = normalizeChannelName(input.title);
  if (isDefaultChannelName(title)) {
    throw new Error(`"${DEFAULT_CHANNEL_TITLE}" is reserved for the workspace default channel`);
  }
  if (sameChannelName(title, channel.title)) return { conversationId: channel.id, title: channel.title };

  const clash = await findChannelByName(client, input.orgId, title);
  if (clash && clash.id !== channel.id) {
    throw new Error(`A channel called "${clash.title}" already exists`);
  }

  await client.query("SAVEPOINT rename_channel");
  try {
    const updated = await client.query<{ id: string; title: string }>(
      `UPDATE org_conversations
       SET title = $3, updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'team'
       RETURNING id, title`,
      [input.conversationId, input.orgId, title],
    );
    await client.query("RELEASE SAVEPOINT rename_channel");
    if (!updated.rowCount) throw new Error("Channel not found");
    return { conversationId: updated.rows[0]!.id, title: updated.rows[0]!.title };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT rename_channel");
    if (error instanceof Error && error.message === "Channel not found") throw error;
    // The unique-title index is the expected failure here; keep the driver error as the cause.
    throw new Error(`A channel called "${title}" already exists`, { cause: error });
  }
}

/**
 * Archive hides a channel from the working list; it never deletes messages, so an archived channel
 * stays readable and exportable. Requires the `archived_at` column — until it exists this refuses
 * loudly instead of pretending to work.
 */
export async function setChannelArchived(
  client: PoolClient,
  input: { orgId: string; actorUserId: string; conversationId: string; archived: boolean },
): Promise<{ conversationId: string; archivedAt: string | null }> {
  if (!(await supportsChannelArchive(client))) {
    throw new Error(`Archiving channels requires migration ${CHANNEL_ARCHIVE_MIGRATION}`);
  }
  const role = await memberRole(client, input.orgId, input.actorUserId);
  const channel = await loadChannel(client, input.orgId, input.conversationId);
  if (!channel) throw new Error("Channel not found");
  assertChannelPermission(input.archived ? "archive" : "unarchive", {
    role,
    isDefault: isDefaultChannelName(channel.title),
  });

  const updated = await client.query<{ id: string; archivedAt: string | null }>(
    `UPDATE org_conversations
     SET archived_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'team'
     RETURNING id, archived_at::text AS "archivedAt"`,
    [input.conversationId, input.orgId, input.archived],
  );
  if (!updated.rowCount) throw new Error("Channel not found");
  return { conversationId: updated.rows[0]!.id, archivedAt: updated.rows[0]!.archivedAt };
}

/** Posting into an archived channel is refused; reading and exporting it is not. */
export async function assertChannelWritable(
  client: PoolClient,
  orgId: string,
  conversationId: string,
): Promise<void> {
  if (!(await supportsChannelArchive(client))) return;
  const channel = await loadChannel(client, orgId, conversationId);
  if (channel?.archivedAt) {
    throw new Error(`#${channel.title} is archived. Reopen it before posting.`);
  }
}
