export const manifest = {
  slug: "match-delta-watcher",
  title: "Match-Delta Watcher",
  route: "/match-delta-watcher",
  apiRoute: "/api/match-delta-watcher",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["match_delta_watcher_configs", "match_delta_watcher_alerts"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
