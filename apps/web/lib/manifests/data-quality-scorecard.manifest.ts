export const manifest = {
  slug: "data-quality-scorecard",
  title: "Data Quality Scorecard",
  route: "/data-quality-scorecard",
  apiRoute: "/api/data-quality-scorecard",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["data_quality_scorecard_checks"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
