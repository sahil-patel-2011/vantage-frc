/** Soft-UI purchase / ordering requests. No card or bank fields — ever. */

export const ORDER_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "ordered",
  "received",
  "reimbursed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderMember = {
  userId: string;
  name: string;
  role: string;
};

export type OrderRequest = {
  id: string;
  seasonYear: number;
  title: string;
  justification: string | null;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: number;
  totalCostUsd: number;
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
};

export type OrderMetrics = {
  pending: number;
  approved: number;
  readyToBuy: number;
  ordered: number;
  received: number;
  rejected: number;
  openTotalUsd: number;
  minePending: number;
  mineToBuy: number;
};

/** Deterministic finance-assistant blurb for open requests (opt-in only). */
export type OrderAiSummary = {
  headline: string;
  recommendations: string[];
  openCount: number;
  openTotalUsd: number;
};

export type OrdersSetupStep = { id: string; label: string; detail: string; href: string };

/** Client-safe view shape returned by /api/orders (no server imports). */
export type OrdersView =
  | {
      status: "setup_required";
      message: string;
      steps: OrdersSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      currentUserId: string;
      isAdmin: boolean;
      orders: OrderRequest[];
      members: OrderMember[];
      metrics: OrderMetrics;
      financeAiEnabled: boolean;
      aiSummary: OrderAiSummary | null;
      focusOrderId: string | null;
      computedAt: string;
    };

