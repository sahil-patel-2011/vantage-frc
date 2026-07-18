export const manifest = {
  slug: "season-rollover",
  title: "Season Rollover",
  route: "/season-rollover",
  apiRoute: "/api/season-rollover",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["season_rollover_plans", "season_rollover_items"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
