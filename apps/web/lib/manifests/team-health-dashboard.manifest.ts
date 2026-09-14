export const manifest = {
  slug: "team-health-dashboard",
  title: "Team health",
  route: "/team-health-dashboard",
  apiRoute: "/api/team-health-dashboard",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["team_health_dashboard_pulses"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
