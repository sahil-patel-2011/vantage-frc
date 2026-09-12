export const manifest = {
  slug: "goals-tracker",
  title: "Goals",
  route: "/goals-tracker",
  apiRoute: "/api/goals-tracker",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["goals_tracker_goals", "goals_tracker_checkins"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
