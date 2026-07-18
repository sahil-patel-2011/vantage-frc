export const manifest = {
  slug: "opponent-watchlist",
  title: "Opponent Watchlist",
  route: "/opponent-watchlist",
  apiRoute: "/api/opponent-watchlist",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["opponent_watchlist_entries", "opponent_watchlist_snapshots"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
