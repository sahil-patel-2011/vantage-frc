// Pure, framework-free BOM cost math. Everything here is deterministic and grounded only in the
// line items and budget the caller supplies — it never fabricates a value.
// compute-bom-cost-rollup.ts wraps this with DB I/O; the API route and client render results.

import type {
  BomCategory,
  BomCategoryRollup,
  BomLineItem,
  BomRollupSummary,
  BomSource,
  BomStatus,
  BomSubsystemRollup,
} from "./types";

/** Above this fraction of budget consumed, status flips from "under" to "near". */
export const NEAR_BUDGET_THRESHOLD_PCT = 0.9;

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function bomCategoryLabel(category: BomCategory): string {
  switch (category) {
    case "purchased":
      return "Purchased part";
    case "raw_material":
      return "Raw material";
    case "fastener":
      return "Fastener";
    case "electronics":
      return "Electronics";
    default:
      return "Other";
  }
}

export function bomSourceLabel(source: BomSource): string {
  return source === "cad_import" ? "CAD import" : "Manual entry";
}

export function bomStatusLabel(status: BomStatus): string {
  switch (status) {
    case "over":
      return "Over budget";
    case "near":
      return "Near budget";
    default:
      return "Under budget";
  }
}

function statusFor(percentUsed: number, budgetUsd: number): BomStatus {
  if (budgetUsd <= 0) return "under";
  if (percentUsed > 1) return "over";
  if (percentUsed >= NEAR_BUDGET_THRESHOLD_PCT) return "near";
  return "under";
}

/** Roll a set of BOM line items up against a season budget. Deterministic, no fabricated rows. */
export function summarizeBom(items: BomLineItem[], budgetUsd: number): BomRollupSummary {
  const budget = Math.max(0, budgetUsd);
  const totalCostUsd = round(items.reduce((sum, item) => sum + item.lineTotalUsd, 0));
  const remainingUsd = round(budget - totalCostUsd);
  const percentUsed = budget > 0 ? round(totalCostUsd / budget, 4) : null;
  const status = statusFor(percentUsed ?? 0, budget);

  const subsystemMap = new Map<string, BomSubsystemRollup>();
  const categoryMap = new Map<BomCategory, BomCategoryRollup>();
  for (const item of items) {
    const subsystemEntry = subsystemMap.get(item.subsystem) ?? {
      subsystem: item.subsystem,
      totalUsd: 0,
      itemCount: 0,
    };
    subsystemEntry.totalUsd = round(subsystemEntry.totalUsd + item.lineTotalUsd);
    subsystemEntry.itemCount += 1;
    subsystemMap.set(item.subsystem, subsystemEntry);

    const categoryEntry = categoryMap.get(item.category) ?? {
      category: item.category,
      totalUsd: 0,
      itemCount: 0,
    };
    categoryEntry.totalUsd = round(categoryEntry.totalUsd + item.lineTotalUsd);
    categoryEntry.itemCount += 1;
    categoryMap.set(item.category, categoryEntry);
  }

  return {
    totalCostUsd,
    budgetUsd: round(budget),
    remainingUsd,
    percentUsed,
    status,
    itemCount: items.length,
    bySubsystem: Array.from(subsystemMap.values()).sort((a, b) => b.totalUsd - a.totalUsd),
    byCategory: Array.from(categoryMap.values()).sort((a, b) => b.totalUsd - a.totalUsd),
  };
}
