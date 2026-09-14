export const manifest = {
  slug: "scout-crossval",
  title: "Cross-check",
  route: "/scout-crossval",
  apiRoute: "/api/scout-crossval",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_crossval_runs", "scout_crossval_fields"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
