export const manifest = {
  slug: "season-planning-workspace",
  title: "Season plan",
  route: "/season-planning-workspace",
  apiRoute: "/api/season-planning-workspace",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: [
    "season_planning_workspace_plans",
    "season_planning_workspace_goals",
    "season_planning_workspace_milestones",
  ],
  aiTools: [],
  exportAdapters: ["ics"],
  placeholderRoute: false,
} as const;
