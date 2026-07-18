// Pure consumables/reorder rollups. Deterministic given its input.

import type { Consumable, ConsumableCategory, ConsumableEvaluation, ConsumableStatus, SparesSummary } from "./types";

const CATEGORY_ORDER: ConsumableCategory[] = [
  "fasteners",
  "electrical",
  "pneumatics",
  "adhesives",
  "stock",
  "tools",
  "ppe",
  "other",
];

export function consumableCategoryLabel(category: ConsumableCategory): string {
  const labels: Record<ConsumableCategory, string> = {
    fasteners: "Fasteners",
    electrical: "Electrical",
    pneumatics: "Pneumatics",
    adhesives: "Adhesives",
    stock: "Raw stock",
    tools: "Tool consumables",
    ppe: "PPE",
    other: "Other",
  };
  return labels[category];
}

export function statusLabel(status: ConsumableStatus): string {
  return status === "ok" ? "OK" : status === "low" ? "Low" : "Out";
}

export function evaluateConsumable(item: Consumable): ConsumableEvaluation {
  const onHand = Math.max(0, item.onHand || 0);
  const reorderPoint = Math.max(0, item.reorderPoint || 0);
  let status: ConsumableStatus;
  if (onHand <= 0) status = "out";
  else if (reorderPoint > 0 && onHand <= reorderPoint) status = "low";
  else status = "ok";
  return { item, status, needsReorder: status !== "ok" };
}

/** Urgency for the reorder list: lower ratio = more urgent (0 = out of stock). */
function urgency(item: Consumable): number {
  const reorderPoint = Math.max(1, item.reorderPoint || 0);
  return Math.max(0, item.onHand || 0) / reorderPoint;
}

export function summarizeSpares(items: Consumable[]): SparesSummary {
  const evaluations = items.map(evaluateConsumable);
  let ok = 0;
  let low = 0;
  let out = 0;
  for (const e of evaluations) {
    if (e.status === "ok") ok += 1;
    else if (e.status === "low") low += 1;
    else out += 1;
  }

  const catMap = new Map<ConsumableCategory, { total: number; needsReorder: number }>();
  for (const e of evaluations) {
    const entry = catMap.get(e.item.category) ?? { total: 0, needsReorder: 0 };
    entry.total += 1;
    if (e.needsReorder) entry.needsReorder += 1;
    catMap.set(e.item.category, entry);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, value]) => ({ category, total: value.total, needsReorder: value.needsReorder }))
    .sort(
      (a, b) => b.needsReorder - a.needsReorder || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
    );

  const reorderList = evaluations
    .filter((e) => e.needsReorder)
    .sort((a, b) => urgency(a.item) - urgency(b.item) || a.item.name.localeCompare(b.item.name));

  return { total: items.length, ok, low, out, byCategory, reorderList };
}

/** Display sort: needs-reorder first (out, then low), then name. */
export function sortSpares(items: Consumable[]): Consumable[] {
  const rank = (item: Consumable) => {
    const e = evaluateConsumable(item);
    return e.status === "out" ? 0 : e.status === "low" ? 1 : 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
