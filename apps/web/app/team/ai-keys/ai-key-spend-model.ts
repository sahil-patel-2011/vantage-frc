/*
  One AI key's spend this calendar month against its own limit (0736).

  Spend is what the usage rows this key served cost, summed since the 1st of the month. A
  personal key is the member's own money and never counts toward the team's totals; a team key
  is the team's. No limit means unlimited. At or over the limit, Ask AI skips the key until the
  month turns and the next key in line (or the team's connection) answers instead.
*/

export type KeySpend = {
  /** USD spent this month, as the API sends it (numeric text). */
  monthSpendUsd?: string | number | null;
  /** USD limit for the month, or null / absent for unlimited. */
  monthlyLimitUsd?: string | number | null;
};

export type KeySpendView = {
  spent: number;
  limit: number | null;
  spentText: string;
  limitText: string;
  /** Spent as a share of the limit, rounded; null when unlimited. Can pass 100. */
  percent: number | null;
  /** Width of the bar, 0–100. */
  barPercent: number;
  reached: boolean;
  /** "low" under 75%, "high" from 75%, "full" at the limit. */
  level: "low" | "high" | "full";
};

function amount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function describeKeySpend(row: KeySpend): KeySpendView {
  const spent = amount(row.monthSpendUsd) ?? 0;
  const limit = amount(row.monthlyLimitUsd);
  if (limit === null) {
    return { spent, limit, spentText: formatUsd(spent), limitText: "Unlimited", percent: null, barPercent: 0, reached: false, level: "low" };
  }
  const reached = spent >= limit;
  const percent = limit > 0 ? Math.round((spent / limit) * 100) : 100;
  const barPercent = Math.min(100, Math.max(0, limit > 0 ? (spent / limit) * 100 : 100));
  return {
    spent,
    limit,
    spentText: formatUsd(spent),
    limitText: formatUsd(limit),
    percent,
    barPercent,
    reached,
    level: reached ? "full" : percent >= 75 ? "high" : "low",
  };
}

/** The 1st of next month, when a key that reached its limit is used again. */
export function limitResetsOn(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
