// Season Rollover domain types. Pure data shapes — no I/O, no framework imports.
// A "plan" archives one season transition (from_season_year -> to_season_year) and tracks
// the checklist of config/roster/scout-schema items a team carries forward.

export type SeasonRolloverCategory = "roster" | "scouting_schema" | "config" | "other";

export type SeasonRolloverStatus = "planned" | "in_progress" | "completed";

export type SeasonRolloverItem = {
  id: string;
  planId: string;
  category: SeasonRolloverCategory;
  label: string;
  carried: boolean;
  notes: string | null;
  createdAt: string;
  carriedAt: string | null;
};

export type SeasonRolloverPlan = {
  id: string;
  fromSeasonYear: number;
  toSeasonYear: number;
  status: SeasonRolloverStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  items: SeasonRolloverItem[];
};

export type SeasonRolloverSummary = {
  totalItems: number;
  carriedItems: number;
  completionRate: number;
  byCategory: Array<{
    category: SeasonRolloverCategory;
    total: number;
    carried: number;
  }>;
};
