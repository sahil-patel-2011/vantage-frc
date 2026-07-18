// Pure, framework-free reorder-by-date math. Everything here is deterministic and grounded only
// in the numbers/dates the caller supplies (needed-by date, vendor lead time, safety buffer,
// "as of" date) — it never fabricates a value. compute-vendor-lead-times.ts wraps this with DB
// I/O; the API route and client render the results and let a team log/track reorders.

import type { ReorderByDateCalc, ReorderLine, ReorderStatus, ReorderSummary, ReorderUrgency } from "./types";

/** A reorder is flagged "due soon" once its order-by date is within this many days. */
export const DUE_SOON_WINDOW_DAYS = 5;

function parseIsoDate(value: string): number {
  const [y, m, d] = value.split("-").map((part) => Number(part));
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function startOfDayUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function urgencyFor(status: ReorderStatus, daysUntilOrderBy: number): ReorderUrgency {
  if (status !== "open") return "resolved";
  if (daysUntilOrderBy < 0) return "overdue";
  if (daysUntilOrderBy <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "ok";
}

/**
 * Compute the latest date an order must be placed to arrive by `neededBy`, given a vendor's
 * lead time and safety buffer, and how many days remain (from `asOf`) until that order-by date.
 */
export function computeReorderByDate(
  input: { neededBy: string; leadTimeDays: number; safetyBufferDays: number; status: ReorderStatus },
  asOf: Date = new Date(),
): ReorderByDateCalc {
  const neededByMs = parseIsoDate(input.neededBy);
  const leadTimeDays = Math.max(0, Math.round(input.leadTimeDays));
  const safetyBufferDays = Math.max(0, Math.round(input.safetyBufferDays));
  const orderByMs = neededByMs - (leadTimeDays + safetyBufferDays) * 86_400_000;
  const todayMs = startOfDayUtc(asOf);
  const daysUntilOrderBy = Math.round((orderByMs - todayMs) / 86_400_000);

  return {
    orderByDate: toIsoDate(orderByMs),
    daysUntilOrderBy,
    urgency: urgencyFor(input.status, daysUntilOrderBy),
  };
}

export function summarizeReorders(lines: ReorderLine[]): ReorderSummary {
  const open = lines.filter((line) => line.status === "open");
  return {
    totalOpen: open.length,
    overdueCount: open.filter((line) => line.calc.urgency === "overdue").length,
    dueSoonCount: open.filter((line) => line.calc.urgency === "due_soon").length,
    okCount: open.filter((line) => line.calc.urgency === "ok").length,
  };
}

const URGENCY_RANK: Record<ReorderUrgency, number> = { overdue: 0, due_soon: 1, ok: 2, resolved: 3 };

export function sortReorderLines(lines: ReorderLine[]): ReorderLine[] {
  return [...lines].sort((a, b) => {
    const rank = URGENCY_RANK[a.calc.urgency] - URGENCY_RANK[b.calc.urgency];
    if (rank !== 0) return rank;
    return a.calc.daysUntilOrderBy - b.calc.daysUntilOrderBy;
  });
}

export function reorderStatusLabel(status: ReorderStatus): string {
  switch (status) {
    case "ordered":
      return "Ordered";
    case "received":
      return "Received";
    case "cancelled":
      return "Cancelled";
    default:
      return "Open";
  }
}

export function reorderUrgencyLabel(urgency: ReorderUrgency): string {
  switch (urgency) {
    case "overdue":
      return "Overdue";
    case "due_soon":
      return "Due soon";
    case "resolved":
      return "Resolved";
    default:
      return "On track";
  }
}

export * from "./types";
