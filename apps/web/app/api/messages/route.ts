import { auth, emitNotification } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";

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
};

type MessageRow = {
  id: string;
  body: string;
  createdAt: string;
  authorUserId: string;
  authorName: string;
  deletedAt: string | null;
  mine: boolean;
};

type MemberRow = { id: string; name: string; email: string; role: string };

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

async function listInbox(client: PoolClient, orgId: string, userId: string): Promise<ConversationRow[]> {
  await ensureTeamChannel(client, orgId, userId);

  const rows = await client.query<ConversationRow>(
    `WITH visible AS (
       SELECT c.id, c.kind, c.title, c.updated_at
       FROM org_conversations c
       WHERE c.org_id = $1
         AND (
           c.kind = 'team'
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
     peers AS (
       SELECT p.conversation_id, u.id AS peer_user_id, u.name AS peer_name
       FROM org_conversation_participants p
       INNER JOIN users u ON u.id = p.user_id
       INNER JOIN visible v ON v.id = p.conversation_id AND v.kind = 'dm'
       WHERE p.user_id <> $2
     ),
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
       ), 0) AS "unreadCount"
     FROM visible v
     LEFT JOIN last_msg lm ON lm.conversation_id = v.id
     LEFT JOIN peers pe ON pe.conversation_id = v.id
     ORDER BY
       CASE WHEN v.kind = 'team' THEN 0 ELSE 1 END,
       COALESCE(lm.created_at, v.updated_at) DESC`,
    [orgId, userId],
  );

  return rows.rows;
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

async function listMessages(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
  since?: string | null,
): Promise<{ conversation: ConversationRow | null; messages: MessageRow[] }> {
  const access = await client.query<{ kind: "team" | "dm"; title: string | null }>(
    `SELECT kind, title FROM org_conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId],
  );
  if (!access.rowCount) throw new Error("Conversation not found");

  const messages = await client.query<MessageRow>(
    `SELECT
       m.id,
       CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
       m.created_at::text AS "createdAt",
       m.author_user_id AS "authorUserId",
       COALESCE(u.name, 'Member') AS "authorName",
       m.deleted_at::text AS "deletedAt",
       (m.author_user_id = $3) AS mine
     FROM org_messages m
     LEFT JOIN users u ON u.id = m.author_user_id
     WHERE m.conversation_id = $1
       AND m.org_id = $2
       AND ($4::timestamptz IS NULL OR m.created_at > $4::timestamptz)
     ORDER BY m.created_at ASC
     LIMIT ${POLL_LIMIT}`,
    [conversationId, orgId, userId, since || null],
  );

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

  const inbox = await listInbox(client, orgId, userId);
  const conversation = inbox.find((item) => item.id === conversationId) ?? null;

  return { conversation, messages: messages.rows };
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
  if (existing.rowCount) return existing.rows[0]!.id;

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

  return conversationId;
}

async function sendMessage(
  client: PoolClient,
  orgId: string,
  userId: string,
  conversationId: string,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message body is required");
  if (trimmed.length > MAX_BODY) throw new Error(`Message must be ${MAX_BODY} characters or fewer`);

  const conversation = await client.query<{ kind: "team" | "dm" }>(
    `SELECT kind FROM org_conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId],
  );
  if (!conversation.rowCount) throw new Error("Conversation not found");

  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO org_messages (conversation_id, org_id, author_user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at::text AS "createdAt"`,
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

  if (conversation.rows[0]!.kind === "dm") {
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

  return inserted.rows[0]!;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const mode = url.searchParams.get("mode") ?? "inbox";
    const conversationId = url.searchParams.get("conversationId");
    const since = url.searchParams.get("since");
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);

      if (mode === "members") {
        return { members: await listMembers(client, orgId, session.user.id) };
      }

      if (conversationId) {
        const thread = await listMessages(client, orgId, session.user.id, conversationId, since);
        const conversations = await listInbox(client, orgId, session.user.id);
        return {
          currentUserId: session.user.id,
          conversations,
          ...thread,
        };
      }

      const conversations = await listInbox(client, orgId, session.user.id);
      return { currentUserId: session.user.id, conversations, messages: [] as MessageRow[], conversation: null };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      action?: "open_dm" | "send" | "soft_delete" | "ensure_team";
      peerUserId?: string;
      conversationId?: string;
      body?: string;
      messageId?: string;
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

      if (action === "open_dm") {
        const peerUserId = String(body.peerUserId ?? "");
        if (!peerUserId) throw new Error("peerUserId is required");
        const conversationId = await openDm(client, orgId, session.user.id, peerUserId);
        return { conversationId };
      }

      if (action === "soft_delete") {
        const messageId = String(body.messageId ?? "");
        if (!messageId) throw new Error("messageId is required");
        const updated = await client.query(
          `UPDATE org_messages
           SET deleted_at = now()
           WHERE id = $1 AND org_id = $2 AND author_user_id = $3 AND deleted_at IS NULL
           RETURNING id`,
          [messageId, orgId, session.user.id],
        );
        if (!updated.rowCount) throw new Error("Message not found or already deleted");
        return { ok: true };
      }

      const conversationId = String(body.conversationId ?? "");
      if (!conversationId) throw new Error("conversationId is required");
      const message = await sendMessage(client, orgId, session.user.id, conversationId, String(body.body ?? ""));
      return { message };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error, error instanceof Error && error.message.includes("Authentication") ? 401 : 400);
  }
}
