import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  canTransitionPurchaseRequest,
  validatePurchaseRequestInput,
  type PurchaseRequestStatus,
} from "../../../../lib/finance";
import { recordMoney, removeMoney } from "../../../../lib/finance/ledger";
import { sanitizeFinanceWriteBody } from "../../../../lib/finance/sanitize-write";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Purchase request failed" }, { status: 400 });

const LIST_FIELDS = `pr.id, pr.season_year AS "seasonYear", pr.category_id AS "categoryId", c.name AS "categoryName",
  pr.requested_by AS "requestedBy",
  CASE WHEN pr.requested_by=current_app_user_id() THEN 'You' ELSE 'Team member' END AS "requestedByName",
  pr.title, pr.vendor, pr.item_url AS "itemUrl",
  pr.quantity, pr.unit_cost_usd AS "unitCostUsd", pr.total_cost_usd AS "totalCostUsd", pr.justification,
  pr.status, pr.reviewed_by AS "reviewedBy", pr.reviewed_at AS "reviewedAt", pr.review_notes AS "reviewNotes",
  pr.ordered_at AS "orderedAt", pr.received_at AS "receivedAt", pr.created_at AS "createdAt"`;

const INSERT_RETURNING = `id, season_year AS "seasonYear", category_id AS "categoryId", requested_by AS "requestedBy",
  title, vendor, item_url AS "itemUrl", quantity, unit_cost_usd AS "unitCostUsd", total_cost_usd AS "totalCostUsd",
  justification, status, created_at AS "createdAt"`;

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const status = url.searchParams.get("status");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const conditions = ["pr.org_id=$1"];
    const params: unknown[] = [orgId];
    if (status) { params.push(status); conditions.push(`pr.status=$${params.length}`); }
    if (seasonYear) { params.push(Number(seasonYear)); conditions.push(`pr.season_year=$${params.length}`); }
    const requests = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT ${LIST_FIELDS} FROM purchase_requests pr
         LEFT JOIN finance_categories c ON c.id = pr.category_id
         WHERE ${conditions.join(" AND ")} ORDER BY pr.created_at DESC`,
        params,
      );
      return result.rows;
    });
    return Response.json({ requests });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = sanitizeFinanceWriteBody((await request.json()) as Record<string, unknown>);
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const seasonYear = Number(body.seasonYear ?? new Date().getFullYear());
    const validated = validatePurchaseRequestInput(body);
    if (!validated.ok) throw new Error(validated.error);
    const created = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `INSERT INTO purchase_requests(org_id, season_year, category_id, requested_by, title, vendor,
           item_url, quantity, unit_cost_usd, total_cost_usd, justification)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${INSERT_RETURNING}`,
        [orgId, seasonYear, body.categoryId ?? null, current.user.id, validated.value.title, validated.value.vendor,
          validated.value.itemUrl, validated.value.quantity, validated.value.unitCostUsd, validated.value.totalCostUsd,
          validated.value.justification],
      );
      return result.rows[0];
    });
    return Response.json({ request: created });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = sanitizeFinanceWriteBody((await request.json()) as Record<string, unknown>);
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const updated = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const existing = await client.query(
        `SELECT status, requested_by AS "requestedBy", category_id AS "categoryId", total_cost_usd AS "totalCostUsd",
                season_year AS "seasonYear" FROM purchase_requests WHERE id=$1 AND org_id=$2`,
        [id, orgId],
      );
      if (!existing.rowCount) throw new Error("Purchase request not found");
      const row = existing.rows[0] as {
        status: PurchaseRequestStatus; requestedBy: string; categoryId: string | null; totalCostUsd: string; seasonYear: number;
      };

      if (action === "edit") {
        if (row.requestedBy !== current.user.id) throw new Error("Only the requester can edit this request");
        if (row.status !== "pending") throw new Error("Only a pending request can be edited");
        const validated = validatePurchaseRequestInput(body);
        if (!validated.ok) throw new Error(validated.error);
        const result = await client.query(
          `UPDATE purchase_requests SET title=$1, vendor=$2, item_url=$3, quantity=$4, unit_cost_usd=$5,
             total_cost_usd=$6, justification=$7, category_id=$8, updated_at=now()
           WHERE id=$9 RETURNING id, status`,
          [validated.value.title, validated.value.vendor, validated.value.itemUrl, validated.value.quantity,
            validated.value.unitCostUsd, validated.value.totalCostUsd, validated.value.justification,
            body.categoryId ?? row.categoryId, id],
        );
        return result.rows[0];
      }

      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      const nextStatus: Record<string, PurchaseRequestStatus> = {
        approve: "approved", reject: "rejected", mark_ordered: "ordered",
        mark_received: "received", mark_reimbursed: "reimbursed",
      };
      const to = nextStatus[action];
      if (!to) throw new Error("Unknown action");
      if (!canTransitionPurchaseRequest(row.status, to)) throw new Error(`Cannot move a ${row.status} request to ${to}`);

      const result = await client.query(
        `UPDATE purchase_requests SET status=$1, reviewed_by=$2, reviewed_at=now(), review_notes=COALESCE($3,review_notes),
           buyer_user_id=CASE WHEN $1='approved' THEN coalesce(buyer_user_id, requested_by) ELSE buyer_user_id END,
           ordered_at=CASE WHEN $1='ordered' THEN now() ELSE ordered_at END,
           received_at=CASE WHEN $1='received' THEN now() ELSE received_at END,
           updated_at=now()
         WHERE id=$4 RETURNING id, status`,
        [to, current.user.id, body.reviewNotes ?? null, id],
      );

      if (to === "approved") {
        // Mirror onto the unified money ledger (0461) in the same transaction —
        // idempotent upsert keyed by (org, 'purchase_request', request id).
        await recordMoney(client, {
          orgId,
          source: "purchase_request",
          sourceId: id,
          direction: "out",
          amountUsd: Number(row.totalCostUsd) || 0,
          seasonYear: row.seasonYear,
          categoryId: row.categoryId,
          label: "Purchase request approved",
          createdBy: current.user.id,
        });
      } else if (to === "rejected" && row.status === "approved") {
        // Rejecting an approved request un-commits the money.
        await removeMoney(client, { orgId, source: "purchase_request", sourceId: id });
      }

      await client.query(
        `INSERT INTO finance_audit_log(org_id, actor_user_id, action, before, after) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [orgId, current.user.id, `purchase_request.${action}`, JSON.stringify(row), JSON.stringify(result.rows[0])],
      );
      return result.rows[0];
    });
    return Response.json({ success: true, request: updated });
  } catch (error) { return fail(error); }
}
