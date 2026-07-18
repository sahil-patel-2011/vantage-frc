export const manifest = {
  slug: "degraded-mode",
  title: "Data-Source Degraded Mode",
  route: "/degraded-mode",
  apiRoute: "/api/degraded-mode",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["degraded_mode_acknowledgments"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
