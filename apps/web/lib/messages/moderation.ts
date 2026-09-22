/**
 * Team chat moderation: members report, owners/admins remove (migration 0674).
 *
 * Every function runs on the caller's `withRls` client. Role checks happen here AND in the
 * database (RLS on org_message_reports, the role check inside moderate_remove_org_message), so a
 * bug in one layer does not hand a student the remove button.
 *
 * Youth protection (see youth-protection.ts and 0455): nobody reviews a report about their own
 * message. An owner/admin never sees, dismisses or actions reports about something they wrote —
 * another owner/admin must — and when no one else can review it, the reporter is told so and
 * pointed at a trusted adult instead of being left to believe someone is looking.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
  REPORT_REASONS,
  canModerate,
  isReportReason,
  removalNotice,
  reportReceipt,
  type MessageRemoval,
  type ReportReason,
} from "./moderation-copy";

export {
  REMOVED_BY_ADMIN_TEXT,
  REPORT_REASONS,
  canModerate,
  isReportReason,
  removalNotice,
  reportReceipt,
  type MessageRemoval,
  type ReportReason,
} from "./moderation-copy";

export class ModerationError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function parseReportInput(body: Record<string, unknown>): { messageId: string; reason: ReportReason; note: string | null } {
  const messageId = String(body.messageId ?? "");
  if (!UUID_RE.test(messageId)) throw new ModerationError(400, "Choose a message to report.");
  if (!isReportReason(body.reason)) throw new ModerationError(400, "Pick a reason for the report.");
  return { messageId, reason: body.reason, note: cleanText(body.note, 1000) };
}

export function parseRemoveInput(body: Record<string, unknown>): { messageId: string; reason: string | null } {
  const messageId = String(body.messageId ?? "");
  if (!UUID_RE.test(messageId)) throw new ModerationError(400, "Choose a message to remove.");
  return { messageId, reason: cleanText(body.reason, 500) };
}

export function parseDismissInput(body: Record<string, unknown>): { reportId: string; note: string | null } {
  const reportId = String(body.reportId ?? "");
  if (!UUID_RE.test(reportId)) throw new ModerationError(400, "Choose a report.");
  return { reportId, note: cleanText(body.note, 500) };
}

type RoleRow = { role: string };

async function roleOf(client: PoolClient, orgId: string, userId: string): Promise<string | null> {
  const result = await client.query<RoleRow>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  return result.rows[0]?.role ?? null;
}

export async function requireChatMember(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const role = await roleOf(client, orgId, userId);
  if (!role) throw new ModerationError(403, "You are not a member of this team.");
  return role;
}

async function requireModerator(client: PoolClient, orgId: string, userId: string): Promise<void> {
  const role = await requireChatMember(client, orgId, userId);
  if (!canModerate(role)) throw new ModerationError(403, "Only a team owner or admin can moderate chat.");
}

/** Any member who can read a live message can report it (not their own). */
export async function reportMessage(
  client: PoolClient,
  input: { orgId: string; userId: string; messageId: string; reason: ReportReason; note: string | null },
): Promise<{ reportId: string | null; alreadyReported: boolean; receipt: string }> {
  await requireChatMember(client, input.orgId, input.userId);
  // Read under the reporter's own RLS: proves they can see it, and gives the real text/author.
  const found = await client.query<{
    conversationId: string;
    authorUserId: string;
    body: string;
    deletedAt: string | null;
  }>(
    `SELECT conversation_id AS "conversationId", author_user_id AS "authorUserId", body,
            deleted_at::text AS "deletedAt"
       FROM org_messages
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.messageId, input.orgId],
  );
  const message = found.rows[0];
  if (!message) throw new ModerationError(404, "That message was not found.");
  if (message.authorUserId === input.userId) {
    throw new ModerationError(400, "You can't report your own message — delete it instead.");
  }
  if (message.deletedAt) throw new ModerationError(409, "That message was already removed.");

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO org_message_reports
       (org_id, message_id, conversation_id, reporter_user_id, message_author_id, reason, note, body_snapshot)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)
     ON CONFLICT (message_id, reporter_user_id) DO NOTHING
     RETURNING id`,
    [
      input.orgId,
      input.messageId,
      message.conversationId,
      input.userId,
      message.authorUserId,
      input.reason,
      input.note,
      message.body,
    ],
  );

  const moderators = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
      WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [input.orgId],
  );
  const ids = moderators.rows.map((row) => row.userId);
  // Reviewers are owners/admins other than the author (RLS hides the report from the author).
  const receipt = reportReceipt({
    authorIsModerator: ids.includes(message.authorUserId),
    otherModerators: ids.filter((id) => id !== message.authorUserId).length,
  });
  const reportId = inserted.rows[0]?.id ?? null;
  return { reportId, alreadyReported: reportId === null, receipt };
}

export type OpenReport = {
  id: string;
  messageId: string;
  conversationId: string;
  conversationLabel: string;
  reason: ReportReason;
  reasonLabel: string;
  note: string | null;
  bodySnapshot: string;
  reporterName: string;
  authorName: string;
  messageRemoved: boolean;
  createdAt: string;
};

/** Open reports an owner/admin may review (RLS already hides reports about their own messages). */
export async function listOpenReports(client: PoolClient, input: { orgId: string; userId: string }): Promise<OpenReport[]> {
  await requireModerator(client, input.orgId, input.userId);
  const rows = await client.query<Omit<OpenReport, "reasonLabel" | "conversationLabel"> & {
    conversationKind: string | null;
    conversationTitle: string | null;
  }>(
    `SELECT r.id, r.message_id AS "messageId", r.conversation_id AS "conversationId",
            r.reason, r.note, r.body_snapshot AS "bodySnapshot",
            COALESCE(rep.name, 'A teammate') AS "reporterName",
            COALESCE(au.name, 'A teammate') AS "authorName",
            (m.removed_at IS NOT NULL OR m.deleted_at IS NOT NULL) AS "messageRemoved",
            c.kind AS "conversationKind", c.title AS "conversationTitle",
            r.created_at::text AS "createdAt"
       FROM org_message_reports r
       LEFT JOIN users rep ON rep.id = r.reporter_user_id
       LEFT JOIN users au ON au.id = r.message_author_id
       LEFT JOIN org_messages m ON m.id = r.message_id
       LEFT JOIN org_conversations c ON c.id = r.conversation_id
      WHERE r.org_id = $1::uuid AND r.status = 'open'
      ORDER BY r.created_at ASC
      LIMIT 100`,
    [input.orgId],
  );
  return rows.rows.map(({ conversationKind, conversationTitle, ...row }) => ({
    ...row,
    messageRemoved: Boolean(row.messageRemoved),
    reasonLabel: REPORT_REASONS.find((reason) => reason.id === row.reason)?.label ?? row.reason,
    // A DM the admin is not in has no readable conversation row (RLS); either way it is
    // labelled as a private chat, never by who is in it.
    conversationLabel: conversationKind === "team" && conversationTitle ? `#${conversationTitle}` : "a private chat",
  }));
}

/** Owner/admin soft-removal of any message in their team, with a reason. */
export async function removeMessage(
  client: PoolClient,
  input: { orgId: string; userId: string; messageId: string; reason: string | null },
): Promise<{ messageId: string; removedAt: string }> {
  await requireModerator(client, input.orgId, input.userId);
  const removed = await client.query<{ message_id: string; org_id: string; removed_at: string }>(
    `SELECT message_id, org_id, removed_at::text AS removed_at
       FROM moderate_remove_org_message($1::uuid, $2)`,
    [input.messageId, input.reason],
  );
  const row = removed.rows[0];
  if (!row || row.org_id !== input.orgId) throw new ModerationError(404, "That message was not found in this team.");
  return { messageId: row.message_id, removedAt: row.removed_at };
}

/** Close a report without removing the message. Not allowed on reports about your own message. */
export async function dismissReport(
  client: PoolClient,
  input: { orgId: string; userId: string; reportId: string; note: string | null },
): Promise<{ reportId: string }> {
  await requireModerator(client, input.orgId, input.userId);
  const updated = await client.query<{ id: string }>(
    `UPDATE org_message_reports
        SET status = 'dismissed', resolved_by = $3::uuid, resolved_at = now(), resolution_note = $4
      WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'open'
      RETURNING id`,
    [input.reportId, input.orgId, input.userId, input.note],
  );
  if (!updated.rows[0]) throw new ModerationError(404, "That report is not open, or it is not yours to review.");
  return { reportId: updated.rows[0].id };
}

/**
 * Mark admin-removed messages in a thread so the UI can say "Removed by a team admin" (and tell
 * the author it was theirs). Savepoint-protected: before migration 0674 this is a no-op.
 */
export async function attachRemovalNotices(
  client: PoolClient,
  orgId: string,
  messages: Array<{ id: string; mine: boolean; deletedAt: string | null; removal?: MessageRemoval | null }>,
): Promise<void> {
  const ids = messages.filter((message) => message.deletedAt).map((message) => message.id);
  if (!ids.length) return;
  const rows = await withSavepoint(
    client,
    async () =>
      (
        await client.query<{ message_id: string; removed_at: string; reason: string | null }>(
          `SELECT message_id, removed_at::text AS removed_at, reason
             FROM org_message_removal_notices($1::uuid, $2::uuid[])`,
          [orgId, ids],
        )
      ).rows,
    [] as Array<{ message_id: string; removed_at: string; reason: string | null }>,
  );
  const byId = new Map(rows.map((row) => [row.message_id, row]));
  for (const message of messages) {
    const row = byId.get(message.id);
    if (!row) continue;
    message.removal = {
      removedAt: row.removed_at,
      reason: message.mine ? row.reason : null,
      notice: removalNotice({ mine: message.mine, reason: row.reason }),
    };
  }
}
