export const PURCHASE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "ordered",
  "received",
  "reimbursed",
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

const STATUS_TRANSITIONS: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["ordered", "rejected"],
  rejected: [],
  ordered: ["received"],
  received: ["reimbursed"],
  reimbursed: [],
};

export function canTransitionPurchaseRequest(from: PurchaseRequestStatus, to: PurchaseRequestStatus) {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export type PurchaseRequestInput = {
  title: string;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: number;
  justification: string | null;
};

export function validatePurchaseRequestInput(
  input: Record<string, unknown>,
): { ok: true; value: PurchaseRequestInput & { totalCostUsd: number } } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1)
    return { ok: false, error: "Quantity must be a positive whole number" };
  const unitCostUsd = Number(input.unitCostUsd);
  if (!Number.isFinite(unitCostUsd) || unitCostUsd < 0)
    return { ok: false, error: "Unit cost must be zero or greater" };
  const itemUrl = typeof input.itemUrl === "string" ? input.itemUrl.trim() : "";
  if (itemUrl) {
    try {
      new URL(itemUrl);
    } catch {
      return { ok: false, error: "Item URL must be a valid URL" };
    }
  }
  const vendor = typeof input.vendor === "string" ? input.vendor.trim() : "";
  const justification = typeof input.justification === "string" ? input.justification.trim() : "";
  return {
    ok: true,
    value: {
      title,
      vendor: vendor || "amazon",
      itemUrl: itemUrl || null,
      quantity,
      unitCostUsd,
      justification: justification || null,
      totalCostUsd: round2(quantity * unitCostUsd),
    },
  };
}

export type FinanceTxn = { type: "income" | "expense"; amountUsd: number; occurredAt: string };

export function monthKey(isoDate: string) {
  return isoDate.slice(0, 7);
}

export function summarizeMonthlyBudget(params: {
  transactions: FinanceTxn[];
  monthlyLimitUsd?: number | null;
  totalLimitUsd?: number | null;
}) {
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const txn of params.transactions) {
    const key = monthKey(txn.occurredAt);
    const bucket = byMonth.get(key) ?? { income: 0, expense: 0 };
    if (txn.type === "income") bucket.income += txn.amountUsd;
    else bucket.expense += txn.amountUsd;
    byMonth.set(key, bucket);
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { income, expense }]) => ({
      month,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
      overMonthlyLimit: params.monthlyLimitUsd != null && expense > params.monthlyLimitUsd,
    }));
  const totalIncome = round2(
    params.transactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amountUsd, 0),
  );
  const totalExpense = round2(
    params.transactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amountUsd, 0),
  );
  return {
    byMonth: months,
    totalIncome,
    totalExpense,
    net: round2(totalIncome - totalExpense),
    remaining: params.totalLimitUsd != null ? round2(params.totalLimitUsd - totalExpense) : null,
    overTotalLimit: params.totalLimitUsd != null && totalExpense > params.totalLimitUsd,
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
