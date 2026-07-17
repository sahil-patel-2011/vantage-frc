import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Grant application request failed" }, { status: 400 });

const LIST_FIELDS = `ga.id, ga.grant_opportunity_id AS "grantOpportunityId", go.name AS "opportunityName",
  ga.season_year AS "seasonYear", ga.status, ga.amount_requested_usd AS "amountRequestedUsd",
  ga.amount_awarded_usd AS "amountAwardedUsd", ga.owner_user_id AS "ownerUserId", ga.submitted_at AS "submittedAt",
  ga.decision_at AS "decisionAt", ga.summary, ga.created_at AS "createdAt"`;

const VALID_STATUSES = ["identified", "drafting", "in_review", "submitted", "awarded", "declined"];

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const applications = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT ${LIST_FIELDS} FROM grant_applications ga
         LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
         WHERE ga.org_id=$1 ${seasonYear ? "AND ga.season_year=$2" : ""}
         ORDER BY ga.created_at DESC`,
        seasonYear ? [orgId, Number(seasonYear)] : [orgId],
      );
      return result.rows;
    });
    return Response.json({ applications });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const seasonYear = Number(body.seasonYear ?? new Date().getFullYear());
    const application = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `INSERT INTO grant_applications(org_id, grant_opportunity_id, season_year, status, amount_requested_usd, owner_user_id, summary)
         VALUES($1,$2,$3,'identified',$4,$5,$6)
         RETURNING id, grant_opportunity_id AS "grantOpportunityId", season_year AS "seasonYear", status,
           amount_requested_usd AS "amountRequestedUsd", owner_user_id AS "ownerUserId", summary, created_at AS "createdAt"`,
        [orgId, body.grantOpportunityId || null, seasonYear, body.amountRequestedUsd || null, body.ownerUserId || null, body.summary || null],
      );
      return result.rows[0];
    });
    return Response.json({ application });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const status = body.status != null ? String(body.status) : undefined;
    if (status && !VALID_STATUSES.includes(status)) throw new Error("Invalid status");
    const application = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `UPDATE grant_applications SET
           status=COALESCE($1,status),
           amount_requested_usd=COALESCE($2,amount_requested_usd),
           amount_awarded_usd=COALESCE($3,amount_awarded_usd),
           owner_user_id=COALESCE($4,owner_user_id),
           summary=COALESCE($5,summary),
           submitted_at=CASE WHEN $1='submitted' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
           decision_at=CASE WHEN $1 IN ('awarded','declined') AND decision_at IS NULL THEN now() ELSE decision_at END,
           updated_at=now()
         WHERE id=$6 AND org_id=$7
         RETURNING id, status, amount_requested_usd AS "amountRequestedUsd", amount_awarded_usd AS "amountAwardedUsd"`,
        [status ?? null, body.amountRequestedUsd ?? null, body.amountAwardedUsd ?? null, body.ownerUserId ?? null,
          body.summary ?? null, id, orgId],
      );
      if (!result.rowCount) throw new Error("Grant application not found");
      return result.rows[0];
    });
    return Response.json({ success: true, application });
  } catch (error) { return fail(error); }
}
