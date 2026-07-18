export const manifest = {
  slug: "match-checklist",
  title: "Pre-Match Checklist",
  route: "/match-checklist",
  apiRoute: "/api/match-checklist",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["match_checklist_runs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
