// Pure, framework-free spare-robot-kit math. Everything here is deterministic and grounded only
// in the numbers the caller supplies (inventory quantity on hand, FMEA repeat-failure count and
// severity for the matched subsystem) — it never fabricates a value. compute-spare-robot-kit.ts
// wraps this with DB I/O; the API route and client render the results and let a team generate
// and pack from a checklist.

import type { KitChecklistItem, KitPriority, SpareKitBin, SubsystemFailureAggregate } from "./types";

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** RPN (occurrence x severity x detection) is 1..1000. Bucket into pack priority. */
export function priorityForRpn(avgRpn: number): KitPriority {
  if (avgRpn >= 150) return "critical";
  if (avgRpn >= 60) return "recommended";
  return "optional";
}

/** Recommend enough spares to cover roughly half of this season's repeat-failure count, at least one. */
export function recommendedQtyFor(failureCount: number): number {
  return Math.max(1, Math.ceil(Math.max(0, failureCount) / 2));
}

export function priorityLabel(priority: KitPriority): string {
  switch (priority) {
    case "critical":
      return "Critical";
    case "recommended":
      return "Recommended";
    default:
      return "Optional";
  }
}

const PRIORITY_RANK: Record<KitPriority, number> = { critical: 0, recommended: 1, optional: 2 };

export function sortKitItems(items: KitChecklistItem[]): KitChecklistItem[] {
  return [...items].sort((a, b) => {
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;
    return b.failureCount - a.failureCount;
  });
}

/**
 * Build checklist candidate items by cross-referencing inventory spare bins against FMEA
 * repeat-failure aggregates for the matched subsystem. A bin with no matched FMEA history is
 * skipped — never fabricate a priority or rationale for it.
 */
export function buildKitItems(bins: SpareKitBin[], aggregates: SubsystemFailureAggregate[]): KitChecklistItem[] {
  const bySubsystem = new Map<string, SubsystemFailureAggregate>();
  for (const aggregate of aggregates) {
    bySubsystem.set(aggregate.subsystemName.trim().toLowerCase(), aggregate);
  }

  const items: KitChecklistItem[] = [];
  for (const bin of bins) {
    const key = (bin.subsystem ?? "").trim().toLowerCase();
    const aggregate = key ? bySubsystem.get(key) : undefined;
    if (!aggregate || aggregate.failureCount <= 0) continue;

    const priority = priorityForRpn(aggregate.avgRpn);
    const recommendedQty = recommendedQtyFor(aggregate.failureCount);
    const shortfall = Math.max(0, recommendedQty - bin.quantityOnHand);

    items.push({
      itemId: bin.id,
      itemName: bin.name,
      category: bin.category,
      subsystem: bin.subsystem,
      quantityOnHand: bin.quantityOnHand,
      unitCost: bin.unitCost,
      failureCount: aggregate.failureCount,
      avgRpn: round(aggregate.avgRpn, 1),
      recommendedQty,
      priority,
      rationale:
        `${aggregate.failureCount} FMEA failure(s) on ${bin.subsystem ?? "this subsystem"} this season ` +
        `(avg RPN ${round(aggregate.avgRpn, 1)}) recommend packing ${recommendedQty}; ${bin.quantityOnHand} on hand` +
        (shortfall > 0 ? `, ${shortfall} short of the recommended count` : "."),
      packed: false,
    });
  }
  return sortKitItems(items);
}

export function summarizeChecklistItems(items: KitChecklistItem[]): { packedCount: number; totalCount: number } {
  return { packedCount: items.filter((item) => item.packed).length, totalCount: items.length };
}

/** Deterministic rationale for a freshly generated checklist, grounded only in the built items. */
export function checklistRationale(items: KitChecklistItem[]): string {
  if (items.length === 0) {
    return "No spare bins currently match a subsystem with logged FMEA failures — nothing to pack yet.";
  }
  const critical = items.filter((item) => item.priority === "critical").length;
  const recommended = items.filter((item) => item.priority === "recommended").length;
  return (
    `${items.length} spare(s) matched to FMEA repeat-failure history` +
    (critical ? ` · ${critical} critical` : "") +
    (recommended ? ` · ${recommended} recommended` : "") +
    "."
  );
}
