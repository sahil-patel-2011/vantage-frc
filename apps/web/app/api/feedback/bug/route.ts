import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import {
  BUG_DESCRIPTION_MAX,
  BUG_SEVERITIES,
  normalizeBugReport,
} from "../../../../lib/feedback/bug-report";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const bugLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "bug-report" });

const bugSchema = z
  .object({
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
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  try {
    if (!(await bugLimiter.allow(`${userId}:${anonymizeIp(clientIp(request))}`))) {
      return rateLimitedResponse("That's a lot of bug reports at once — give it a few minutes.");
    }

    const body = await parseSecureJson(request, bugSchema);
    const normalized = normalizeBugReport({
      description: body.description,
      severity: body.severity ?? undefined,
      route: body.route ?? undefined,
      clientInfo: body.clientInfo ?? undefined,
    });
    if (!normalized.ok) {
      return privateJson({ error: normalized.error }, { status: 400 });
    }
    const report = normalized.report;

    // RLS enforces user_id = current_app_user_id() and org membership when orgId is given.
    const orgId = body.orgId ?? undefined;
    const id = await withRls({ userId, ...(orgId ? { orgId } : {}) }, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO bug_reports (org_id, user_id, route, description, severity, app_area, client_info)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [
          orgId ?? null,
          userId,
          report.route,
          report.description,
          report.severity,
          report.appArea,
          JSON.stringify(report.clientInfo),
        ],
      );
      return result.rows[0]?.id ?? null;
    });

    return privateJson({ status: "ok", id });
  } catch (error) {
    return securityErrorResponse(error, "Could not send the bug report.");
  }
}
