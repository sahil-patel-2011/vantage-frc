export const manifest = {
  slug: "manufacturing",
  title: "Part Manufacturing",
  route: "/manufacturing",
  apiRoute: "/api/manufacturing",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["manufacturing_parts", "manufacturing_state_events"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
