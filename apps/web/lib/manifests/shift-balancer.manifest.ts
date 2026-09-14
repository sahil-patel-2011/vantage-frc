export const manifest = {
  slug: "shift-balancer",
  title: "Shifts",
  route: "/shift-balancer",
  apiRoute: "/api/shift-balancer",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["shift_balancer_scouts", "shift_balancer_plans"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
