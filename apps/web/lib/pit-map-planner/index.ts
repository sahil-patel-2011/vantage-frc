// Pure helper functions for the Pit Map Planner — unit-testable, no I/O.

import type { PitMapCategoryBreakdown, PitMapItem, PitMapItemCategory, PitMapLayout, PitMapSummary } from "./types";

export const PIT_MAP_CATEGORIES: PitMapItemCategory[] = [
  "workstation",
  "tool_station",
  "power_drop",
  "storage",
  "robot_cart",
  "charging",
  "safety",
  "other",
];

const CATEGORY_LABELS: Record<PitMapItemCategory, string> = {
  workstation: "Workstation",
  tool_station: "Tool station",
  power_drop: "Power drop",
  storage: "Storage",
  robot_cart: "Robot cart",
  charging: "Charging",
  safety: "Safety",
  other: "Other",
};

export function pitMapCategoryLabel(category: PitMapItemCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Summarize placed items against the layout footprint/power budget. Never fabricates data —
 *  an empty item list yields all-zero utilization even with a configured footprint. */
export function summarizePitMap(items: PitMapItem[], layout: PitMapLayout | null): PitMapSummary {
  const footprintAreaSqFt = layout ? round(layout.footprintWidthFt * layout.footprintDepthFt) : 0;
  const usedAreaSqFt = round(items.reduce((sum, item) => sum + item.widthFt * item.depthFt, 0));
  const totalPowerDrawAmps = round(items.reduce((sum, item) => sum + item.powerDrawAmps, 0));

  const areaUtilization = footprintAreaSqFt > 0 ? clamp01(usedAreaSqFt / footprintAreaSqFt) : 0;
  const powerCapacityAmps = layout?.powerCapacityAmps ?? 0;
  const powerUtilization = powerCapacityAmps > 0 ? clamp01(totalPowerDrawAmps / powerCapacityAmps) : 0;
  const overCapacity = powerCapacityAmps > 0 && totalPowerDrawAmps > powerCapacityAmps;

  const byCategoryMap = new Map<PitMapItemCategory, PitMapCategoryBreakdown>();
  for (const item of items) {
    const existing = byCategoryMap.get(item.category) ?? {
      category: item.category,
      count: 0,
      areaSqFt: 0,
      powerDrawAmps: 0,
    };
    existing.count += 1;
    existing.areaSqFt = round(existing.areaSqFt + item.widthFt * item.depthFt);
    existing.powerDrawAmps = round(existing.powerDrawAmps + item.powerDrawAmps);
    byCategoryMap.set(item.category, existing);
  }
  const byCategory = PIT_MAP_CATEGORIES.filter((category) => byCategoryMap.has(category)).map(
    (category) => byCategoryMap.get(category)!,
  );

  return {
    totalItems: items.length,
    footprintAreaSqFt,
    usedAreaSqFt,
    areaUtilization: round(areaUtilization, 3),
    totalPowerDrawAmps,
    powerUtilization: round(powerUtilization, 3),
    overCapacity,
    byCategory,
  };
}
