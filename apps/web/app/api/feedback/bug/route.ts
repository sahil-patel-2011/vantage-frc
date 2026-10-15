import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import {
  BUG_DESCRIPTION_MAX,
  BUG_KINDS,
  BUG_SEVERITIES,
  normalizeBugReport,
} from "../../../../lib/feedback/bug-report";
import { adminLink, mailFeedbackInbox } from "../../../../lib/feedback/inbox-mail";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const bugLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "bug-report" });

const bugSchema = z
  .object({
    // Omitted means a problem: the Report-a-bug page and older clients never sent one.
    kind: z.enum(BUG_KINDS).nullish(),
    description: z.string().min(1).max(BUG_DESCRIPTION_MAX),
    severity: z.enum(BUG_SEVERITIES).nullish(),
    route: z.string().max(2000).nullish(),
    orgId: z.string().uuid().nullish(),
    clientInfo: z
      .object({
        viewportWidth: z.number().nullish(),
        viewportHeight: z.number().nullish(),
        userAgent: z.string().max(2000).nullish(),
      })
      .nullish(),
  })
  .strict();

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  const userId = session.user.id;

  try {
    if (!(await bugLimiter.allow(`${userId}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("That's a lot of bug reports at once — give it a few minutes.");
    }

    const body = await parseSecureJson(request, bugSchema);
    const normalized = normalizeBugReport({
      kind: body.kind ?? undefined,
      description: body.description,
      severity: body.severity ?? undefined,
      route: body.route ?? undefined,
      clientInfo: body.clientInfo ?? undefined,
    });
    if (!normalized.ok) {
      return privateJson({ error: normalized.error }, { status: 400 });
    }
    const report = normalized.report;

    // RLS enforces user_id = current_app_user_id(). The team on the page is only kept when the
    // reporter belongs to it: a stale or foreign ?orgId= must not cost them their note.
    const orgId = body.orgId ?? undefined;
    const saved = await withRls({ userId, ...(orgId ? { orgId } : {}) }, async (client) => {
      const result = await client.query<{ id: string; orgId: string | null }>(
        `INSERT INTO bug_reports (org_id, user_id, kind, route, description, severity, app_area, client_info)
         VALUES (
           CASE WHEN $1::uuid IS NOT NULL AND is_org_member($1::uuid) THEN $1::uuid ELSE NULL END,
           $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, org_id::text AS "orgId"`,
        [
          orgId ?? null,
          userId,
          report.kind,
          report.route,
          report.description,
          report.severity,
          report.appArea,
          JSON.stringify(report.clientInfo),
        ],
      );
      const row = result.rows[0];
      const team = row?.orgId
        ? (
            await client.query<{ name: string | null; teamNumber: number | null }>(
              `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
              [row.orgId],
            )
          ).rows[0] ?? null
        : null;
      return { id: row?.id ?? null, team };
    });
    const id = saved.id;

    // Every note also goes to the feedback inbox, after the response so it never slows the
    // dialog down. The note is saved either way; email that isn't set up just isn't sent.
    const teamLabel = saved.team?.teamNumber != null ? `Team ${saved.team.teamNumber}` : saved.team?.name ?? null;
    after(() =>
      mailFeedbackInbox({
        subject: `[Vantage ${report.kind === "idea" ? "idea" : "problem"}] ${report.description.replace(/\s+/g, " ").slice(0, 70)}`,
        lines: [
          `${session.user.name || "A member"}${session.user.email ? ` <${session.user.email}>` : ""}${teamLabel ? ` · ${teamLabel}` : ""}`,
          `Kind: ${report.kind}${report.severity ? ` · ${report.severity}` : ""}`,
          report.route ? `Page: ${report.route}` : null,
          report.clientInfo ? `Screen: ${JSON.stringify(report.clientInfo)}` : null,
          "",
          report.description,
          "",
          `Inbox: ${adminLink("/admin/feedback")}`,
          id ? `Report id: ${id}` : null,
        ],
      }),
    );

    return privateJson({ status: "ok", id });
  } catch (error) {
    return securityErrorResponse(error, "Could not send the bug report.");
  }
}
