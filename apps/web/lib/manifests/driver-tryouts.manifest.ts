export const manifest = {
  slug: "driver-tryouts",
  title: "Driver tryouts",
  route: "/driver-tryouts",
  apiRoute: "/api/driver-tryouts",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["driver_tryouts_candidates", "driver_tryouts_evaluations"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
