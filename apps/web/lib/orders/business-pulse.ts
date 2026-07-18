import type { OrdersPulse, PurchaseRequest } from "../business-portal";
import { summarizeOpenOrders } from "./evaluate";
import type { OrderRequest, OrderStatus } from "./types";

function purchaseToOrder(purchase: PurchaseRequest, seasonYear: number): OrderRequest {
  const statusMap: Record<PurchaseRequest["status"], OrderStatus> = {
    submitted: "pending",
    approved: "approved",
    ordered: "ordered",
    received: "received",
    rejected: "rejected",
  };
  return {
    id: purchase.id,
    seasonYear,
    title: purchase.itemName,
    justification: purchase.purpose,
    vendor: purchase.vendor,
    itemUrl: purchase.itemUrl,
    quantity: purchase.quantity,
    unitCostUsd: purchase.unitPriceCents / 100,
    totalCostUsd: purchase.totalCents / 100,
    status: statusMap[purchase.status],
    neededBy: purchase.neededBy,
    requestedBy: "",
    requestedByName: purchase.requestedByName,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    buyerUserId: null,
    buyerName: null,
    orderedAt: purchase.orderedOn,
    receivedAt: null,
    createdAt: purchase.requestedAt,
    updatedAt: purchase.requestedAt,
  };
}

/** Map Business portal purchases into the overview orders pulse (+ opt-in finance AI). */
export function buildOrdersPulse(
  purchases: PurchaseRequest[],
  seasonYear: number,
  financeAiEnabled: boolean,
): OrdersPulse {
  const pending = purchases.filter((p) => p.status === "submitted");
  const ready = purchases.filter((p) => p.status === "approved");
  const openTotalCents = [...pending, ...ready].reduce((sum, p) => sum + p.totalCents, 0);
  const ai = financeAiEnabled
    ? summarizeOpenOrders(purchases.map((p) => purchaseToOrder(p, seasonYear)))
    : null;
  return {
    pendingCount: pending.length,
    readyToBuyCount: ready.length,
    openTotalCents,
    financeAiEnabled,
    aiHeadline: ai?.headline ?? null,
    aiRecommendations: ai?.recommendations ?? [],
  };
}
