export const manifest = {
  slug: "district-advancement",
  title: "Districts",
  route: "/district-advancement",
  apiRoute: "/api/district-advancement",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: [
    "district_trajectory_sim_runs",
    "district_trajectory_sim_projections",
    "district_trajectory_sim_scenarios",
  ],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
