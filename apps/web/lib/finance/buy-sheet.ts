/**
 * Shared buy-sheet gate for finance purchase requests and orders submit:
 * what (title), why (justification), when (neededBy), cost (positive USD).
 */

export type BuySheet = {
  title: string;
  justification: string;
  /** YYYY-MM-DD, or null when "when" was left blank. */
  neededBy: string | null;
  costUsd: number;
};

export const TITLE_REQUIRED = "What you need is required.";
export const JUSTIFICATION_REQUIRED = "Why you need it is required.";
export const NEEDED_BY_INVALID = "Needed by must be a date (YYYY-MM-DD).";
export const COST_REQUIRED = "Cost is required.";
export const COST_POSITIVE = "Cost must be a positive dollar amount.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function requiredText(value: unknown, error: string): Result<string> {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: false, error };
  return { ok: true, value: text };
}

function parseNeededBy(value: unknown): Result<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: NEEDED_BY_INVALID };
  const neededBy = value.trim();
  if (!neededBy) return { ok: true, value: null };
  if (!ISO_DATE.test(neededBy)) return { ok: false, error: NEEDED_BY_INVALID };
  return { ok: true, value: neededBy };
}

function parsePositiveUsd(value: unknown): Result<number> {
  if (value === undefined || value === null || value === "") {
    return { ok: false, error: COST_REQUIRED };
  }
  if (typeof value === "string" && value.trim() === "") {
    return { ok: false, error: COST_REQUIRED };
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || Math.round(amount * 100) <= 0) {
    return { ok: false, error: COST_POSITIVE };
  }
  return { ok: true, value: Math.round(amount * 100) / 100 };
}

/**
 * Validate the four buy-sheet fields. Accepts finance (`unitCostUsd`, `neededBy`)
 * and orders (`estimateUsd`) aliases in addition to `title` / `justification` / `costUsd`.
 */
export function validateBuySheet(input: Record<string, unknown>): Result<BuySheet> {
  const title = requiredText(firstDefined(input.title, input.what), TITLE_REQUIRED);
  if (!title.ok) return title;

  const justification = requiredText(firstDefined(input.justification, input.why), JUSTIFICATION_REQUIRED);
  if (!justification.ok) return justification;

  const neededBy = parseNeededBy(firstDefined(input.neededBy, input.needed_by, input.when));
  if (!neededBy.ok) return neededBy;

  const costUsd = parsePositiveUsd(firstDefined(input.costUsd, input.cost, input.estimateUsd, input.unitCostUsd));
  if (!costUsd.ok) return costUsd;

  return {
    ok: true,
    value: {
      title: title.value,
      justification: justification.value,
      neededBy: neededBy.value,
      costUsd: costUsd.value,
    },
  };
}
