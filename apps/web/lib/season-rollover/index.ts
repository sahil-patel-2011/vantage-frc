// Pure, unit-testable helpers for Season Rollover — no I/O.

import type {
  SeasonRolloverCategory,
  SeasonRolloverItem,
  SeasonRolloverSummary,
} from "./types";

export const SEASON_ROLLOVER_CATEGORIES: SeasonRolloverCategory[] = [
  "roster",
  "scouting_schema",
  "config",
  "other",
];

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export function nextSeasonYear(seasonYear: number): number {
  return seasonYear + 1;
}

export function seasonRolloverCategoryLabel(category: SeasonRolloverCategory): string {
  switch (category) {
    case "roster":
      return "Roster";
    case "scouting_schema":
      return "Scouting schema";
    case "config":
      return "Team config";
    default:
      return "Other";
  }
}

export function summarizeRollover(items: SeasonRolloverItem[]): SeasonRolloverSummary {
  const totalItems = items.length;
  const carriedItems = items.filter((item) => item.carried).length;
  const completionRate = totalItems > 0 ? carriedItems / totalItems : 0;

  const byCategory = SEASON_ROLLOVER_CATEGORIES.map((category) => {
    const inCategory = items.filter((item) => item.category === category);
    return {
      category,
      total: inCategory.length,
      carried: inCategory.filter((item) => item.carried).length,
    };
  }).filter((row) => row.total > 0);

  return { totalItems, carriedItems, completionRate, byCategory };
}
