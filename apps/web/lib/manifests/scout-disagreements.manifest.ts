export const manifest = {
  slug: "scout-disagreements",
  title: "Disagreements",
  route: "/scout-disagreements",
  apiRoute: "/api/scout-disagreements",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["scout_disagreements_items", "scout_disagreements_audit_log"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
