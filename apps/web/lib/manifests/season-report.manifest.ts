export const manifest = {
  slug: "season-report",
  title: "Season Report",
  route: "/season-report",
  apiRoute: "/api/season-report",
  hub: "AI",
  navGroup: "AI",
  metered: true,
  tables: ["season_report_entries", "season_report_snapshots"],
  aiTools: [
    {
      name: "season_report.snapshots",
      description:
        "Read this org's generated season retrospective snapshots — narrative sections for build reliability, results, budget, and outreach synthesized only from logged entries, plus highlights, watchouts, and coverage completeness for the season.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
