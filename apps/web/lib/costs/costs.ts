// Pure cost/budget aggregation + the automated finance assistant. Deterministic given its
// input. Nothing here contacts an LLM or leaves the team's data — it's rule-based analysis of
// the numbers, gated by the org's opt-in. Money is handled in whole cents internally to avoid
// float drift, then surfaced as rounded dollars.

import type {
  BudgetInsight,
  CategoryBreakdown,
  CostCategory,
  CostSummary,
  SeasonBudget,
  SeasonCost,
} from "./types";

const CATEGORY_ORDER: CostCategory[] = [
  "registration",
  "event_fee",
  "parts",
  "materials",
  "tools",
  "travel",
  "marketing",
  "safety",
  "field",
  "other",
];

const FEE_CATEGORIES: ReadonlySet<CostCategory> = new Set<CostCategory>(["registration", "event_fee"]);

const cents = (usd: number) => Math.round((Number.isFinite(usd) ? usd : 0) * 100);
const dollars = (c: number) => Math.round(c) / 100;

export function costCategoryLabel(category: CostCategory): string {
  const labels: Record<CostCategory, string> = {
    registration: "Season registration",
    event_fee: "Event fees",
    parts: "Parts & COTS",
    materials: "Raw materials",
    tools: "Tools & shop",
    travel: "Travel & lodging",
    marketing: "Marketing & outreach",
    safety: "Safety & PPE",
    field: "Field & practice",
    other: "Other",
  };
  return labels[category];
}

export function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function monthOf(iso: string): string | null {
  const month = typeof iso === "string" ? iso.slice(0, 7) : "";
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

export function summarizeCosts(costs: SeasonCost[], budgetUsd: number | null): CostSummary {
  const catMap = new Map<CostCategory, { committed: number; paid: number; planned: number; count: number }>();
  const monthMap = new Map<string, number>();
  let totalPaid = 0;
  let totalPlanned = 0;
  let feesTotal = 0;

  for (const cost of costs) {
    const amount = cents(cost.amountUsd);
    if (cost.status === "paid") totalPaid += amount;
    else totalPlanned += amount;
    if (FEE_CATEGORIES.has(cost.category)) feesTotal += amount;

    const entry = catMap.get(cost.category) ?? { committed: 0, paid: 0, planned: 0, count: 0 };
    entry.committed += amount;
    if (cost.status === "paid") entry.paid += amount;
    else entry.planned += amount;
    entry.count += 1;
    catMap.set(cost.category, entry);

    const month = monthOf(cost.incurredOn);
    if (month) monthMap.set(month, (monthMap.get(month) ?? 0) + amount);
  }

  const totalCommitted = totalPaid + totalPlanned;

  const byCategory: CategoryBreakdown[] = [...catMap.entries()]
    .map(([category, value]) => ({
      category,
      committed: dollars(value.committed),
      paid: dollars(value.paid),
      planned: dollars(value.planned),
      count: value.count,
    }))
    .sort(
      (a, b) => b.committed - a.committed || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
    );

  const byMonth = [...monthMap.entries()]
    .map(([month, value]) => ({ month, committed: dollars(value) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const largest = byCategory[0];
  const budgetCents = budgetUsd == null ? null : cents(budgetUsd);

  return {
    count: costs.length,
    totalCommitted: dollars(totalCommitted),
    totalPaid: dollars(totalPaid),
    totalPlanned: dollars(totalPlanned),
    feesTotal: dollars(feesTotal),
    byCategory,
    byMonth,
    largestCategory: largest ? { category: largest.category, committed: largest.committed } : null,
    remaining: budgetCents == null ? null : dollars(budgetCents - totalCommitted),
    pctUsed: budgetCents == null || budgetCents === 0 ? null : Math.round((totalCommitted / budgetCents) * 1000) / 1000,
    overBudget: budgetCents != null && totalCommitted > budgetCents,
  };
}

/**
 * The opt-in automated finance assistant. Turns the summary into a status + plain-language
 * guidance to keep the team under budget. Rule-based and local — honest about what it is.
 */
export function budgetInsights(summary: CostSummary, budget: SeasonBudget): BudgetInsight {
  if (budget.totalBudgetUsd == null) {
    return {
      status: "unset",
      headline: "Set a season budget to start tracking against it.",
      recommendations: [
        "Enter your total season budget above so the assistant can flag overspend before it happens.",
        summary.byCategory.some((c) => c.category === "registration")
          ? "Registration is logged — add event fees and expected purchases to complete the picture."
          : "Add your FRC season registration first — it is usually the single largest fixed cost.",
      ],
    };
  }

  const budgetUsd = budget.totalBudgetUsd;
  const remaining = summary.remaining ?? budgetUsd;
  const pct = summary.pctUsed ?? 0;
  const recommendations: string[] = [];

  let status: BudgetInsight["status"] = "healthy";
  let headline: string;

  if (summary.overBudget) {
    status = "over";
    const over = summary.totalCommitted - budgetUsd;
    headline = `Over budget by ${usd(over)} — ${usd(summary.totalCommitted)} committed against a ${usd(budgetUsd)} budget.`;
    recommendations.push(
      `Trim or defer ${usd(over)} of planned costs. Largest category is ${
        summary.largestCategory ? costCategoryLabel(summary.largestCategory.category) : "n/a"
      }${summary.largestCategory ? ` (${usd(summary.largestCategory.committed)})` : ""}.`,
    );
  } else if (pct >= 0.85) {
    status = "watch";
    headline = `${Math.round(pct * 100)}% of budget committed — ${usd(remaining)} left.`;
    recommendations.push(`Only ${usd(remaining)} remains; reserve it for must-pay fees and hold discretionary buys.`);
  } else {
    headline = `On track — ${usd(summary.totalCommitted)} of ${usd(budgetUsd)} committed (${usd(remaining)} left).`;
  }

  // Planned costs that would blow the remaining budget.
  if (!summary.overBudget && summary.totalPlanned > remaining && summary.totalPlanned > 0) {
    const gap = summary.totalPlanned - remaining;
    recommendations.push(
      `Planned (unpaid) costs total ${usd(summary.totalPlanned)} but only ${usd(remaining)} is left — a ${usd(gap)} gap once they are paid.`,
    );
  }

  // Missing the big fixed fees.
  const hasRegistration = summary.byCategory.some((c) => c.category === "registration");
  const hasEventFees = summary.byCategory.some((c) => c.category === "event_fee");
  if (!hasRegistration) {
    recommendations.push("No season registration logged yet — add it so the budget reflects your largest fixed cost.");
  } else if (!hasEventFees) {
    recommendations.push("No event fees logged — add each event registration so nothing surprises the budget.");
  }

  // Category concentration.
  if (summary.largestCategory && summary.totalCommitted > 0) {
    const share = summary.largestCategory.committed / summary.totalCommitted;
    if (share >= 0.5) {
      recommendations.push(
        `${costCategoryLabel(summary.largestCategory.category)} is ${Math.round(share * 100)}% of spend — check it for savings first.`,
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("Healthy margin — keep logging purchases so the running total stays accurate.");
  }

  return { status, headline, recommendations };
}
