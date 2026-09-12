export const manifest = {
  slug: "ranking-projection",
  title: "Rank projection",
  route: "/ranking-projection",
  apiRoute: "/api/ranking-projection",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["team_event_metrics", "matches_ref"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
