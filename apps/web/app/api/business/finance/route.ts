import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { sanitizeFinanceWriteBody } from "../../../../lib/finance/sanitize-write";
import {
  syncFundingSourceMoney,
  syncPurchaseLogMoney,
} from "../../../../lib/finance/source-mirrors";
import {
  computeSeasonFinanceView,
  parseFundingSourceInput,
  parsePurchaseLogInput,
  validFinanceSeason,
  type SeasonFinanceView,
} from "../../../../lib/business/compute-season-finance";

const FALLBACK: SeasonFinanceView = {
  status: "setup_required",
  message: "Could not load season finance. Select a workspace and confirm database access.",
  steps: [{ id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" }],
  orgId: null,
  seasonYear: validFinanceSeason(undefined),
};

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonYear = url.searchParams.get("season") ?? url.searchParams.get("seasonYear");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSeasonFinanceView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear: seasonYear ? Number(seasonYear) : null,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let raw: Record<string, unknown>;
  try {
    raw = sanitizeFinanceWriteBody((await request.json()) as Record<string, unknown>);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = uuidOrNull(raw.orgId);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const seasonYear = validFinanceSeason(raw.seasonYear ?? raw.season);
  const action = typeof raw.action === "string" ? raw.action : "";

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!member.rows[0]) throw new Error("Organization access denied");
      const admin = member.rows[0].role === "owner" || member.rows[0].role === "admin";

      if (action === "add-funding" || action === "update-funding") {
        if (!admin) throw new Error("Only owners and admins can post funding sources.");
        const parsed = parseFundingSourceInput(raw);
        if (action === "add-funding") {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO finance_funding_sources
               (org_id, season_year, kind, name, planned_usd, received_usd, received_on, notes, created_by)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::date, $8, $9::uuid)
             RETURNING id`,
            [
              orgId,
              seasonYear,
              parsed.kind,
              parsed.name,
              parsed.plannedUsd,
              parsed.receivedUsd,
              parsed.receivedOn,
              parsed.notes,
              session.user.id,
            ],
          );
          await syncFundingSourceMoney(client, {
            orgId,
            fundingSourceId: inserted.rows[0]!.id,
            seasonYear,
            kind: parsed.kind,
            name: parsed.name,
            receivedUsd: parsed.receivedUsd,
            receivedOn: parsed.receivedOn,
            userId: session.user.id,
          });
        } else {
          const fundingId = uuidOrNull(raw.fundingId);
          if (!fundingId) throw new Error("fundingId is required");
          const updated = await client.query<{
            seasonYear: number;
            kind: string;
            name: string;
            receivedUsd: string;
            receivedOn: string | null;
          }>(
            `UPDATE finance_funding_sources
             SET kind = $3, name = $4, planned_usd = $5, received_usd = $6, received_on = $7::date,
                 notes = $8, updated_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid
             RETURNING season_year AS "seasonYear", kind, name, received_usd::text AS "receivedUsd",
                       received_on::text AS "receivedOn"`,
            [
              fundingId,
              orgId,
              parsed.kind,
              parsed.name,
              parsed.plannedUsd,
              parsed.receivedUsd,
              parsed.receivedOn,
              parsed.notes,
            ],
          );
          if (!updated.rows[0]) throw new Error("Funding source not found");
          const row = updated.rows[0];
          await syncFundingSourceMoney(client, {
            orgId,
            fundingSourceId: fundingId,
            seasonYear: row.seasonYear,
            kind: row.kind,
            name: row.name,
            receivedUsd: Number(row.receivedUsd) || 0,
            receivedOn: row.receivedOn,
            userId: session.user.id,
          });
        }
      } else if (action === "delete-funding") {
        if (!admin) throw new Error("Only owners and admins can remove funding sources.");
        const fundingId = uuidOrNull(raw.fundingId);
        if (!fundingId) throw new Error("fundingId is required");
        await client.query(
          `DELETE FROM finance_funding_sources WHERE id = $1::uuid AND org_id = $2::uuid`,
          [fundingId, orgId],
        );
        await syncFundingSourceMoney(client, {
          orgId,
          fundingSourceId: fundingId,
          seasonYear,
          kind: "other",
          name: "Removed funding source",
          receivedUsd: 0,
          userId: session.user.id,
        });
      } else if (action === "add-purchase") {
        const parsed = parsePurchaseLogInput(raw);
        if (parsed.categoryId) {
          const category = await client.query(
            `SELECT 1 FROM finance_categories WHERE id = $1::uuid AND org_id = $2::uuid AND season_year = $3`,
            [parsed.categoryId, orgId, seasonYear],
          );
          if (!category.rowCount) throw new Error("Budget category was not found for this season.");
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO finance_purchase_log
             (org_id, season_year, purchased_on, vendor, item, category_id, amount_usd, payment_method,
              receipt_url, notes, created_by)
           VALUES ($1::uuid, $2, $3::date, $4, $5, $6::uuid, $7, $8, $9, $10, $11::uuid)
           RETURNING id`,
          [
            orgId,
            seasonYear,
            parsed.purchasedOn,
            parsed.vendor,
            parsed.item,
            parsed.categoryId,
            parsed.amountUsd,
            parsed.paymentMethod,
            parsed.receiptUrl,
            parsed.notes,
            session.user.id,
          ],
        );
        await syncPurchaseLogMoney(client, {
          orgId,
          purchaseLogId: inserted.rows[0]!.id,
          seasonYear,
          vendor: parsed.vendor,
          item: parsed.item,
          amountUsd: parsed.amountUsd,
          purchasedOn: parsed.purchasedOn,
          categoryId: parsed.categoryId,
          userId: session.user.id,
        });
      } else if (action === "mark-reimbursed") {
        if (!admin) throw new Error("Only owners and admins can mark reimbursements repaid.");
        const purchaseId = uuidOrNull(raw.purchaseId);
        if (!purchaseId) throw new Error("purchaseId is required");
        const reimbursedOn = typeof raw.reimbursedOn === "string" ? raw.reimbursedOn : new Date().toISOString().slice(0, 10);
        await client.query(
          `UPDATE finance_purchase_log
           SET reimbursed_on = $3::date, updated_at = now()
           WHERE id = $1::uuid AND org_id = $2::uuid`,
          [purchaseId, orgId, reimbursedOn],
        );
      } else if (action === "delete-purchase") {
        const purchaseId = uuidOrNull(raw.purchaseId);
        if (!purchaseId) throw new Error("purchaseId is required");
        await client.query(
          `DELETE FROM finance_purchase_log WHERE id = $1::uuid AND org_id = $2::uuid`,
          [purchaseId, orgId],
        );
        await syncPurchaseLogMoney(client, {
          orgId,
          purchaseLogId: purchaseId,
          seasonYear,
          vendor: "Removed",
          item: "purchase",
          amountUsd: 0,
          purchasedOn: new Date(),
          userId: session.user.id,
        });
      } else {
        throw new Error("Unknown finance action");
      }

      return computeSeasonFinanceView(client, {
        userId: session.user.id,
        requestedOrg: orgId,
        seasonYear,
      });
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Season finance write failed";
    if (message === "Organization access denied") {
      return Response.json({ error: message }, { status: 403 });
    }
    if (
      /required|Only owners|kind|Vendor|Amount|date|name|category|Unknown finance|What you bought|Funding source/i.test(
        message,
      )
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json(FALLBACK);
  }
}
