export const manifest = {
  slug: "scout-assisted-count",
  title: "Scout-Assisted Count",
  route: "/scout-assisted-count",
  apiRoute: "/api/scout-assisted-count",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_assisted_count_sessions", "scout_assisted_count_taps"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
