// Pure helper functions for FRC Parts relay — labels and summary math. No I/O.

import type {
  PartsRelayCategory,
  PartsRelayCondition,
  PartsRelayListing,
  PartsRelayLoan,
  PartsRelayLoanStatus,
  PartsRelaySummary,
} from "./types";

export * from "./types";

const CATEGORY_LABELS: Record<PartsRelayCategory, string> = {
  electrical: "Electrical",
  mechanical: "Mechanical",
  pneumatic: "Pneumatic",
  electronics: "Electronics",
  fasteners: "Fasteners",
  battery: "Battery",
  wheels: "Wheels",
  other: "Other",
};

const CONDITION_LABELS: Record<PartsRelayCondition, string> = {
  new: "New",
  used: "Used",
  any: "Any condition",
};

export function partsRelayCategoryLabel(category: PartsRelayCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function partsRelayConditionLabel(condition: PartsRelayCondition): string {
  return CONDITION_LABELS[condition] ?? condition;
}

/**
 * A loan is treated as overdue when it has a due date in the past, hasn't been returned,
 * and isn't already marked lost. This is a display-time derivation — it never mutates
 * the stored status, so a team can still see "active" loans distinctly from those flagged.
 */
export function deriveLoanStatus(
  loan: Pick<PartsRelayLoan, "status" | "dueBackOn" | "returnedOn">,
  today: string = new Date().toISOString().slice(0, 10),
): PartsRelayLoanStatus {
  if (loan.status === "returned" || loan.status === "lost") return loan.status;
  if (loan.dueBackOn && !loan.returnedOn && loan.dueBackOn < today) return "overdue";
  return loan.status;
}

/** Summarizes listings + loans into board-level counts. Skips nothing — every row counts once. */
export function summarizePartsRelay(
  listings: PartsRelayListing[],
  loans: PartsRelayLoan[],
  today: string = new Date().toISOString().slice(0, 10),
): PartsRelaySummary {
  const openNeeds = listings.filter((l) => l.listingType === "need" && l.status === "open").length;
  const openOffers = listings.filter((l) => l.listingType === "offer" && l.status === "open").length;

  const effectiveStatuses = loans.map((loan) => deriveLoanStatus(loan, today));

  const activeLoans = effectiveStatuses.filter((s) => s === "active").length;
  const overdueLoans = effectiveStatuses.filter((s) => s === "overdue").length;
  const returnedLoans = effectiveStatuses.filter((s) => s === "returned").length;
  const lostLoans = effectiveStatuses.filter((s) => s === "lost").length;
  const lendingCount = loans.filter((l) => l.direction === "lending").length;
  const borrowingCount = loans.filter((l) => l.direction === "borrowing").length;

  const returned = loans.filter((loan) => loan.returnedOn != null);
  const onTime = returned.filter((loan) => !loan.dueBackOn || loan.returnedOn! <= loan.dueBackOn);
  const onTimeReturnRate = returned.length > 0 ? Math.round((onTime.length / returned.length) * 1000) / 1000 : null;

  return {
    openNeeds,
    openOffers,
    activeLoans,
    overdueLoans,
    returnedLoans,
    lostLoans,
    totalLoans: loans.length,
    lendingCount,
    borrowingCount,
    onTimeReturnRate,
  };
}
