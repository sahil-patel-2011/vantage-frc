export const manifest = {
  slug: "cad-change-radar",
  title: "Change radar",
  route: "/cad-change-radar",
  apiRoute: "/api/cad-change-radar",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: [
    "cad_change_radar_snapshots",
    "cad_change_radar_diffs",
    "cad_change_radar_subscriptions",
    "cad_change_radar_notifications",
  ],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
