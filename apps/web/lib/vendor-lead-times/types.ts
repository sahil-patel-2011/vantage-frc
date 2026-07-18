// Vendor lead-time tracker domain types. Pure data shapes — no I/O, no framework imports.
// Two record kinds: a vendor's known lead time (+ safety buffer) for shipping parts, and a
// reorder line naming a "needed by" date. The reorder-by-date calculator subtracts the vendor's
// lead time (and safety buffer) from the needed-by date to tell a team the latest date they can
// still place an order and expect it to arrive in time.

export type ReorderStatus = "open" | "ordered" | "received" | "cancelled";

export type ReorderUrgency = "overdue" | "due_soon" | "ok" | "resolved";

export type VendorLeadTime = {
  id: string;
  name: string;
  leadTimeDays: number;
  safetyBufferDays: number;
  notes: string | null;
  createdAt: string;
};

export type ReorderLine = {
  id: string;
  vendorId: string;
  vendorName: string;
  itemName: string;
  quantity: number;
  neededBy: string;
  status: ReorderStatus;
  notes: string | null;
  createdAt: string;
  calc: ReorderByDateCalc;
};

/** Deterministic reorder-by-date projection, grounded only in the supplied dates and lead time. */
export type ReorderByDateCalc = {
  /** ISO date (YYYY-MM-DD) — the latest date an order should be placed to arrive by neededBy. */
  orderByDate: string;
  /** Days from `asOf` until orderByDate. Negative means the order-by date has already passed. */
  daysUntilOrderBy: number;
  urgency: ReorderUrgency;
};

export type ReorderSummary = {
  totalOpen: number;
  overdueCount: number;
  dueSoonCount: number;
  okCount: number;
};
