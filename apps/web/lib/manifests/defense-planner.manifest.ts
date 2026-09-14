export const manifest = {
  slug: "defense-planner",
  title: "Defense",
  route: "/defense-planner",
  apiRoute: "/api/defense-planner",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["defense_planner_robot_profiles", "defense_planner_matchups"],
  aiTools: [
    {
      name: "defense_planner.matchups",
      description:
        "Read this org's scouted defensive matchups (opponent mass/drivetrain/cycle path) and the computed play/stay-offense recommendation for the active season.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
