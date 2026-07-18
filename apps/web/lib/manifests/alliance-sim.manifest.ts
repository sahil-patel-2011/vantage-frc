export const manifest = {
  slug: "alliance-sim",
  title: "Alliance Sim",
  route: "/alliance-sim",
  apiRoute: "/api/alliance-sim",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["alliance_sim_scenarios", "alliance_sim_robots"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
