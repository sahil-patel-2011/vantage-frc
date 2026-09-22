import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  REPORT_REASONS,
  ModerationError,
  canModerate,
  dismissReport,
  listOpenReports,
  parseDismissInput,
  parseRemoveInput,
  parseReportInput,
  removeMessage,
  reportMessage,
  requireChatMember,
} from "../../../../lib/messages/moderation";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * Team chat moderation (migration 0674).
 *
 * GET  ?orgId=                         → { canModerate, reasons, reports } (reports: owners/admins only)
 * POST { action: "report",  orgId, messageId, reason, note? }   any member who can see the message
 * POST { action: "remove",  orgId, messageId, reason? }         owner/admin
 * POST { action: "dismiss", orgId, reportId, note? }            owner/admin, never on a report about themself
 *
 * Every check runs server-side on the caller's RLS session, and again in the database.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown) {
  if (error instanceof ModerationError) return Response.json({ error: error.message }, { status: error.status });
  const code = (error as { code?: string } | null)?.code;
  const message = publicErrorMessage(error, "");
  if (code === "42P01" || code === "42883" || /org_message_reports|moderate_remove_org_message/.test(message)) {
    return Response.json(
      { error: "Chat moderation needs a database update (migration 0674).", status: "setup_required" },
      { status: 503 },
    );
  }
  if (code === "42501" || /row-level security|owner or admin/i.test(message)) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 });
  }
  if (code === "P0002") return Response.json({ error: "That message was not found." }, { status: 404 });
  return Response.json({ error: "Could not complete that moderation action." }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId || !UUID_RE.test(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });
  try {
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await requireChatMember(client, orgId, session.user.id);
      const moderator = canModerate(role);
      return {
        canModerate: moderator,
        reasons: REPORT_REASONS,
        reports: moderator ? await listOpenReports(client, { orgId, userId: session.user.id }) : [],
      };
    });
    return Response.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = String(body.orgId ?? "");
  if (!UUID_RE.test(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });
  const userId = session.user.id;
  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      switch (body.action) {
        case "report":
          return reportMessage(client, { orgId, userId, ...parseReportInput(body) });
        case "remove":
          return removeMessage(client, { orgId, userId, ...parseRemoveInput(body) });
        case "dismiss":
          return dismissReport(client, { orgId, userId, ...parseDismissInput(body) });
        default:
          throw new ModerationError(400, "Unknown moderation action.");
      }
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
