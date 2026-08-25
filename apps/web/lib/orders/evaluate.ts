import type { OrderAiSummary, OrderMetrics, OrderRequest, OrderStatus } from "./types";
import { ORDER_STATUSES } from "./types";

export { ORDER_STATUSES };
export type { OrderStatus };

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["ordered", "rejected"],
  rejected: [],
  ordered: ["received"],
  received: ["reimbursed"],
  reimbursed: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Awaiting approval";
    case "approved":
      return "Approved — ready to buy";
    case "rejected":
      return "Rejected";
    case "ordered":
      return "Ordered";
    case "received":
      return "Received";
    case "reimbursed":
      return "Reimbursed";
    default:
      return status;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export type OrderSubmitInput = {
  title: string;
  justification: string;
  estimateUsd: number;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  neededBy: string | null;
};

export function validateOrderSubmit(
  input: Record<string, unknown>,
): { ok: true; value: OrderSubmitInput } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) return { ok: false, error: "What you need is required (max 200 characters)." };

  const justification = typeof input.justification === "string" ? input.justification.trim() : "";
  if (!justification || justification.length > 2000) {
    return { ok: false, error: "Why you need it is required (max 2000 characters)." };
  }

  const quantityRaw = input.quantity === undefined || input.quantity === "" ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > 9999) {
    return { ok: false, error: "Quantity must be a whole number from 1 to 9999." };
  }

  const estimateUsd = Number(input.estimateUsd ?? input.unitCostUsd);
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0 || estimateUsd > 1_000_000) {
    return { ok: false, error: "Estimate must be a non-negative dollar amount." };
  }

  const itemUrlRaw = typeof input.itemUrl === "string" ? input.itemUrl.trim() : "";
  let itemUrl: string | null = null;
  if (itemUrlRaw) {
    try {
      const parsed = new URL(itemUrlRaw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Vendor link must be an http(s) URL." };
      }
      itemUrl = parsed.toString();
    } catch {
      return { ok: false, error: "Vendor link must be a valid URL." };
    }
  }

  const vendor = typeof input.vendor === "string" ? input.vendor.trim().slice(0, 120) : "";
  const neededBy =
    typeof input.neededBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.neededBy.trim())
      ? input.neededBy.trim()
      : null;

  return {
    ok: true,
    value: {
      title: title.slice(0, 200),
      justification: justification.slice(0, 2000),
      estimateUsd: round2(estimateUsd),
      vendor: vendor || "unspecified",
      itemUrl,
      quantity: quantityRaw,
      neededBy,
    },
  };
}

export function unitCostFromEstimate(estimateUsd: number, quantity: number): number {
  if (quantity <= 1) return round2(estimateUsd);
  return round2(estimateUsd / quantity);
}

export function totalFromParts(quantity: number, unitCostUsd: number): number {
  return round2(quantity * unitCostUsd);
}

export function computeOrderMetrics(orders: OrderRequest[], currentUserId: string): OrderMetrics {
  let pending = 0;
  let approved = 0;
  let ordered = 0;
  let received = 0;
  let rejected = 0;
  let openTotalUsd = 0;
  let minePending = 0;
  let mineToBuy = 0;

  for (const order of orders) {
    if (order.status === "pending") {
      pending += 1;
      openTotalUsd += order.totalCostUsd;
      if (order.requestedBy === currentUserId) minePending += 1;
    } else if (order.status === "approved") {
      approved += 1;
      openTotalUsd += order.totalCostUsd;
      if (order.buyerUserId === currentUserId || (!order.buyerUserId && order.requestedBy === currentUserId)) {
        mineToBuy += 1;
      }
    } else if (order.status === "ordered") {
      ordered += 1;
    } else if (order.status === "received" || order.status === "reimbursed") {
      received += 1;
    } else if (order.status === "rejected") {
      rejected += 1;
    }
  }

  return {
    pending,
    approved,
    readyToBuy: approved,
    ordered,
    received,
    rejected,
    openTotalUsd: round2(openTotalUsd),
    minePending,
    mineToBuy,
  };
}

/**
 * Opt-in finance assistant for open purchase requests.
 * Rule-based and local — only call when season_budgets.ai_assist_enabled is true.
 */
export function summarizeOpenOrders(orders: OrderRequest[]): OrderAiSummary {
  const open = orders.filter((o) => o.status === "pending" || o.status === "approved");
  const pending = open.filter((o) => o.status === "pending");
  const approved = open.filter((o) => o.status === "approved");
  const openTotalUsd = round2(open.reduce((sum, o) => sum + o.totalCostUsd, 0));
  const recommendations: string[] = [];

  if (open.length === 0) {
    return {
      headline: "No open purchase requests — nothing waiting on approval or ordering.",
      recommendations: ["When someone submits a need, it will show up here for admin review."],
      openCount: 0,
      openTotalUsd: 0,
    };
  }

  let headline: string;
  if (pending.length && approved.length) {
    headline = `${pending.length} awaiting approval and ${approved.length} ready to buy (${usd(openTotalUsd)} open).`;
  } else if (pending.length) {
    headline = `${pending.length} request${pending.length === 1 ? "" : "s"} awaiting admin approval (${usd(openTotalUsd)}).`;
  } else {
    headline = `${approved.length} approved request${approved.length === 1 ? "" : "s"} ready to order (${usd(openTotalUsd)}).`;
  }

  if (pending.length > 0) {
    const largest = [...pending].sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0]!;
    recommendations.push(
      `Review “${largest.title}” first (${usd(largest.totalCostUsd)}) — largest pending estimate.`,
    );
  }

  const missingLink = approved.filter((o) => !o.itemUrl);
  if (missingLink.length > 0) {
    recommendations.push(
      `${missingLink.length} approved request${missingLink.length === 1 ? "" : "s"} ha${
        missingLink.length === 1 ? "s" : "ve"
      } no vendor link — add a product URL before ordering.`,
    );
  }

  const unassigned = approved.filter((o) => !o.buyerUserId);
  if (unassigned.length > 0) {
    recommendations.push(
      `Assign a buyer on ${unassigned.length} approved request${unassigned.length === 1 ? "" : "s"} so ordering ownership is clear.`,
    );
  }

  const withLinks = approved.filter((o) => o.itemUrl);
  if (withLinks.length > 0) {
    recommendations.push(
      `${withLinks.length} buy link${withLinks.length === 1 ? "" : "s"} ready — open the product URL, place the order outside Vantage, then mark ordered.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("Open requests look complete — approve pending items or mark buys as ordered.");
  }

  return { headline, recommendations, openCount: open.length, openTotalUsd };
}

export function showBuyPanel(status: OrderStatus): boolean {
  return status === "approved" || status === "ordered";
}
