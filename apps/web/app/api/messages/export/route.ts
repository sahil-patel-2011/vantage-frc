/**
 * Child-safety export of one named member's private message history.
 *
 * This is a safeguarding requirement, not a surveillance feature, and it is built to look like
 * one: owner/admin only, one named member at a time, a written reason is mandatory, and every
 * export that actually reads messages writes an `export_audit_events` row before the data is
 * returned. (Requests rejected for authorisation, a missing reason, or rate limiting are NOT
 * audited — nothing was disclosed.) Private conversations are invisible to admins under RLS; the
 * single audited hole is `org_member_dm_export` (migration 0455).
 *
 * Soft-deleted messages are included with their body and deletion time — for an audit
 * record, "deleted" must not mean "gone". Teams should tell members this before they
 * use chat; the privacy policy's messages section states it.
 */

import { withRls } from "@vantage/db";
import { auth } from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  dmExportFilename,
  dmExportSummary,
  normalizeExportFormat,
  normalizeExportReason,
  toDmExportCsv,
  type DmExportRow,
} from "../../../../lib/messages/dm-export";
import { isOrgChatAdmin, supportsYouthProtection } from "../../../../lib/messages/supervision";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXPORT_ROWS = 20000;

const exportLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60_000,
  namespace: "messages-dm-export",
});

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Export failed";
  return Response.json({ error: message }, { status: message.includes("Authentication") ? 401 : 400 });
}

async function writeExportAudit(
  client: PoolClient,
  args: {
    orgId: string;
    actorUserId: string;
    action: string;
    reason: string;
    metadata: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO export_audit_events (org_id, actor_user_id, action, reason, metadata)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)`,
    [args.orgId, args.actorUserId, args.action, args.reason, JSON.stringify(args.metadata)],
  );
}

/**
 * POST, not GET: the mandatory reason is free text about a named minor, so it travels in a body
 * rather than a query string that would land in access logs and browser history.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      memberUserId?: string;
      format?: string;
      reason?: string;
    };
    const orgId = String(body.orgId ?? "");
    const memberUserId = String(body.memberUserId ?? "");
    if (!orgId || !UUID_RE.test(orgId)) throw new Error("orgId is required");
    if (!memberUserId || !UUID_RE.test(memberUserId)) throw new Error("Choose a member to export");
    const format = normalizeExportFormat(body.format);
    const reason = normalizeExportReason(body.reason);

    if (!(await exportLimiter.allow(session.user.id))) {
      return rateLimitedResponse("Too many exports in the last hour. Try again shortly.");
    }

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      if (!(await isOrgChatAdmin(client, orgId, session.user.id))) {
        throw new Error("Only an owner or admin can export a member's message history");
      }
      if (!(await supportsYouthProtection(client))) {
        throw new Error(
          "Message-history export requires migration 0455_chat_youth_protection. Until it runs, " +
            "private messages cannot be exported and no supervision rule is enforced.",
        );
      }

      const member = await client.query<{ name: string; email: string }>(
        `SELECT COALESCE(u.name, 'Member') AS name, u.email
         FROM memberships m
         INNER JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
         LIMIT 1`,
        [orgId, memberUserId],
      );
      if (!member.rowCount) throw new Error("That member is not on this team");

      const rows = await client.query<DmExportRow>(
        `SELECT conversation_id::text AS "conversationId",
                message_id::text AS "messageId",
                sent_at::text AS "sentAt",
                deleted_at::text AS "deletedAt",
                author_user_id::text AS "authorUserId",
                author_name AS "authorName",
                author_email AS "authorEmail",
                body,
                counterparties,
                supervisors
         FROM org_member_dm_export($1::uuid, $2::uuid)
         LIMIT ${MAX_EXPORT_ROWS}`,
        [orgId, memberUserId],
      );

      const summary = dmExportSummary(rows.rows);
      await writeExportAudit(client, {
        orgId,
        actorUserId: session.user.id,
        action: "chat_dm_export",
        reason,
        metadata: {
          memberUserId,
          memberName: member.rows[0]!.name,
          format,
          ...summary,
          truncated: rows.rows.length >= MAX_EXPORT_ROWS,
        },
      });

      return { rows: rows.rows, member: member.rows[0]!, summary };
    });

    const filename = dmExportFilename(result.member.name, format);
    if (format === "csv") {
      return new Response(toDmExportCsv(result.rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }

    return Response.json(
      {
        member: { userId: memberUserId, name: result.member.name, email: result.member.email },
        exportedAt: new Date().toISOString(),
        exportedBy: session.user.id,
        reason,
        // Named so a reader cannot mistake this for a complete record of the member's
        // communication — it is this workspace's private messages, nothing else.
        scope: "vantage_org_direct_messages",
        note:
          "Includes messages the sender deleted (deletedAt is set, body retained). Does not " +
          "include the team channel, or anything said on another platform.",
        summary: result.summary,
        messages: result.rows,
      },
      {
        headers: {
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return fail(error);
  }
}
