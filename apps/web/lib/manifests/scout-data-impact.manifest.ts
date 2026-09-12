export const manifest = {
  slug: "scout-data-impact",
  title: "Data impact",
  route: "/scout-data-impact",
  apiRoute: "/api/scout-data-impact",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_data_impact_picks", "scout_data_impact_acknowledgments"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
