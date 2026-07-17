import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { awardCatalogEntry } from "../../../lib/awards";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Award request failed" }, { status: 400 });

const RETURNING = `id, season_year AS "seasonYear", event_key AS "eventKey", award_type AS "awardType", title,
  status, priority, deadline, owner_user_id AS "ownerUserId", summary, created_at AS "createdAt"`;

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const submissions = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT id, season_year AS "seasonYear", event_key AS "eventKey", award_type AS "awardType", title,
                status, priority, deadline, owner_user_id AS "ownerUserId", summary, created_at AS "createdAt",
                COALESCE(item_counts.total, 0) AS "totalItems", COALESCE(item_counts.done, 0) AS "doneItems"
         FROM award_submissions
         LEFT JOIN (
           SELECT submission_id, count(*) AS total,
                  count(*) FILTER (WHERE done OR length(coalesce(content,''))>0) AS done
           FROM award_items GROUP BY submission_id
         ) item_counts ON item_counts.submission_id = award_submissions.id
         WHERE org_id=$1 ${seasonYear ? "AND season_year=$2" : ""}
         ORDER BY deadline NULLS LAST, season_year DESC`,
        seasonYear ? [orgId, Number(seasonYear)] : [orgId],
      );
      return result.rows;
    });
    return Response.json({ submissions });
  } catch (error) { return fail(error); }
}

/** Creating a submission auto-seeds its essay items from the FRC award catalog's standard prompts. */
export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const awardType = String(body.awardType ?? "");
    if (!orgId) throw new Error("orgId is required");
    if (!awardType) throw new Error("awardType is required");
    const seasonYear = Number(body.seasonYear ?? new Date().getFullYear());
    const catalogEntry = awardCatalogEntry(awardType);
    const submission = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `INSERT INTO award_submissions(org_id, season_year, event_key, award_type, title, deadline, owner_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING ${RETURNING}`,
        [orgId, seasonYear, body.eventKey || null, awardType, body.title || catalogEntry?.name || awardType,
          body.deadline || null, body.ownerUserId || null],
      );
      const submissionId = result.rows[0].id as string;
      if (catalogEntry?.essayPrompts.length) {
        for (const [index, prompt] of catalogEntry.essayPrompts.entries()) {
          await client.query(
            `INSERT INTO award_items(submission_id, org_id, kind, prompt, sort_order) VALUES($1,$2,'essay',$3,$4)`,
            [submissionId, orgId, prompt, index],
          );
        }
      }
      return result.rows[0];
    });
    return Response.json({ submission });
  } catch (error) { return fail(error); }
}

const VALID_STATUSES = ["planned", "drafting", "in_review", "submitted", "finalist", "won", "not_selected"];

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const status = body.status != null ? String(body.status) : undefined;
    if (status && !VALID_STATUSES.includes(status)) throw new Error("Invalid status");
    const submission = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `UPDATE award_submissions SET
           status=COALESCE($1,status), priority=COALESCE($2,priority), deadline=COALESCE($3,deadline),
           owner_user_id=COALESCE($4,owner_user_id), summary=COALESCE($5,summary), updated_at=now()
         WHERE id=$6 AND org_id=$7 RETURNING ${RETURNING}`,
        [status ?? null, body.priority ?? null, body.deadline ?? null, body.ownerUserId ?? null, body.summary ?? null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Award submission not found");
      return result.rows[0];
    });
    return Response.json({ success: true, submission });
  } catch (error) { return fail(error); }
}
