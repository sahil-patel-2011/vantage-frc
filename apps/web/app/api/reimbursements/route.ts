import { withRls } from "@vantage/db";
import {
  computeReimbursementsView,
  currentSeasonYear,
  auditPayload,
  isUuid,
  normalizeClaimDraft,
  writeReimbursementAudit,
  type ReimbursementsView,
} from "../../../lib/finance/reimbursements";
import { requireOrgMember, requireTenantSession, tenantErrorResponse } from "../../../lib/tenant-org-access";

export const runtime = "nodejs";

/**
 * Member reimbursement claims (0482). RLS is the security model: a non-admin
 * only ever sees rows where member_user_id = current_app_user_id(), so both
 * roles run the same SELECT. requireOrgMember turns a wrong orgId into an
 * explicit 403 instead of a silently empty list.
 */
export async function GET(request: Request) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = Number(url.searchParams.get("seasonYear"));
  const seasonYear = Number.isFinite(seasonParam) && seasonParam > 1992 ? Math.round(seasonParam) : currentSeasonYear();

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      // The page is reachable without ?orgId= (drawer link, bookmark), so the
      // caller's workspace is resolved from their memberships the way
      // lib/cad-vault/view.ts does. RLS predicates key off the user, not
      // app.org_id, so this is safe without a pre-selected org.
      const membership = await client.query<{ orgId: string; role: string }>(
        `SELECT m.org_id::text AS "orgId", m.role::text AS role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, isUuid(requestedOrg) ? requestedOrg : null],
      );
      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Join or select a team to file a reimbursement.",
          orgId: null,
        } satisfies ReimbursementsView;
      }
      return computeReimbursementsView(client, {
        orgId: row.orgId,
        userId: session.user.id,
        isTreasurer: row.role === "owner" || row.role === "admin",
        seasonYear,
      });
    });
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Reimbursements are unavailable right now. Confirm database access and try again.",
        orgId: null,
      } satisfies ReimbursementsView,
      { status: 200 },
    );
  }
}

/**
 * File a claim. It always lands as a DRAFT: submitting requires a receipt, and
 * the receipt is uploaded against the created row. Nothing is ever recorded as
 * money out here — a claim is a request, not a payment.
 */
export async function POST(request: Request) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId;
  if (!isUuid(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });

  const draft = normalizeClaimDraft({
    amountUsd: body.amountUsd,
    description: body.description,
    categoryId: body.categoryId,
    purchasedOn: body.purchasedOn,
    seasonYear: body.seasonYear,
  });
  if (!draft.ok) return Response.json({ error: draft.reason }, { status: 400 });

  try {
    const created = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const result = await client.query<{ id: string }>(
        `INSERT INTO reimbursement_requests
           (org_id, season_year, member_user_id, amount_usd, description, category_id, purchased_on, status)
         VALUES ($1::uuid, $2::int, $3::uuid, $4::numeric, $5, $6::uuid, $7::date, 'draft')
         RETURNING id::text AS id`,
        [
          orgId,
          draft.value.seasonYear,
          session.user.id,
          draft.value.amountUsd,
          draft.value.description,
          draft.value.categoryId,
          draft.value.purchasedOn,
        ],
      );
      const id = result.rows[0]!.id;
      await writeReimbursementAudit(client, {
        orgId,
        actorUserId: session.user.id,
        action: "reimbursement.created",
        before: null,
        after: auditPayload({ reimbursementId: id, status: "draft", amountUsd: draft.value.amountUsd }),
      });
      return id;
    });
    return Response.json({ success: true, id: created, status: "draft" });
  } catch (error) {
    return tenantErrorResponse(error, "Could not file that reimbursement.");
  }
}
