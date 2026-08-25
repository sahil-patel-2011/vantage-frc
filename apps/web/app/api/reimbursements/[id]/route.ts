import type { PoolClient } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import {
  auditPayload,
  evaluateTransition,
  isReimbursementAction,
  isUuid,
  mapSummaryRow,
  normalizeClaimDraft,
  syncReimbursementMirror,
  writeReimbursementAudit,
  REIMBURSEMENT_ONE_SQL,
  type ReimbursementSummary,
} from "../../../../lib/finance/reimbursements";
import {
  requireOrgMember,
  requireTenantSession,
  TenantHttpError,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

export const runtime = "nodejs";

async function loadClaim(
  client: PoolClient,
  orgId: string,
  id: string,
): Promise<ReimbursementSummary> {
  const result = await client.query(REIMBURSEMENT_ONE_SQL, [orgId, id]);
  const row = result.rows[0];
  // RLS already hides other members' claims, so a miss is genuinely "not found"
  // for this caller. 404 (never 403) keeps ids unprobeable.
  if (!row) throw new TenantHttpError(404, "Reimbursement not found.");
  return mapSummaryRow(row as never);
}

/** Column writes for each transition. Timestamps are set by the database. */
function transitionSql(action: string): { sql: string; params: (userId: string, note: string | null) => unknown[] } {
  switch (action) {
    case "submit":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'submitted', submitted_at = now(), approver_user_id = NULL,
                  decided_at = NULL, decision_note = NULL, paid_at = NULL, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: () => [],
      };
    case "withdraw":
    case "reopen":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'draft', submitted_at = NULL, approver_user_id = NULL,
                  decided_at = NULL, decision_note = NULL, paid_at = NULL, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: () => [],
      };
    case "approve":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'approved', approver_user_id = $3::uuid, decided_at = now(),
                  decision_note = $4, paid_at = NULL, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: (userId, note) => [userId, note],
      };
    case "deny":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'denied', approver_user_id = $3::uuid, decided_at = now(),
                  decision_note = $4, paid_at = NULL, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: (userId, note) => [userId, note],
      };
    case "mark_paid":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'paid', paid_at = now(), approver_user_id = COALESCE(approver_user_id, $3::uuid),
                  decided_at = COALESCE(decided_at, now()), updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: (userId) => [userId],
      };
    case "unmark_paid":
      return {
        sql: `UPDATE reimbursement_requests
              SET status = 'approved', paid_at = NULL, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid`,
        params: () => [],
      };
    default:
      throw new TenantHttpError(400, "Unknown reimbursement action.");
  }
}

/**
 * Two shapes on one endpoint:
 *  - `{ action }` drives a lifecycle transition (submit / approve / deny /
 *    mark_paid / …). Legality is decided by evaluateTransition BEFORE any
 *    write, and RLS refuses it again at the row level.
 *  - `{ amountUsd, description, … }` edits a draft the caller filed.
 *
 * Every accepted change appends to finance_audit_log, and any change that
 * crosses the PAID boundary syncs the unified-ledger mirror in the SAME
 * transaction (the 0461 contract) so the ledger can never drift.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Reimbursement not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = body.orgId;
  if (!isUuid(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });

  const note =
    typeof body.decisionNote === "string" && body.decisionNote.trim()
      ? body.decisionNote.trim().slice(0, 1000)
      : null;
  const requestedAction = body.action;

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await requireOrgMember(client, orgId, session.user.id);
      const claim = await loadClaim(client, orgId, id);
      const actor = member.admin ? "admin" : "member";
      const isOwnClaim = claim.memberUserId === session.user.id;

      // ---- edit path: the filer fixing their own draft before it is judged.
      if (!isReimbursementAction(requestedAction)) {
        if (!isOwnClaim && !member.admin) throw new TenantHttpError(403, "You can only edit reimbursements you filed.");
        if (claim.status !== "draft") {
          throw new TenantHttpError(409, "Only a draft reimbursement can be edited. Withdraw it first.");
        }
        const draft = normalizeClaimDraft({
          amountUsd: body.amountUsd ?? claim.amountUsd,
          description: body.description ?? claim.description,
          categoryId: body.categoryId ?? claim.categoryId,
          purchasedOn: body.purchasedOn ?? claim.purchasedOn,
          seasonYear: body.seasonYear ?? claim.seasonYear,
        });
        if (!draft.ok) throw new TenantHttpError(400, draft.reason);
        await client.query(
          `UPDATE reimbursement_requests
           SET amount_usd = $3::numeric, description = $4, category_id = $5::uuid,
               purchased_on = $6::date, season_year = $7::int, updated_at = now()
           WHERE org_id = $1::uuid AND id = $2::uuid`,
          [
            orgId,
            id,
            draft.value.amountUsd,
            draft.value.description,
            draft.value.categoryId,
            draft.value.purchasedOn,
            draft.value.seasonYear,
          ],
        );
        await writeReimbursementAudit(client, {
          orgId,
          actorUserId: session.user.id,
          action: "reimbursement.edited",
          before: auditPayload({ reimbursementId: id, status: claim.status, amountUsd: claim.amountUsd }),
          after: auditPayload({ reimbursementId: id, status: "draft", amountUsd: draft.value.amountUsd }),
        });
        return loadClaim(client, orgId, id);
      }

      // ---- transition path
      const verdict = evaluateTransition({
        action: requestedAction,
        from: claim.status,
        actor,
        isOwnClaim,
        hasReceipt: claim.hasReceipt,
      });
      if (!verdict.ok) throw new TenantHttpError(409, verdict.reason);

      const { sql, params: buildParams } = transitionSql(requestedAction);
      const updated = await client.query(sql, [orgId, id, ...buildParams(session.user.id, note)]);
      if (!updated.rowCount) {
        // RLS refused the write even though the read succeeded — the honest
        // answer is that this person cannot make this change.
        throw new TenantHttpError(403, "You do not have permission to make that change.");
      }

      // Only a crossing of the PAID boundary moves real money, so only that
      // touches the ledger. removeMoney is idempotent for a claim never paid.
      if (verdict.to === "paid" || claim.status === "paid") {
        const after = await loadClaim(client, orgId, id);
        await syncReimbursementMirror(client, {
          orgId,
          reimbursementId: id,
          status: after.status,
          amountUsd: after.amountUsd,
          seasonYear: after.seasonYear,
          categoryId: after.categoryId,
          description: after.description,
          paidAt: after.paidAt,
          actorUserId: session.user.id,
        });
      }

      await writeReimbursementAudit(client, {
        orgId,
        actorUserId: session.user.id,
        action: verdict.audit,
        before: auditPayload({ reimbursementId: id, status: claim.status, amountUsd: claim.amountUsd }),
        after: auditPayload({ reimbursementId: id, status: verdict.to, amountUsd: claim.amountUsd }),
      });
      return loadClaim(client, orgId, id);
    });
    return Response.json({ success: true, request: result });
  } catch (error) {
    return tenantErrorResponse(error, "Could not update that reimbursement.");
  }
}

/** Delete a claim that never became money. Paid/approved rows are kept for the audit trail. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!isUuid(id)) return Response.json({ error: "Reimbursement not found." }, { status: 404 });
  if (!isUuid(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const claim = await loadClaim(client, orgId, id);
      if (claim.status === "paid" || claim.status === "approved") {
        throw new TenantHttpError(
          409,
          "An approved or paid reimbursement stays on the books. Undo the payment or deny it instead.",
        );
      }
      const deleted = await client.query(
        `DELETE FROM reimbursement_requests WHERE org_id = $1::uuid AND id = $2::uuid`,
        [orgId, id],
      );
      if (!deleted.rowCount) throw new TenantHttpError(403, "You do not have permission to delete that.");
      await writeReimbursementAudit(client, {
        orgId,
        actorUserId: session.user.id,
        action: "reimbursement.deleted",
        before: auditPayload({ reimbursementId: id, status: claim.status, amountUsd: claim.amountUsd }),
        after: null,
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    return tenantErrorResponse(error, "Could not delete that reimbursement.");
  }
}
