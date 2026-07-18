export const manifest = {
  slug: "robot-weigh-in",
  title: "Robot Weigh-In Log",
  route: "/robot-weigh-in",
  apiRoute: "/api/robot-weigh-in",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["robot_weigh_in_entries"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
