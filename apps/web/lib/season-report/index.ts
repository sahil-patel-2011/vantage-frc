// Pure, framework-free season-report math and narrative synthesis. Everything here is
// deterministic and grounded only in the entries the caller supplies — it never fabricates a
// value. compute-season-report.ts wraps this with DB I/O; the API route and client render results.

import type {
  SeasonReportCategory,
  SeasonReportCategoryBreakdown,
  SeasonReportEntry,
  SeasonReportNarrative,
  SeasonReportSentiment,
  SeasonReportSummary,
} from "./types";

export const SEASON_REPORT_CATEGORIES: SeasonReportCategory[] = [
  "build_reliability",
  "results",
  "budget",
  "outreach",
  "lessons",
];

export const SEASON_REPORT_SENTIMENTS: SeasonReportSentiment[] = ["positive", "neutral", "negative"];

export function seasonReportCategoryLabel(category: SeasonReportCategory): string {
  switch (category) {
    case "build_reliability":
      return "Build reliability";
    case "results":
      return "Results";
    case "budget":
      return "Budget";
    case "outreach":
      return "Outreach";
    case "lessons":
      return "Lessons learned";
    default:
      return category;
  }
}

export function seasonReportSentimentLabel(sentiment: SeasonReportSentiment): string {
  switch (sentiment) {
    case "positive":
      return "Positive";
    case "negative":
      return "Needs attention";
    default:
      return "Neutral";
  }
}

/** Aggregate logged entries into a per-category breakdown and an overall completeness score. */
export function summarizeSeasonReportEntries(entries: SeasonReportEntry[]): SeasonReportSummary {
  const byCategory: SeasonReportCategoryBreakdown[] = SEASON_REPORT_CATEGORIES.map((category) => {
    const inCategory = entries.filter((entry) => entry.category === category);
    return {
      category,
      entries: inCategory.length,
      positive: inCategory.filter((entry) => entry.sentiment === "positive").length,
      neutral: inCategory.filter((entry) => entry.sentiment === "neutral").length,
      negative: inCategory.filter((entry) => entry.sentiment === "negative").length,
    };
  });
  const coveredCategories = byCategory.filter((row) => row.entries > 0).length;
  return {
    totalEntries: entries.length,
    byCategory,
    completeness: Math.round((coveredCategories / SEASON_REPORT_CATEGORIES.length) * 1000) / 1000,
  };
}

function narrativeForCategory(category: SeasonReportCategory, entries: SeasonReportEntry[]): string {
  const inCategory = entries.filter((entry) => entry.category === category);
  const label = seasonReportCategoryLabel(category);
  if (inCategory.length === 0) {
    return `No ${label.toLowerCase()} notes logged yet — add entries to include this section in the report.`;
  }
  const positive = inCategory.filter((entry) => entry.sentiment === "positive").length;
  const negative = inCategory.filter((entry) => entry.sentiment === "negative").length;
  const metricParts = inCategory
    .filter((entry) => entry.metricLabel && entry.metricValue != null)
    .slice(0, 4)
    .map((entry) => `${entry.metricLabel}: ${entry.metricValue}`);
  const titles = inCategory.slice(0, 5).map((entry) => entry.title);
  const tone =
    negative > positive
      ? "More entries flagged concerns than wins here."
      : positive > negative
        ? "More entries were positive than negative here."
        : "Entries were mixed between wins and concerns.";
  return [
    `${inCategory.length} ${label.toLowerCase()} entr${inCategory.length === 1 ? "y" : "ies"} logged (${positive} positive, ${negative} needing attention). ${tone}`,
    titles.length ? `Notable: ${titles.join("; ")}.` : "",
    metricParts.length ? `Metrics: ${metricParts.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build the five-section narrative purely from logged entries — no invented content. */
export function buildSeasonReportNarrative(entries: SeasonReportEntry[]): SeasonReportNarrative {
  return {
    buildReliability: narrativeForCategory("build_reliability", entries),
    results: narrativeForCategory("results", entries),
    budget: narrativeForCategory("budget", entries),
    outreach: narrativeForCategory("outreach", entries),
    lessons: narrativeForCategory("lessons", entries),
  };
}

/** Highlights: the positive-sentiment entry titles, most recent first, capped for readability. */
export function extractHighlights(entries: SeasonReportEntry[]): string[] {
  return entries
    .filter((entry) => entry.sentiment === "positive")
    .slice(0, 8)
    .map((entry) => `${seasonReportCategoryLabel(entry.category)}: ${entry.title}`);
}

/** Watchouts: the negative-sentiment entry titles, most recent first, capped for readability. */
export function extractWatchouts(entries: SeasonReportEntry[]): string[] {
  return entries
    .filter((entry) => entry.sentiment === "negative")
    .slice(0, 8)
    .map((entry) => `${seasonReportCategoryLabel(entry.category)}: ${entry.title}`);
}
