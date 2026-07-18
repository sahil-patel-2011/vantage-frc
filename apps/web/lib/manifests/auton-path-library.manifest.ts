export const manifest = {
  slug: "auton-path-library",
  title: "Autonomous Path Library",
  route: "/auton-path-library",
  apiRoute: "/api/auton-path-library",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["auton_path_library_paths", "auton_path_library_runs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
