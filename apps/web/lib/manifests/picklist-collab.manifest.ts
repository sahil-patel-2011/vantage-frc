export const manifest = {
  slug: "picklist-collab",
  title: "Collaborative Pick List",
  route: "/picklist-collab",
  apiRoute: "/api/picklist-collab",
  hub: "Competition",
  navGroup: "Competition",
  metered: false,
  tables: ["picklist_collab_lists", "picklist_collab_entries", "picklist_collab_votes"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
