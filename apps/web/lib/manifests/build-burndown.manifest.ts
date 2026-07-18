export const manifest = {
  slug: "build-burndown",
  title: "Build-Season Burndown",
  route: "/build-burndown",
  apiRoute: "/api/build-burndown",
  hub: "Team",
  navGroup: "Build",
  metered: false,
  tables: ["build_burndown_tasks", "build_burndown_plans"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
