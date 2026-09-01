/**
 * GET /api/hours/export — build hours as a CSV a team can hand to a school.
 *
 * Scope follows the caller's role, decided in `lib/hours/export.ts`: mentors export the team,
 * members export themselves. The query is scoped by `org_id` on top of RLS, so an `orgId` the
 * caller is not a member of never reaches the SELECT.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  exportScopeFor,
  hoursCsv,
  hoursExportFileName,
  visibleLogs,
  type ExportableHourLog,
} from "../../../../lib/hours/export";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (value: string | null) => (value && ISO_DATE.test(value) ? value : null);

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const payload = await withRls({ userId, orgId }, async (client) => {
      const membership = await client.query<{ role: string; teamNumber: number | null }>(
        `SELECT m.role::text AS role, o.team_number AS "teamNumber"
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
        [orgId, userId],
      );
      const member = membership.rows[0];
      if (!member) throw new Error("forbidden");

      // auto_closed / auto_closed_reason arrived in migration 0457; a team that has not applied it
      // still gets a valid export, just without the review flag column populated.
      const withFlags = `SELECT r.id, r.user_id AS "userId", u.name AS "userName", r.kind,
                r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut",
                COALESCE(r.note, '') AS note, cb.name AS "closedByName",
                r.auto_closed AS "autoClosed", r.auto_closed_reason AS "autoClosedReason"`;
      const withoutFlags = `SELECT r.id, r.user_id AS "userId", u.name AS "userName", r.kind,
                r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut",
                COALESCE(r.note, '') AS note, cb.name AS "closedByName",
                NULL::boolean AS "autoClosed", NULL::text AS "autoClosedReason"`;
      const from = `FROM hour_logs r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN users cb ON cb.id = r.closed_by
         WHERE r.org_id = $1::uuid
         ORDER BY r.clock_in ASC
         LIMIT 20000`;

      let rows: ExportableHourLog[];
      try {
        rows = (await client.query<ExportableHourLog>(`${withFlags} ${from}`, [orgId])).rows;
      } catch {
        rows = (await client.query<ExportableHourLog>(`${withoutFlags} ${from}`, [orgId])).rows;
      }

      const scope = exportScopeFor(member.role);
      const csv = hoursCsv(visibleLogs(rows, { role: member.role, userId }), {
        from: dateParam(url.searchParams.get("from")),
        to: dateParam(url.searchParams.get("to")),
      });
      const fileName = hoursExportFileName({
        teamNumber: member.teamNumber,
        scope,
        today: new Date().toISOString().slice(0, 10),
      });
      return { csv, fileName };
    });

    return new Response(payload.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${payload.fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hours export failed";
    if (message === "forbidden") {
      return Response.json({ error: "Organization access denied" }, { status: 403 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
