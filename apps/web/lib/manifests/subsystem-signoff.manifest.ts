export const manifest = {
  slug: "subsystem-signoff",
  title: "Subsystem Sign-off",
  route: "/subsystem-signoff",
  apiRoute: "/api/subsystem-signoff",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["subsystem_signoff_subsystems", "subsystem_signoff_records"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
