export const manifest = {
  slug: "alliance-selection-desk",
  title: "Alliance Selection Desk 2.0",
  route: "/alliance-selection-desk",
  apiRoute: "/api/alliance-selection-desk",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: [
    "alliance_selection_desk_sessions",
    "alliance_selection_desk_slots",
    "alliance_selection_desk_evidence",
    "alliance_selection_desk_exports",
  ],
  aiTools: [],
  exportAdapters: ["drive-team-json"],
  placeholderRoute: false,
} as const;
