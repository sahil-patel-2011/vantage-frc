export const manifest = {
  slug: "parent-comms",
  title: "Parent Updates",
  route: "/parents",
  apiRoute: "/api/parents",
  hub: "Team",
  navGroup: "Team",
  // Metered only for optional digest translation (feature=parent-digest-translate).
  metered: true,
  tables: ["parent_contacts", "parent_digest_sends"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
