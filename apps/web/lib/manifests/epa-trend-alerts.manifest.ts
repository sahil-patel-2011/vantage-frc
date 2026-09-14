export const manifest = {
  slug: "epa-trend-alerts",
  title: "Rating alerts",
  route: "/epa-trend-alerts",
  apiRoute: "/api/epa-trend-alerts",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["epa_trend_alerts_watchlist", "epa_trend_alerts_dismissals"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
