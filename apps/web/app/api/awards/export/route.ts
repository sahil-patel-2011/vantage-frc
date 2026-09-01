/**
 * GET /api/awards/export — copy-all text or printable HTML for one award submission.
 *
 * Members may export; the packet is built in `lib/awards/export.ts` so empty catalog
 * prompts and invented impact hours cannot leak in at the route layer.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildAwardExportPayload,
  type AwardExportItemInput,
  type AwardExportSubmissionInput,
} from "../../../../lib/awards/export";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Award export failed" }, { status: 400 });

type SubmissionRow = AwardExportSubmissionInput;
type ItemRow = AwardExportItemInput;

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const submissionId = url.searchParams.get("submissionId");
    const format = url.searchParams.get("format") ?? "json";
    if (!orgId) throw new Error("orgId is required");
    if (!submissionId) throw new Error("submissionId is required");
    if (!["json", "txt", "html"].includes(format)) throw new Error("format must be json, txt, or html");

    const payload = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        current.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");

      const submission = await client.query<SubmissionRow>(
        `SELECT id, season_year AS "seasonYear", event_key AS "eventKey", award_type AS "awardType",
                title, status, deadline::text AS deadline
         FROM award_submissions
         WHERE id=$1 AND org_id=$2`,
        [submissionId, orgId],
      );
      if (!submission.rowCount) throw new Error("Award submission not found");

      const items = await client.query<ItemRow>(
        `SELECT id, kind, prompt, content, char_limit AS "charLimit", done, sort_order AS "sortOrder"
         FROM award_items
         WHERE org_id=$1 AND submission_id=$2
         ORDER BY sort_order`,
        [orgId, submissionId],
      );

      return buildAwardExportPayload({ submission: submission.rows[0]!, items: items.rows });
    });

    if (format === "txt") {
      return new Response(payload.copyText, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${payload.fileStem}.txt"`,
          "cache-control": "no-store",
        },
      });
    }
    if (format === "html") {
      return new Response(payload.printableHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${payload.fileStem}.html"`,
          "cache-control": "no-store",
        },
      });
    }

    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Award export failed";
    if (message === "Authentication required") {
      return Response.json({ error: message }, { status: 401 });
    }
    if (message === "Organization access denied") {
      return Response.json({ error: message }, { status: 403 });
    }
    return fail(error);
  }
}
