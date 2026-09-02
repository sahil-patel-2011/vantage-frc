import { emitPreferredNotification } from "@vantage/core";
import type { PoolClient } from "@neondatabase/serverless";
import { assertGrantInOrg, loadGrantOptions } from "../finance/grant-options";
import { recordMoney, removeMoney } from "../finance/ledger";
import {
  canTransitionOrder,
  computeOrderMetrics,
  summarizeOpenOrders,
  totalFromParts,
  unitCostFromEstimate,
  validateOrderSubmit,
} from "./evaluate";
import type { OrderMember, OrderRequest, OrderStatus, OrdersView } from "./types";

export { ORDER_STATUSES, canTransitionOrder, statusLabel, showBuyPanel, validateOrderSubmit } from "./evaluate";
export type { OrderStatus };
export type {
  OrderAiSummary,
  OrderMember,
  OrderMetrics,
  OrderRequest,
  OrdersSetupStep,
  OrdersView,
} from "./types";

type OrderRow = {
  id: string;
  seasonYear: number;
  title: string;
  justification: string | null;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: string | number;
  totalCostUsd: string | number;
  status: OrderStatus;
  neededBy: string | null;
  requestedBy: string;
  requestedByName: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  buyerUserId: string | null;
  buyerName: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  grantApplicationId: string | null;
  grantName: string | null;
};

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapOrder(row: OrderRow): OrderRequest {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    justification: row.justification,
    vendor: row.vendor,
    itemUrl: row.itemUrl,
    quantity: row.quantity,
    unitCostUsd: num(row.unitCostUsd),
    totalCostUsd: num(row.totalCostUsd),
    status: row.status,
    neededBy: row.neededBy,
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewNotes: row.reviewNotes,
    buyerUserId: row.buyerUserId,
    buyerName: row.buyerName,
    orderedAt: row.orderedAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    grantApplicationId: row.grantApplicationId ?? null,
    grantName: row.grantName ?? null,
  };
}

function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function orderHref(orgId: string, orderId: string, seasonYear?: number): string {
  const params = new URLSearchParams({
    orgId,
    orderId,
  });
  if (seasonYear) params.set("season", String(seasonYear));
  return `/orders?${params.toString()}`;
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

async function loadMembers(client: PoolClient, orgId: string): Promise<OrderMember[]> {
  const rows = await client.query<OrderMember>(
    `SELECT u.id AS "userId", u.name, m.role::text AS role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY lower(u.name), u.id`,
    [orgId],
  );
  return rows.rows;
}

async function loadOrders(client: PoolClient, orgId: string, seasonYear: number): Promise<OrderRequest[]> {
  const rows = await client.query<OrderRow>(
    `SELECT
       p.id,
       p.season_year AS "seasonYear",
       p.title,
       p.justification,
       p.vendor,
       p.item_url AS "itemUrl",
       p.quantity,
       p.unit_cost_usd AS "unitCostUsd",
       p.total_cost_usd AS "totalCostUsd",
       p.status,
       p.needed_by::text AS "neededBy",
       p.requested_by AS "requestedBy",
       r.name AS "requestedByName",
       p.reviewed_by AS "reviewedBy",
       p.reviewed_at::text AS "reviewedAt",
       p.review_notes AS "reviewNotes",
       p.buyer_user_id AS "buyerUserId",
       b.name AS "buyerName",
       p.ordered_at::text AS "orderedAt",
       p.received_at::text AS "receivedAt",
       p.created_at::text AS "createdAt",
       p.updated_at::text AS "updatedAt",
       p.grant_application_id AS "grantApplicationId",
       CASE WHEN p.grant_application_id IS NULL THEN NULL ELSE COALESCE(go.name, 'Grant') END AS "grantName"
     FROM purchase_requests p
     LEFT JOIN users r ON r.id = p.requested_by
     LEFT JOIN users b ON b.id = p.buyer_user_id
     LEFT JOIN grant_applications ga ON ga.id = p.grant_application_id
     LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
     WHERE p.org_id = $1::uuid AND p.season_year = $2
     ORDER BY p.created_at DESC`,
    [orgId, seasonYear],
  );
  return rows.rows.map(mapOrder);
}

async function loadFinanceAiEnabled(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<boolean> {
  const row = await client.query<{ aiAssistEnabled: boolean }>(
    `SELECT ai_assist_enabled AS "aiAssistEnabled"
     FROM season_budgets
     WHERE org_id = $1::uuid AND season_year = $2`,
    [orgId, seasonYear],
  );
  return row.rows[0]?.aiAssistEnabled ?? false;
}

async function assertMember(client: PoolClient, orgId: string, userId: string): Promise<void> {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
    orgId,
    userId,
  ]);
  if (!member.rowCount) throw new Error("forbidden");
}

async function assertAdmin(client: PoolClient, orgId: string, userId: string): Promise<void> {
  const admin = await client.query(
    `SELECT 1 FROM memberships
     WHERE org_id = $1::uuid AND user_id = $2::uuid AND role IN ('owner', 'admin')`,
    [orgId, userId],
  );
  if (!admin.rowCount) throw new Error("Organization administrator access required");
}

async function assertBuyerMember(client: PoolClient, orgId: string, buyerUserId: string): Promise<void> {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
    orgId,
    buyerUserId,
  ]);
  if (!member.rowCount) throw new Error("Buyer must be an organization member");
}

async function notifyAdminsSubmitted(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    orderId: string;
    title: string;
    totalUsd: number;
    seasonYear?: number;
  },
): Promise<void> {
  const admins = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
     WHERE org_id = $1::uuid AND role IN ('owner', 'admin') AND user_id <> $2::uuid`,
    [input.orgId, input.actorUserId],
  );
  const href = orderHref(input.orgId, input.orderId, input.seasonYear);
  for (const admin of admins.rows) {
    await emitPreferredNotification(client, {
      userId: admin.userId,
      orgId: input.orgId,
      type: "purchase_request_submitted",
      payload: {
        title: "New purchase request",
        body: `${input.title} (~$${input.totalUsd})`,
        orderId: input.orderId,
        href,
      },
    });
  }
}

async function notifyRequesterReviewed(
  client: PoolClient,
  input: {
    orgId: string;
    requesterUserId: string;
    orderId: string;
    title: string;
    approved: boolean;
    reviewNotes: string | null;
    seasonYear?: number;
  },
): Promise<void> {
  const href = orderHref(input.orgId, input.orderId, input.seasonYear);
  await emitPreferredNotification(client, {
    userId: input.requesterUserId,
    orgId: input.orgId,
    type: input.approved ? "purchase_request_approved" : "purchase_request_rejected",
    payload: {
      title: input.approved ? "Purchase request approved" : "Purchase request rejected",
      body: input.approved
        ? `“${input.title}” is approved — ready to order outside Vantage.`
        : `“${input.title}” was not approved.${input.reviewNotes ? ` Note: ${input.reviewNotes}` : ""}`,
      orderId: input.orderId,
      href,
    },
  });
}

async function notifyBuyerAssigned(
  client: PoolClient,
  input: { orgId: string; buyerUserId: string; orderId: string; title: string },
): Promise<void> {
  const href = orderHref(input.orgId, input.orderId);
  await emitPreferredNotification(client, {
    userId: input.buyerUserId,
    orgId: input.orgId,
    type: "purchase_request_assigned",
    payload: {
      title: "Assigned to buy",
      body: `You are the buyer for “${input.title}”. Pay on the vendor site — never enter card details in Vantage.`,
      orderId: input.orderId,
      href,
    },
  });
}

export async function computeOrdersView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; focusOrderId?: string | null; seasonYear?: number },
): Promise<OrdersView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to manage purchase requests.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const seasonYear = input.seasonYear ?? currentSeasonYear();

  try {
    const [orders, members, financeAiEnabled, grants] = await Promise.all([
      loadOrders(client, org.orgId, seasonYear),
      loadMembers(client, org.orgId),
      loadFinanceAiEnabled(client, org.orgId, seasonYear),
      loadGrantOptions(client, org.orgId),
    ]);
    const metrics = computeOrderMetrics(orders, input.userId);
    const aiSummary = financeAiEnabled ? summarizeOpenOrders(orders) : null;
    const focusOrderId =
      input.focusOrderId && orders.some((order) => order.id === input.focusOrderId) ? input.focusOrderId : null;

    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      currentUserId: input.userId,
      isAdmin: org.role === "owner" || org.role === "admin",
      orders,
      members,
      grants,
      metrics,
      financeAiEnabled,
      aiSummary,
      focusOrderId,
      computedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: "setup_required",
      message: "Could not load purchase requests. Confirm database migrations have been applied.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: org.orgId,
    };
  }
}

export async function submitOrder(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear?: number; body: Record<string, unknown> },
): Promise<string> {
  await assertMember(client, input.orgId, input.userId);
  const validated = validateOrderSubmit(input.body);
  if (!validated.ok) throw new Error(validated.error);

  const seasonYear = input.seasonYear ?? currentSeasonYear();
  const unitCostUsd = unitCostFromEstimate(validated.value.estimateUsd, validated.value.quantity);
  const totalCostUsd = totalFromParts(validated.value.quantity, unitCostUsd);
  if (validated.value.grantApplicationId) {
    await assertGrantInOrg(client, input.orgId, validated.value.grantApplicationId);
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO purchase_requests (
       org_id, season_year, requested_by, title, vendor, item_url,
       quantity, unit_cost_usd, shipping_cost_usd, total_cost_usd, justification, needed_by,
       grant_application_id
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4, $5, $6,
       $7, $8, 0, $9, $10, $11::date,
       $12::uuid
     )
     RETURNING id`,
    [
      input.orgId,
      seasonYear,
      input.userId,
      validated.value.title,
      validated.value.vendor,
      validated.value.itemUrl,
      validated.value.quantity,
      unitCostUsd,
      totalCostUsd,
      validated.value.justification,
      validated.value.neededBy,
      validated.value.grantApplicationId,
    ],
  );

  const orderId = inserted.rows[0]!.id;
  await notifyAdminsSubmitted(client, {
    orgId: input.orgId,
    actorUserId: input.userId,
    orderId,
    title: validated.value.title,
    totalUsd: totalCostUsd,
    seasonYear,
  });
  return orderId;
}

export async function reviewOrder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    orderId: string;
    decision: "approved" | "rejected";
    reviewNotes?: string | null;
    buyerUserId?: string | null;
  },
): Promise<void> {
  await assertAdmin(client, input.orgId, input.userId);

  const existing = await client.query<{
    status: OrderStatus;
    requestedBy: string;
    title: string;
    totalCostUsd: string;
    categoryId: string | null;
    seasonYear: number;
    grantApplicationId: string | null;
  }>(
    `SELECT status, requested_by AS "requestedBy", title,
            total_cost_usd::text AS "totalCostUsd", category_id AS "categoryId", season_year AS "seasonYear",
            grant_application_id AS "grantApplicationId"
     FROM purchase_requests WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Purchase request not found");
  if (!canTransitionOrder(row.status, input.decision)) {
    throw new Error(`Cannot move a ${row.status} request to ${input.decision}`);
  }

  if (input.buyerUserId) {
    await assertBuyerMember(client, input.orgId, input.buyerUserId);
  }

  const reviewNotes =
    typeof input.reviewNotes === "string" ? input.reviewNotes.trim().slice(0, 1000) || null : null;
  // Default buyer to requester so approve → buy → mark-ordered works without a second assign step.
  const resolvedBuyer =
    input.decision === "approved" ? (input.buyerUserId ?? row.requestedBy) : null;

  await client.query(
    `UPDATE purchase_requests SET
       status = $3::purchase_request_status,
       reviewed_by = $4::uuid,
       reviewed_at = now(),
       review_notes = coalesce($5, review_notes),
       buyer_user_id = CASE WHEN $3 = 'approved' THEN coalesce($6::uuid, buyer_user_id, requested_by) ELSE buyer_user_id END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId, input.decision, input.userId, reviewNotes, resolvedBuyer],
  );

  if (input.decision === "approved") {
    // Mirror the committed spend onto the unified money ledger (0461) in the
    // SAME transaction — idempotent upsert keyed by (org, source, source_id).
    await recordMoney(client, {
      orgId: input.orgId,
      source: "purchase_request",
      sourceId: input.orderId,
      direction: "out",
      amountUsd: num(row.totalCostUsd),
      seasonYear: row.seasonYear,
      categoryId: row.categoryId,
      label: `Order — ${row.title}`,
      createdBy: input.userId,
      grantApplicationId: row.grantApplicationId ?? null,
    });
  } else if (row.status === "approved") {
    // Rejecting an approved order un-commits the money — remove its mirror row
    // so the ledger never keeps counting spend that will not happen.
    await removeMoney(client, {
      orgId: input.orgId,
      source: "purchase_request",
      sourceId: input.orderId,
    });
  }

  await notifyRequesterReviewed(client, {
    orgId: input.orgId,
    requesterUserId: row.requestedBy,
    orderId: input.orderId,
    title: row.title,
    approved: input.decision === "approved",
    reviewNotes,
    seasonYear: row.seasonYear,
  });

  if (
    input.decision === "approved" &&
    resolvedBuyer &&
    resolvedBuyer !== row.requestedBy
  ) {
    await notifyBuyerAssigned(client, {
      orgId: input.orgId,
      buyerUserId: resolvedBuyer,
      orderId: input.orderId,
      title: row.title,
    });
  }
}

export async function updateOrderItemUrl(
  client: PoolClient,
  input: { orgId: string; userId: string; orderId: string; itemUrl: string },
): Promise<void> {
  await assertMember(client, input.orgId, input.userId);

  const rawUrl = input.itemUrl.trim();
  let parsedUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Vendor link must be an http(s) URL.");
    }
    parsedUrl = parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Vendor link")) throw error;
    throw new Error("Vendor link must be a valid URL.", { cause: error });
  }

  const org = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [input.orgId, input.userId],
  );
  const isAdmin = org.rows[0]?.role === "owner" || org.rows[0]?.role === "admin";

  const existing = await client.query<{
    status: OrderStatus;
    requestedBy: string;
    buyerUserId: string | null;
  }>(
    `SELECT status, requested_by AS "requestedBy", buyer_user_id AS "buyerUserId"
     FROM purchase_requests WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Purchase request not found");
  if (row.status !== "approved" && row.status !== "ordered") {
    throw new Error("Product URL can only be updated on approved or ordered requests");
  }

  const canEdit =
    isAdmin ||
    row.buyerUserId === input.userId ||
    (!row.buyerUserId && row.requestedBy === input.userId);
  if (!canEdit) throw new Error("Only the assigned buyer, requester, or an admin can set the buy link");

  await client.query(
    `UPDATE purchase_requests SET item_url = $3, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId, parsedUrl],
  );
}

export async function assignBuyer(
  client: PoolClient,
  input: { orgId: string; userId: string; orderId: string; buyerUserId: string },
): Promise<void> {
  await assertAdmin(client, input.orgId, input.userId);
  await assertBuyerMember(client, input.orgId, input.buyerUserId);

  const existing = await client.query<{ status: OrderStatus; title: string; buyerUserId: string | null }>(
    `SELECT status, title, buyer_user_id AS "buyerUserId"
     FROM purchase_requests WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Purchase request not found");
  if (row.status !== "approved" && row.status !== "ordered") {
    throw new Error("Buyer can only be assigned on approved or ordered requests");
  }
  if (row.buyerUserId === input.buyerUserId) return;

  await client.query(
    `UPDATE purchase_requests SET buyer_user_id = $3::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId, input.buyerUserId],
  );

  await notifyBuyerAssigned(client, {
    orgId: input.orgId,
    buyerUserId: input.buyerUserId,
    orderId: input.orderId,
    title: row.title,
  });
}

async function assertCanProgress(
  client: PoolClient,
  input: { orgId: string; userId: string; isAdmin: boolean; order: OrderRow },
): Promise<void> {
  if (input.isAdmin) return;
  const isBuyer = input.order.buyerUserId === input.userId;
  const isRequesterFallback =
    !input.order.buyerUserId && input.order.requestedBy === input.userId;
  if (isBuyer || isRequesterFallback) return;
  throw new Error("Only the assigned buyer, requester, or an admin can update order progress");
}

export async function progressOrder(
  client: PoolClient,
  input: { orgId: string; userId: string; orderId: string; status: "ordered" | "received" },
): Promise<void> {
  await assertMember(client, input.orgId, input.userId);

  const org = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [input.orgId, input.userId],
  );
  const isAdmin = org.rows[0]?.role === "owner" || org.rows[0]?.role === "admin";

  const existing = await client.query<OrderRow>(
    `SELECT
       p.id,
       p.season_year AS "seasonYear",
       p.title,
       p.justification,
       p.vendor,
       p.item_url AS "itemUrl",
       p.quantity,
       p.unit_cost_usd AS "unitCostUsd",
       p.total_cost_usd AS "totalCostUsd",
       p.status,
       p.needed_by::text AS "neededBy",
       p.requested_by AS "requestedBy",
       NULL::text AS "requestedByName",
       p.reviewed_by AS "reviewedBy",
       p.reviewed_at::text AS "reviewedAt",
       p.review_notes AS "reviewNotes",
       p.buyer_user_id AS "buyerUserId",
       NULL::text AS "buyerName",
       p.ordered_at::text AS "orderedAt",
       p.received_at::text AS "receivedAt",
       p.created_at::text AS "createdAt",
       p.updated_at::text AS "updatedAt"
     FROM purchase_requests p
     WHERE p.id = $1::uuid AND p.org_id = $2::uuid`,
    [input.orderId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("Purchase request not found");
  if (!canTransitionOrder(row.status, input.status)) {
    throw new Error(`Cannot move a ${row.status} request to ${input.status}`);
  }

  await assertCanProgress(client, { orgId: input.orgId, userId: input.userId, isAdmin, order: row });

  await client.query(
    `UPDATE purchase_requests SET
       status = $3::purchase_request_status,
       ordered_at = CASE WHEN $3 = 'ordered' THEN now() ELSE ordered_at END,
       received_at = CASE WHEN $3 = 'received' THEN now() ELSE received_at END,
       updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.orderId, input.orgId, input.status],
  );
}
