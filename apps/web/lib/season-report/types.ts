// Season Report domain types. Pure data shapes — no I/O, no framework imports.
// A unified end-of-season retrospective: teams log dated notes/metrics across build reliability,
// results, budget, and outreach through the season, plus freeform lessons; the generator
// synthesizes a narrative snapshot from only what was actually logged.

export type SeasonReportCategory = "build_reliability" | "results" | "budget" | "outreach" | "lessons";

export type SeasonReportSentiment = "positive" | "neutral" | "negative";

export type SeasonReportEntry = {
  id: string;
  seasonYear: number;
  category: SeasonReportCategory;
  title: string;
  detail: string | null;
  metricLabel: string | null;
  metricValue: number | null;
  sentiment: SeasonReportSentiment;
  createdAt: string;
};

export type SeasonReportCategoryBreakdown = {
  category: SeasonReportCategory;
  entries: number;
  positive: number;
  neutral: number;
  negative: number;
};

export type SeasonReportSummary = {
  totalEntries: number;
  byCategory: SeasonReportCategoryBreakdown[];
  /** 0..1 — fraction of the five categories that have at least one logged entry. */
  completeness: number;
};

export type SeasonReportNarrative = {
  buildReliability: string;
  results: string;
  budget: string;
  outreach: string;
  lessons: string;
};

/** A generated retrospective snapshot, persisted to season_report_snapshots. */
export type SeasonReportSnapshot = {
  id: string;
  seasonYear: number;
  completeness: number;
  narrative: SeasonReportNarrative;
  highlights: string[];
  watchouts: string[];
  entryCount: number;
  createdAt: string;
};
