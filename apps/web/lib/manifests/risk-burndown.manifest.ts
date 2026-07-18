export const manifest = {
  slug: "risk-burndown",
  title: "Risk-Register Burndown",
  route: "/risk-burndown",
  apiRoute: "/api/risk-burndown",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["risk_burndown_items"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
