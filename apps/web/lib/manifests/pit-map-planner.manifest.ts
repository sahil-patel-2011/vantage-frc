export const manifest = {
  slug: "pit-map-planner",
  title: "Pit Map Planner",
  route: "/pit-map-planner",
  apiRoute: "/api/pit-map-planner",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["pit_map_planner_layouts", "pit_map_planner_items"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
